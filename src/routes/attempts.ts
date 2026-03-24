import { Router } from "express";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";

const router = Router();


function gradeAnswer(question: any, userAnswer: any): number {
  switch (question.type) {
    case 'MCQ':
    case 'TRUE_FALSE':
      return question.answer === userAnswer ? 1 : 0;

    case 'FILL_IN_THE_BLANK':
      return question.answer.every(
        (a: string, i: number) =>
          a.toLowerCase() === userAnswer?.[i]?.toLowerCase()
      )
        ? question.answer.length
        : 0;

    case 'MATCHING':
      return question.answer.filter((pair: any) =>
        userAnswer.some(
          (ua: any) => ua.left === pair.left && ua.right === pair.right
        )
      ).length;

    default:
      return 0;
  }
}

async function countAttempts(
  userId: string,
  materialTitle: string,
  questionType?: string
) {
  let query = supabaseAdmin
    .from('attempts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('material_title', materialTitle);

  if (questionType) {
    query = query.eq('question_type', questionType);
  }

  return query;
}

async function findActiveAttempt(
  userId: string,
  materialTitle: string,
  questionType?: string
) {
  let query = supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('user_id', userId)
    .eq('material_title', materialTitle)
    .is('completed_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (questionType) {
    query = query.eq('question_type', questionType);
  }

  return query.single();
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
  // Fetch questions
  let query = supabaseAdmin
    .from('questions')
    .select('*')
    .eq('creator_id', userId)
    .eq('material_title', materialTitle);

  if (questionType) {
    query = query.eq('type', questionType);
  }

  const { data: questions } = await query;

  if (!questions || questions.length === 0) {
    throw new Error('NO_QUESTIONS');
  }

  // Calculate duration
  let durationSeconds: number | null = null;
  let expiresAt: string | null = null;

  if (isTimed) {
    durationSeconds = questions.length * 60;
    expiresAt = new Date(
      Date.now() + durationSeconds * 1000
    ).toISOString();
  }

  // Max score
  const maxScore = questions.reduce((sum, q) => {
    if (['FILL_IN_THE_BLANK', 'MATCHING'].includes(q.type)) {
      return sum + (q.answer?.length ?? 1);
    }
    return sum + 1;
  }, 0);

  const { data: attempt, error } = await supabaseAdmin
    .from('attempts')
    .insert({
      user_id: userId,
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

function gradeQuestion(question: any, userAnswer: any): number {
  switch (question.type) {
    case 'MCQ':
    case 'TRUE_FALSE':
      return question.answer === userAnswer ? 1 : 0;

    case 'FILL_IN_THE_BLANK':
      if (!Array.isArray(userAnswer)) return 0;
      return question.answer.reduce(
        (score: number, ans: string, i: number) =>
          userAnswer[i]?.toLowerCase() === ans.toLowerCase()
            ? score + 1
            : score,
        0
      );

    case 'MATCHING':
      if (!Array.isArray(userAnswer)) return 0;
      return question.answer.reduce(
        (score: number, pair: any, i: number) =>
          userAnswer[i]?.left === pair.left &&
          userAnswer[i]?.right === pair.right
            ? score + 1
            : score,
        0
      );

    default:
      return 0;
  }
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
  let maxScore = 0;

  const questionStats = [];

  for (const question of questions) {
    const userAnswer = answers?.[question.id];
    const qScore = gradeQuestion(question, userAnswer);

    score += qScore;
    maxScore += question.points ?? 1;

    questionStats.push({
      attempt_id: attempt.id,
      question_id: question.id,
      topic: question.topic,
      domain: question.domain,
      is_correct: qScore > 0,
      score: qScore
    });
  }

  const completedAt = new Date();

  const timeUsedSeconds = attempt.started_at
    ? Math.floor(
        (completedAt.getTime() -
          new Date(attempt.started_at).getTime()) / 1000
      )
    : null;

  const accuracy =
    maxScore > 0 ? Number((score / maxScore).toFixed(2)) : 0;

  await supabaseAdmin
    .from('attempt_question_stats')
    .insert(questionStats);

  await supabaseAdmin
    .from('attempts')
    .update({
      score,
      max_score: maxScore,
      accuracy,
      time_used_seconds: timeUsedSeconds,
      completed_at: completedAt.toISOString()
    })
    .eq('id', attempt.id)
    .eq('user_id', userId);

  return {
    score,
    maxScore,
    accuracy,
    timeUsedSeconds
  };
}

router
.post('/start/before', requireAuth, async (req, res) => {
    const { materialTitle, questionType } = req.body;

    if (!materialTitle) {
      return res.status(400).json({ error: 'materialTitle is required' });
    }

    let query = supabaseAdmin
      .from('questions')
      .select('*')
      .eq('creator_id', req.user!.id)
      .eq('material_title', materialTitle);

    if (questionType) {
      query = query.eq('type', questionType);
    }

    const { data: questions, error } = await query;

    if (error || !questions || questions.length === 0) {
      return res.status(404).json({ error: 'No questions found' });
    }

    const maxScore = questions.reduce((sum, q) => {
      if (['FILL_IN_THE_BLANK', 'MATCHING'].includes(q.type)) {
        return sum + (q.answer?.length ?? 1);
      }
      return sum + 1;
    }, 0);

    const { data: attempt, error: attemptError } = await supabaseAdmin
      .from('attempts')
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
.post('/:id/submit/before', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { answers } = req.body;

    if (!Array.isArray(answers)) {
      return res.status(400).json({ error: 'Invalid answers format' });
    }

    const questionIds = answers.map(a => a.questionId);

    const { data: questions } = await supabaseAdmin
      .from('questions')
      .select('*')
      .in('id', questionIds);

    let totalScore = 0;

    const answerRows = answers.map(({ questionId, answer }) => {
      const question = questions!.find(q => q.id === questionId);
      const score = gradeAnswer(question, answer);

      totalScore += score;

      return {
        attempt_id: id,
        question_id: questionId,
        user_answer: answer,
        is_correct: score > 0,
        score
      };
    });

    await supabaseAdmin.from('attempt_answers').insert(answerRows);

    await supabaseAdmin
      .from('attempts')
      .update({
        total_score: totalScore,
        completed_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('user_id', req.user!.id);

    res.json({
      message: 'Attempt submitted successfully',
      totalScore
    });
})
.post('/start', requireAuth, async (req, res) => {
  const {
    materialId,
    questionType,
    isTimed = true
  } = req.body;

  if (!materialId) {
    return res.status(400).json({ error: 'materialId is required' });
  }

  // 1️⃣ Load subscription
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user!.id)
    .single();

  if (!subscription) {
    return res.status(403).json({
      error: 'Subscription not found'
    });
  }

  // 2️⃣ Timed attempt restriction
  if (isTimed && !subscription.allow_timed) {
    return res.status(403).json({
      error: 'Timed attempts are not allowed on your plan'
    });
  }

  // 3️⃣ Verify material ownership
  const { data: material } = await supabaseAdmin
    .from('materials')
    .select('id')
    .eq('id', materialId)
    .eq('user_id', req.user!.id)
    .single();

  if (!material) {
    return res.status(404).json({ error: 'Material not found' });
  }

  // 4️⃣ Total attempt limit (GLOBAL)
  const { count: totalAttempts } = await supabaseAdmin
    .from('attempts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user!.id);

  if ((totalAttempts ?? 0) >= subscription.attempt_limit) {
    return res.status(403).json({
      error: 'Attempt limit reached for your subscription'
    });
  }

  // 5️⃣ Retake limit PER MATERIAL
  const { count: materialAttempts } = await supabaseAdmin
    .from('attempts')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', req.user!.id)
    .eq('material_id', materialId)
    .eq('question_type', questionType ?? null);

  if (
    materialAttempts &&
    materialAttempts > 0 &&
    !subscription.allow_reattempt
  ) {
    return res.status(403).json({
      error: 'Retakes are not allowed on your plan'
    });
  }

  // 6️⃣ Fetch questions
  let q = supabaseAdmin
    .from('questions')
    .select('*')
    .eq('material_id', materialId);

  if (questionType) {
    q = q.eq('type', questionType);
  }

  const { data: questions } = await q;

  if (!questions || questions.length === 0) {
    return res.status(404).json({ error: 'No questions found' });
  }

  // 7️⃣ Timing
  let durationSeconds: number | null = null;
  let expiresAt: string | null = null;

  if (isTimed) {
    durationSeconds = questions.length * 60;
    expiresAt = new Date(
      Date.now() + durationSeconds * 1000
    ).toISOString();
  }

  // 8️⃣ Max score
  const maxScore = questions.reduce((sum, q) => {
    if (['FILL_IN_THE_BLANK', 'MATCHING'].includes(q.type)) {
      return sum + (Array.isArray(q.answer) ? q.answer.length : 1);
    }
    return sum + 1;
  }, 0);

  // 9️⃣ Create attempt
  const { data: attempt, error } = await supabaseAdmin
    .from('attempts')
    .insert({
      user_id: req.user!.id,
      material_id: materialId,
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
    timing: isTimed
      ? { expiresAt, durationSeconds }
      : { unlimited: true }
  });
})
.post('/attempts/start-or-resume', requireAuth, async (req, res) => {
    const { materialTitle, questionType, isTimed = true } = req.body;

    if (!materialTitle) {
        return res.status(400).json({ error: 'materialTitle is required' });
    }

    // 1. Check for active attempt
    const { data: activeAttempt } = await supabaseAdmin
        .from('attempts')
        .select('*')
        .eq('user_id', req.user!.id)
        .eq('material_title', materialTitle)
        .is('completed_at', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (activeAttempt) {
        if (
        activeAttempt.is_timed &&
        activeAttempt.expires_at &&
        new Date() > new Date(activeAttempt.expires_at)
        ) {
        return res.status(403).json({ error: 'Attempt expired' });
        }

        // Fetch questions
        let q = supabaseAdmin
        .from('questions')
        .select('*')
        .eq('creator_id', req.user!.id)
        .eq('material_title', materialTitle);

        if (questionType) q = q.eq('type', questionType);

        const { data: questions } = await q;

        return res.json({
        resumed: true,
        attempt: activeAttempt,
        questions
        });
    }

    // 2. Create new attempt
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
        if (err.message === 'NO_QUESTIONS') {
            return res.status(404).json({ error: 'No questions found' });
        }
        return res.status(500).json({ error: 'Failed to create attempt' });
    }
})
.patch('/attempts/:id/answer', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { questionId, answer } = req.body;

  if (!questionId) {
    return res.status(400).json({ error: 'questionId is required' });
  }

  // 1. Fetch attempt with status fields
  const { data: attempt, error } = await supabaseAdmin
    .from('attempts')
    .select('answers, completed_at, is_timed, expires_at')
    .eq('id', id)
    .eq('user_id', req.user!.id)
    .maybeSingle();

  if (error || !attempt) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  // 2. Block updates if attempt completed
  if (attempt.completed_at) {
    return res.status(400).json({
      error: 'Attempt already submitted'
    });
  }

  // 3. Block updates if timed attempt expired
  if (
    attempt.is_timed &&
    attempt.expires_at &&
    new Date() > new Date(attempt.expires_at)
  ) {
    return res.status(403).json({
      error: 'Attempt expired'
    });
  }

  // 4. Merge answer safely
  const updatedAnswers = {
    ...(attempt.answers ?? {}),
    [questionId]: answer
  };

  // 5. Save
  const { error: updateError } = await supabaseAdmin
    .from('attempts')
    .update({ answers: updatedAnswers })
    .eq('id', id)
    .eq('user_id', req.user!.id);

  if (updateError) {
    return res.status(500).json({
      error: 'Failed to save answer'
    });
  }

  res.json({ saved: true });
})
.post('/:id/submit/v2', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { answers } = req.body;

    const { data: attempt } = await supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user!.id)
    .single();

    if (!attempt) {
        return res.status(404).json({ error: 'Attempt not found' });
    }

    if (attempt.completed_at) {
        return res.status(400).json({ error: 'Attempt already submitted' });
    }

    // ⏱ Enforce timing only if timed
    if (
        attempt.is_timed &&
        attempt.expires_at &&
        new Date() > new Date(attempt.expires_at)
    ) {
        return res.status(403).json({
            error: 'Time expired. Attempt auto-submitted.'
        });
    }

    if (!Array.isArray(answers)) {
        return res.status(400).json({ error: 'Invalid answers format' });
    }

    const questionIds = answers.map(a => a.questionId);

    const { data: questions } = await supabaseAdmin
        .from('questions')
        .select('*')
        .in('id', questionIds);

    let totalScore = 0;

    const answerRows = answers.map(({ questionId, answer }) => {
        const question = questions!.find(q => q.id === questionId);
        const score = gradeAnswer(question, answer);

        totalScore += score;

        return {
        attempt_id: id,
        question_id: questionId,
        user_answer: answer,
        is_correct: score > 0,
        score
        };
    });

    await supabaseAdmin.from('attempt_answers').insert(answerRows);

    await supabaseAdmin
        .from('attempts')
        .update({
            total_score: totalScore,
            completed_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('user_id', req.user!.id);

    res.json({
        message: 'Attempt submitted successfully',
        totalScore
    });
})
.post('/:id/submit/v3', requireAuth, async (req, res) => {
  const { id } = req.params;

  // 1. Load attempt
  const { data: attempt } = await supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user!.id)
    .single();

  if (!attempt) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  if (attempt.completed_at) {
    return res.status(400).json({ error: 'Attempt already submitted' });
  }

  // ⏱ Enforce time only if timed
  if (
    attempt.is_timed &&
    attempt.expires_at &&
    new Date() > new Date(attempt.expires_at)
  ) {
    return res.status(403).json({
      error: 'Time expired. Attempt auto-submitted.'
    });
  }

  // 2. Load questions
  let q = supabaseAdmin
    .from('questions')
    .select('*')
    .eq('creator_id', req.user!.id)
    .eq('material_title', attempt.material_title);

  if (attempt.question_type) {
    q = q.eq('type', attempt.question_type);
  }

  const { data: questions } = await q;

  if (!questions || questions.length === 0) {
    return res.status(400).json({ error: 'Questions not found' });
  }

  // 3. Grade
  let score = 0;

  for (const question of questions) {
    const userAnswer = attempt.answers?.[question.id];
    score += gradeQuestion(question, userAnswer);
  }

  // 4. Analytics calculations
  const completedAt = new Date();

  const timeUsedSeconds = attempt.started_at
    ? Math.floor(
        (completedAt.getTime() -
          new Date(attempt.started_at).getTime()) / 1000
      )
    : null;

  const accuracy =
    attempt.max_score > 0
      ? Number((score / attempt.max_score).toFixed(2))
      : 0;

  // 5. Save final state
  await supabaseAdmin
    .from('attempts')
    .update({
      score,
      accuracy,
      time_used_seconds: timeUsedSeconds,
      completed_at: completedAt.toISOString()
    })
    .eq('id', attempt.id)
    .eq('user_id', req.user!.id);

  res.json({
    score,
    maxScore: attempt.max_score,
    accuracy,
    timeUsedSeconds
  });
})
.post('/:id/submit', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: attempt } = await supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user!.id)
    .single();

  if (!attempt) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  if (attempt.completed_at) {
    return res.status(400).json({ error: 'Attempt already submitted' });
  }

  if (
    attempt.is_timed &&
    attempt.expires_at &&
    new Date() > new Date(attempt.expires_at)
  ) {
    return res.status(403).json({ error: 'Time expired' });
  }

  let q = supabaseAdmin
    .from('questions')
    .select('*')
    .eq('creator_id', req.user!.id)
    .eq('material_title', attempt.material_title);

  if (attempt.question_type) {
    q = q.eq('type', attempt.question_type);
  }

  const { data: questions } = await q;

  if (!questions || questions.length === 0) {
    return res.status(400).json({ error: 'Questions not found' });
  }

  const result = await finalizeAttempt({
    attempt,
    questions,
    answers: attempt.answers ?? {},
    userId: req.user!.id
  });

  res.json({
    submitted: true,
    ...result
  });
})
.post('/:id/bulk-submit', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { answers } = req.body;

  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({
      error: 'answers must be an object keyed by questionId'
    });
  }

  const { data: attempt } = await supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user!.id)
    .single();

  if (!attempt) {
    return res.status(404).json({ error: 'Attempt not found' });
  }

  if (attempt.completed_at) {
    return res.status(400).json({ error: 'Attempt already submitted' });
  }

  if (
    attempt.is_timed &&
    attempt.expires_at &&
    new Date() > new Date(attempt.expires_at)
  ) {
    return res.status(403).json({ error: 'Time expired' });
  }

  // 1️⃣ Save answers
  await supabaseAdmin
    .from('attempts')
    .update({ answers })
    .eq('id', id)
    .eq('user_id', req.user!.id);

  // 2️⃣ Load questions
  let q = supabaseAdmin
    .from('questions')
    .select('*')
    .eq('creator_id', req.user!.id)
    .eq('material_id', attempt.material_id);

  if (attempt.question_type) {
    q = q.eq('type', attempt.question_type);
  }

  const { data: questions } = await q;

  if (!questions || questions.length === 0) {
    return res.status(400).json({ error: 'Questions not found' });
  }

  // 3️⃣ Finalize
  const result = await finalizeAttempt({
    attempt,
    questions,
    answers,
    userId: req.user!.id
  });

  res.json({
    submitted: true,
    ...result
  });
})
.get('/', requireAuth, async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('user_id', req.user!.id)
    .order('created_at', { ascending: false });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  res.json(data);
})
.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;

  const { data: attempt } = await supabaseAdmin
    .from('attempts')
    .select('*')
    .eq('id', id)
    .eq('user_id', req.user!.id)
    .single();

  const { data: answers } = await supabaseAdmin
    .from('attempt_answers')
    .select('*, questions(*)')
    .eq('attempt_id', id);

  res.json({ attempt, answers });
});


export default router;