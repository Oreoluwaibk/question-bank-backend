import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";

const router = Router();

function questionMaxPoints(question: { type: string; answer?: unknown }): number {
  if (["FILL_IN_THE_BLANK", "MATCHING"].includes(question.type)) {
    return Array.isArray(question.answer) ? question.answer.length : 1;
  }
  return 1;
}

function calculateMaxScore(questions: { type: string; answer?: unknown }[]): number {
  return questions.reduce((sum, q) => sum + questionMaxPoints(q), 0);
}

function gradeQuestion(question: any, userAnswer: any): number {
  if (!question) return 0;

  switch (question.type) {
    case "MCQ":
    case "TRUE_FALSE":
      return question.answer === userAnswer ? 1 : 0;

    case "FILL_IN_THE_BLANK":
      if (!Array.isArray(question.answer) || !Array.isArray(userAnswer)) return 0;
      return question.answer.reduce(
        (score: number, ans: string, i: number) =>
          userAnswer[i]?.toLowerCase() === ans.toLowerCase() ? score + 1 : score,
        0
      );

    case "MATCHING":
      if (!Array.isArray(question.answer) || !Array.isArray(userAnswer)) return 0;
      return question.answer.reduce(
        (score: number, pair: any, i: number) =>
          userAnswer[i]?.left === pair.left && userAnswer[i]?.right === pair.right
            ? score + 1
            : score,
        0
      );

    default:
      return 0;
  }
}

async function loadQuestionsForAttempt(attempt: any, userId: string) {
  let query = supabaseAdmin.from("questions").select("*");

  if (attempt.material_id) {
    query = query.eq("material_id", attempt.material_id);
  } else if (attempt.material_title) {
    query = query
      .eq("creator_id", userId)
      .eq("material_title", attempt.material_title);
  } else {
    return { data: null as any[] | null, error: "no_material" as const };
  }

  if (attempt.question_type) {
    query = query.eq("type", attempt.question_type);
  }

  const { data, error } = await query;
  if (error) return { data: null, error: error.message };
  return { data, error: null };
}

export async function createAttempt({
  userId,
  materialTitle,
  questionType,
  isTimed
}: {
  userId: string;
  materialTitle: string;
  questionType?: string;
  isTimed: boolean;
}) {
  let query = supabaseAdmin
    .from("questions")
    .select("*")
    .eq("creator_id", userId)
    .eq("material_title", materialTitle);

  if (questionType) {
    query = query.eq("type", questionType);
  }

  const { data: questions } = await query;

  if (!questions || questions.length === 0) {
    throw new Error("NO_QUESTIONS");
  }

  const { data: material } = await supabaseAdmin
    .from("materials")
    .select("id")
    .eq("user_id", userId)
    .eq("title", materialTitle)
    .maybeSingle();

  let durationSeconds: number | null = null;
  let expiresAt: string | null = null;

  if (isTimed) {
    durationSeconds = questions.length * 60;
    expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
  }

  const maxScore = calculateMaxScore(questions);

  const { data: attempt, error } = await supabaseAdmin
    .from("attempts")
    .insert({
      user_id: userId,
      material_id: material?.id ?? null,
      material_title: materialTitle,
      question_type: questionType ?? null,
      max_score: maxScore,
      is_timed: isTimed,
      duration_seconds: durationSeconds,
      expires_at: expiresAt
    })
    .select()
    .single();

  if (error) throw error;

  return { attempt, questions };
}

async function finalizeAttempt({
  attempt,
  questions,
  answers,
  userId
}: {
  attempt: any;
  questions: any[];
  answers: Record<string, any>;
  userId: string;
}) {
  let score = 0;
  const maxScore = attempt.max_score ?? calculateMaxScore(questions);
  const questionStats = [];

  for (const question of questions) {
    const userAnswer = answers?.[question.id];
    const qScore = gradeQuestion(question, userAnswer);
    const qMax = questionMaxPoints(question);

    score += qScore;

    questionStats.push({
      attempt_id: attempt.id,
      question_id: question.id,
      topic: question.topic,
      domain: question.domain,
      is_correct: qScore >= qMax,
      score: qScore
    });
  }

  const completedAt = new Date();

  const timeUsedSeconds = attempt.started_at
    ? Math.floor(
        (completedAt.getTime() - new Date(attempt.started_at).getTime()) / 1000
      )
    : null;

  const accuracy = maxScore > 0 ? Number((score / maxScore).toFixed(2)) : 0;

  await supabaseAdmin.from("attempt_question_stats").insert(questionStats);

  await supabaseAdmin
    .from("attempts")
    .update({
      score,
      max_score: maxScore,
      accuracy,
      time_used_seconds: timeUsedSeconds,
      completed_at: completedAt.toISOString()
    })
    .eq("id", attempt.id)
    .eq("user_id", userId);

  return { score, maxScore, accuracy, timeUsedSeconds };
}

router
  .post("/start/before", requireAuth, async (req, res) => {
    const { materialTitle, questionType } = req.body;

    if (!materialTitle) {
      return res.status(400).json({ error: "materialTitle is required" });
    }

    let query = supabaseAdmin
      .from("questions")
      .select("*")
      .eq("creator_id", req.user!.id)
      .eq("material_title", materialTitle);

    if (questionType) {
      query = query.eq("type", questionType);
    }

    const { data: questions, error } = await query;

    if (error || !questions || questions.length === 0) {
      return res.status(404).json({ error: "No questions found" });
    }

    const maxScore = calculateMaxScore(questions);

    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from("attempts")
      .insert({
        user_id: req.user!.id,
        material_title: materialTitle,
        question_type: questionType ?? null,
        max_score: maxScore
      })
      .select()
      .single();

    if (attemptError) {
      return res.status(400).json({ error: attemptError.message });
    }

    res.status(201).json({ attempt, questions });
  })
  .post("/:id/submit/before", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: "Invalid answers format" });
    }

    const questionIds = answers.map((a) => a.questionId);

    const { data: questions } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", questionIds);

    let score = 0;
    let maxScore = 0;

    const answerRows = answers.map(({ questionId, answer }) => {
      const question = questions?.find((q) => q.id === questionId);
      const qScore = gradeQuestion(question, answer);
      const qMax = question ? questionMaxPoints(question) : 0;

      score += qScore;
      maxScore += qMax;

      return {
        attempt_id: id,
        question_id: questionId,
        user_answer: answer,
        is_correct: qScore >= qMax && qMax > 0,
        score: qScore
      };
    });

    const accuracy = maxScore > 0 ? Number((score / maxScore).toFixed(2)) : 0;

    await supabaseAdmin.from("attempt_answers").insert(answerRows);

    await supabaseAdmin
      .from("attempts")
      .update({
        score,
        max_score: maxScore,
        accuracy,
        completed_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", req.user!.id);

    res.json({
      message: "Attempt submitted successfully",
      score,
      maxScore,
      accuracy
    });
  })
  .post("/start", requireAuth, async (req, res) => {
    const { materialId, questionType, isTimed = true } = req.body;

    if (!materialId) {
      return res.status(400).json({ error: "materialId is required" });
    }

    const { data: subscription } = await supabaseAdmin
      .from("subscriptions")
      .select("*")
      .eq("user_id", req.user!.id)
      .single();

    if (!subscription) {
      return res.status(403).json({ error: "Subscription not found" });
    }

    if (isTimed && !subscription.allow_timed) {
      return res.status(403).json({
        error: "Timed attempts are not allowed on your plan"
      });
    }

    const { data: material } = await supabaseAdmin
      .from("materials")
      .select("id, title")
      .eq("id", materialId)
      .eq("user_id", req.user!.id)
      .single();

    if (!material) {
      return res.status(404).json({ error: "Material not found" });
    }

    const { count: totalAttempts } = await supabaseAdmin
      .from("attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user!.id);

    if ((totalAttempts ?? 0) >= subscription.attempt_limit) {
      return res.status(403).json({
        error: "Attempt limit reached for your subscription"
      });
    }

    const { count: materialAttempts } = await supabaseAdmin
      .from("attempts")
      .select("*", { count: "exact", head: true })
      .eq("user_id", req.user!.id)
      .eq("material_id", materialId)
      .eq("question_type", questionType ?? null);

    if (
      materialAttempts &&
      materialAttempts > 0 &&
      !subscription.allow_reattempt
    ) {
      return res.status(403).json({
        error: "Retakes are not allowed on your plan"
      });
    }

    let q = supabaseAdmin
      .from("questions")
      .select("*")
      .eq("material_id", materialId);

    if (questionType) {
      q = q.eq("type", questionType);
    }

    const { data: questions } = await q;

    if (!questions || questions.length === 0) {
      return res.status(404).json({ error: "No questions found" });
    }

    let durationSeconds: number | null = null;
    let expiresAt: string | null = null;

    if (isTimed) {
      durationSeconds = questions.length * 60;
      expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();
    }

    const maxScore = calculateMaxScore(questions);

    const { data: attempt, error } = await supabaseAdmin
      .from("attempts")
      .insert({
        user_id: req.user!.id,
        material_id: materialId,
        material_title: material.title,
        question_type: questionType ?? null,
        max_score: maxScore,
        is_timed: isTimed,
        duration_seconds: durationSeconds,
        expires_at: expiresAt
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    res.status(201).json({
      attempt,
      questions,
      timing: isTimed ? { expiresAt, durationSeconds } : { unlimited: true }
    });
  })
  .post("/start-or-resume", requireAuth, async (req, res) => {
    const { materialTitle, questionType, isTimed = true } = req.body;

    if (!materialTitle) {
      return res.status(400).json({ error: "materialTitle is required" });
    }

    const { data: activeAttempt } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("user_id", req.user!.id)
      .eq("material_title", materialTitle)
      .is("completed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeAttempt) {
      if (
        activeAttempt.is_timed &&
        activeAttempt.expires_at &&
        new Date() > new Date(activeAttempt.expires_at)
      ) {
        return res.status(403).json({ error: "Attempt expired" });
      }

      const { data: questions, error: loadError } =
        await loadQuestionsForAttempt(activeAttempt, req.user!.id);

      if (loadError || !questions?.length) {
        return res.status(404).json({ error: "No questions found" });
      }

      return res.json({
        resumed: true,
        attempt: activeAttempt,
        questions
      });
    }

    try {
      const result = await createAttempt({
        userId: req.user!.id,
        materialTitle,
        questionType,
        isTimed
      });

      return res.status(201).json({
        resumed: false,
        attempt: result.attempt,
        questions: result.questions
      });
    } catch (err: any) {
      if (err.message === "NO_QUESTIONS") {
        return res.status(404).json({ error: "No questions found" });
      }
      return res.status(500).json({ error: "Failed to create attempt" });
    }
  })
  .patch("/:id/answer", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { questionId, answer } = req.body;

    if (!questionId) {
      return res.status(400).json({ error: "questionId is required" });
    }

    const { data: attempt, error } = await supabaseAdmin
      .from("attempts")
      .select("answers, completed_at, is_timed, expires_at")
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .maybeSingle();

    if (error || !attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.completed_at) {
      return res.status(400).json({ error: "Attempt already submitted" });
    }

    if (
      attempt.is_timed &&
      attempt.expires_at &&
      new Date() > new Date(attempt.expires_at)
    ) {
      return res.status(403).json({ error: "Attempt expired" });
    }

    const updatedAnswers = {
      ...(attempt.answers ?? {}),
      [questionId]: answer
    };

    const { error: updateError } = await supabaseAdmin
      .from("attempts")
      .update({ answers: updatedAnswers })
      .eq("id", id)
      .eq("user_id", req.user!.id);

    if (updateError) {
      return res.status(500).json({ error: "Failed to save answer" });
    }

    res.json({ saved: true });
  })
  .post("/:id/submit/v2", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { answers } = req.body;

    const { data: attempt } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .single();

    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.completed_at) {
      return res.status(400).json({ error: "Attempt already submitted" });
    }

    if (
      attempt.is_timed &&
      attempt.expires_at &&
      new Date() > new Date(attempt.expires_at)
    ) {
      return res.status(403).json({
        error: "Time expired. Attempt auto-submitted."
      });
    }

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: "Invalid answers format" });
    }

    const questionIds = answers.map((a) => a.questionId);

    const { data: questions } = await supabaseAdmin
      .from("questions")
      .select("*")
      .in("id", questionIds);

    let score = 0;
    let maxScore = 0;

    const answerRows = answers.map(({ questionId, answer }) => {
      const question = questions?.find((q) => q.id === questionId);
      const qScore = gradeQuestion(question, answer);
      const qMax = question ? questionMaxPoints(question) : 0;

      score += qScore;
      maxScore += qMax;

      return {
        attempt_id: id,
        question_id: questionId,
        user_answer: answer,
        is_correct: qScore >= qMax && qMax > 0,
        score: qScore
      };
    });

    const accuracy = maxScore > 0 ? Number((score / maxScore).toFixed(2)) : 0;

    await supabaseAdmin.from("attempt_answers").insert(answerRows);

    await supabaseAdmin
      .from("attempts")
      .update({
        score,
        max_score: maxScore,
        accuracy,
        completed_at: new Date().toISOString()
      })
      .eq("id", id)
      .eq("user_id", req.user!.id);

    res.json({
      message: "Attempt submitted successfully",
      score,
      maxScore,
      accuracy
    });
  })
  .post("/:id/submit/v3", requireAuth, async (req, res) => {
    const { id } = req.params;

    const { data: attempt } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .single();

    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.completed_at) {
      return res.status(400).json({ error: "Attempt already submitted" });
    }

    if (
      attempt.is_timed &&
      attempt.expires_at &&
      new Date() > new Date(attempt.expires_at)
    ) {
      return res.status(403).json({
        error: "Time expired. Attempt auto-submitted."
      });
    }

    const { data: questions, error: loadError } =
      await loadQuestionsForAttempt(attempt, req.user!.id);

    if (loadError === "no_material" || !questions?.length) {
      return res.status(400).json({ error: "Questions not found" });
    }

    let score = 0;

    for (const question of questions) {
      const userAnswer = attempt.answers?.[question.id];
      score += gradeQuestion(question, userAnswer);
    }

    const completedAt = new Date();

    const timeUsedSeconds = attempt.started_at
      ? Math.floor(
          (completedAt.getTime() -
            new Date(attempt.started_at).getTime()) / 1000
        )
      : null;

    const maxScore = attempt.max_score ?? calculateMaxScore(questions);
    const accuracy =
      maxScore > 0 ? Number((score / maxScore).toFixed(2)) : 0;

    await supabaseAdmin
      .from("attempts")
      .update({
        score,
        accuracy,
        time_used_seconds: timeUsedSeconds,
        completed_at: completedAt.toISOString()
      })
      .eq("id", attempt.id)
      .eq("user_id", req.user!.id);

    res.json({ score, maxScore, accuracy, timeUsedSeconds });
  })
  .post("/:id/submit", requireAuth, async (req, res) => {
    const { id } = req.params;

    const { data: attempt } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .single();

    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.completed_at) {
      return res.status(400).json({ error: "Attempt already submitted" });
    }

    if (
      attempt.is_timed &&
      attempt.expires_at &&
      new Date() > new Date(attempt.expires_at)
    ) {
      return res.status(403).json({ error: "Time expired" });
    }

    const { data: questions, error: loadError } =
      await loadQuestionsForAttempt(attempt, req.user!.id);

    if (loadError === "no_material" || !questions?.length) {
      return res.status(400).json({ error: "Questions not found" });
    }

    const result = await finalizeAttempt({
      attempt,
      questions,
      answers: attempt.answers ?? {},
      userId: req.user!.id
    });

    res.json({ submitted: true, ...result });
  })
  .post("/:id/bulk-submit", requireAuth, async (req, res) => {
    const { id } = req.params;
    const { answers } = req.body;

    if (!answers || typeof answers !== "object") {
      return res.status(400).json({
        error: "answers must be an object keyed by questionId"
      });
    }

    const { data: attempt } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .single();

    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.completed_at) {
      return res.status(400).json({ error: "Attempt already submitted" });
    }

    if (
      attempt.is_timed &&
      attempt.expires_at &&
      new Date() > new Date(attempt.expires_at)
    ) {
      return res.status(403).json({ error: "Time expired" });
    }

    await supabaseAdmin
      .from("attempts")
      .update({ answers })
      .eq("id", id)
      .eq("user_id", req.user!.id);

    const { data: questions, error: loadError } =
      await loadQuestionsForAttempt(attempt, req.user!.id);

    if (loadError === "no_material" || !questions?.length) {
      return res.status(400).json({ error: "Questions not found" });
    }

    const result = await finalizeAttempt({
      attempt,
      questions,
      answers,
      userId: req.user!.id
    });

    res.json({ submitted: true, ...result });
  })
  .get("/", requireAuth, async (req, res) => {
    const { data, error } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("user_id", req.user!.id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    res.json(data);
  })
  .get("/:id", requireAuth, async (req, res) => {
    const { id } = req.params;

    const { data: attempt } = await supabaseAdmin
      .from("attempts")
      .select("*")
      .eq("id", id)
      .eq("user_id", req.user!.id)
      .single();

    const { data: answers } = await supabaseAdmin
      .from("attempt_answers")
      .select("*, questions(*)")
      .eq("attempt_id", id);

    res.json({ attempt, answers });
  });

export default router;
