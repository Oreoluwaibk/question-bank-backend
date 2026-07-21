function normalizeText(value: unknown): string {
  if (value == null) return "";
  return String(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeQuestionType(type: unknown): string {
  return String(type ?? "")
    .trim()
    .toUpperCase();
}

export function normalizeTrueFalse(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (["true", "t", "yes", "y", "1"].includes(lower)) return true;
    if (["false", "f", "no", "n", "0"].includes(lower)) return false;
  }
  return null;
}

function isTrueFalseStyleQuestion(question: {
  type?: unknown;
  options?: string[] | null;
}): boolean {
  const type = normalizeQuestionType(question.type);
  if (type === "TRUE_FALSE") return true;

  const options = question.options ?? [];
  if (options.length !== 2) return false;

  const normalized = options.map((option) => normalizeTrueFalse(option));
  return normalized[0] !== null && normalized[1] !== null;
}

function gradeTrueFalseAnswer(
  question: { answer?: unknown; options?: string[] | null },
  userAnswer: unknown
): number {
  const correct = normalizeTrueFalse(question.answer);
  const submitted = normalizeTrueFalse(userAnswer);

  if (correct !== null && submitted !== null) {
    return correct === submitted ? 1 : 0;
  }

  const correctText = normalizeText(question.answer);
  const submittedText = normalizeText(userAnswer);
  if (correctText && submittedText && correctText === submittedText) {
    return 1;
  }

  return 0;
}

function gradeTextAnswer(correct: unknown, user: unknown): number {
  const normalizedCorrect = normalizeText(correct);
  const normalizedUser = normalizeText(user);

  if (!normalizedUser || !normalizedCorrect) return 0;
  if (normalizedUser === normalizedCorrect) return 1;

  if (
    normalizedCorrect.length >= 3 &&
    normalizedUser.includes(normalizedCorrect)
  ) {
    return 1;
  }

  return 0;
}

export function gradeQuestion(
  question: { type: string; answer?: unknown; options?: string[] | null },
  userAnswer: unknown
): number {
  if (!question) return 0;

  const type = normalizeQuestionType(question.type);

  if (type === "TRUE_FALSE" || isTrueFalseStyleQuestion(question)) {
    return gradeTrueFalseAnswer(question, userAnswer);
  }

  switch (type) {
    case "MCQ":
      return normalizeText(question.answer) === normalizeText(userAnswer) ? 1 : 0;

    case "SHORT_ANSWER":
    case "LONG_ANSWER":
      return gradeTextAnswer(question.answer, userAnswer);

    case "FILL_IN_THE_BLANK":
      if (!Array.isArray(question.answer) || !Array.isArray(userAnswer)) return 0;
      return question.answer.reduce(
        (score: number, ans: string, i: number) =>
          normalizeText(userAnswer[i]) === normalizeText(ans) ? score + 1 : score,
        0
      );

    case "MATCHING":
      if (!Array.isArray(question.answer) || !Array.isArray(userAnswer)) return 0;
      return question.answer.reduce(
        (score: number, pair: { left: string; right: string }, i: number) => {
          const submitted = userAnswer[i];
          if (!submitted || typeof submitted !== "object") return score;

          const leftMatch =
            normalizeText(submitted.left) === normalizeText(pair.left);
          const rightMatch =
            normalizeText(submitted.right) === normalizeText(pair.right);

          return leftMatch && rightMatch ? score + 1 : score;
        },
        0
      );

    default:
      return 0;
  }
}

export function questionMaxPoints(question: {
  type: string;
  answer?: unknown;
}): number {
  const type = normalizeQuestionType(question.type);
  if (["FILL_IN_THE_BLANK", "MATCHING"].includes(type)) {
    return Array.isArray(question.answer) ? question.answer.length : 1;
  }
  return 1;
}

export function calculateMaxScore(
  questions: { type: string; answer?: unknown }[]
): number {
  return questions.reduce((sum, q) => sum + questionMaxPoints(q), 0);
}
