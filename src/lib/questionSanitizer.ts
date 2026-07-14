import type { QuestionDomain, QuestionType } from "../types/question.types";

const ALLOWED_TYPES: QuestionType[] = [
  "MCQ",
  "TRUE_FALSE",
  "SHORT_ANSWER",
  "LONG_ANSWER",
  "FILL_IN_THE_BLANK",
  "MATCHING",
];

const ALLOWED_DOMAINS: QuestionDomain[] = [
  "SCIENCE",
  "TECHNOLOGY",
  "ENGINEERING",
  "MATHEMATICS",
  "MEDICINE",
  "LAW",
  "BUSINESS",
  "ECONOMICS",
  "EDUCATION",
  "HISTORY",
  "GEOGRAPHY",
  "POLITICS",
  "RELIGION",
  "PHILOSOPHY",
  "PSYCHOLOGY",
  "SOCIOLOGY",
  "ETHICS",
  "ENVIRONMENT",
  "ART",
  "LANGUAGE",
  "DAILY_LIFE",
  "GENERAL",
];

export type MatchingPair = { left: string; right: string };

export type SanitizedQuestion = {
  type: QuestionType;
  question: string;
  options: string[] | null;
  answer: string | boolean | string[] | MatchingPair[] | null;
  topic: string | null;
  domain: QuestionDomain;
};

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function parseMatchingPairs(answer: unknown): MatchingPair[] {
  if (!answer) return [];

  if (Array.isArray(answer)) {
    const pairs: MatchingPair[] = [];
    for (const item of answer) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const obj = item as Record<string, unknown>;
        const left = obj.left ?? obj.term ?? obj.key ?? obj.prompt;
        const right = obj.right ?? obj.match ?? obj.value ?? obj.answer;
        if (left != null && right != null) {
          pairs.push({
            left: String(left).trim(),
            right: String(right).trim(),
          });
        }
        continue;
      }

      if (Array.isArray(item) && item.length >= 2) {
        pairs.push({
          left: String(item[0]).trim(),
          right: String(item[1]).trim(),
        });
      }
    }
    return pairs.filter((pair) => pair.left && pair.right);
  }

  if (typeof answer === "object") {
    return Object.entries(answer as Record<string, unknown>)
      .map(([left, right]) => ({
        left: String(left).trim(),
        right: String(right ?? "").trim(),
      }))
      .filter((pair) => pair.left && pair.right);
  }

  return [];
}

function coerceType(raw: unknown): QuestionType {
  const value = String(raw ?? "MCQ").toUpperCase() as QuestionType;
  return ALLOWED_TYPES.includes(value) ? value : "MCQ";
}

function coerceDomain(raw: unknown): QuestionDomain {
  const value = String(raw ?? "GENERAL").toUpperCase() as QuestionDomain;
  return ALLOWED_DOMAINS.includes(value) ? value : "GENERAL";
}

/**
 * Normalizes AI/manual question payloads so they satisfy Postgres check constraints
 * (e.g. matching_answer_check requires MATCHING answers as [{ left, right }, ...]).
 */
export function sanitizeQuestionForDb(input: {
  type?: unknown;
  question?: unknown;
  options?: unknown;
  answer?: unknown;
  topic?: unknown;
  domain?: unknown;
}): SanitizedQuestion | null {
  const question = String(input.question ?? "").trim();
  if (!question) return null;

  let type = coerceType(input.type);
  let options: string[] | null = asStringArray(input.options);
  let answer: SanitizedQuestion["answer"] =
    input.answer === undefined ? null : (input.answer as SanitizedQuestion["answer"]);

  if (type === "TRUE_FALSE") {
    options = ["True", "False"];
    if (typeof answer === "boolean") {
      // ok
    } else if (typeof answer === "string") {
      const lower = answer.toLowerCase();
      if (lower === "true") answer = true;
      else if (lower === "false") answer = false;
      else answer = null;
    } else {
      answer = null;
    }
  }

  if (type === "MCQ") {
    if (options.length < 2) {
      type = "SHORT_ANSWER";
      answer = typeof answer === "string" ? answer : null;
    } else if (typeof answer !== "string" || !options.includes(answer)) {
      answer =
        typeof answer === "string" && answer.trim()
          ? answer.trim()
          : options[0] ?? null;
    }
  }

  if (type === "FILL_IN_THE_BLANK") {
    const blanks = asStringArray(answer);
    if (!blanks.length) {
      if (typeof answer === "string" && answer.trim()) {
        answer = [answer.trim()];
      } else {
        type = "SHORT_ANSWER";
        answer = null;
      }
    } else {
      answer = blanks;
    }
  }

  if (type === "MATCHING") {
    const pairs = parseMatchingPairs(answer);
    if (!pairs.length) {
      if (options.length >= 2) {
        type = "MCQ";
        answer = options[0];
      } else {
        type = "SHORT_ANSWER";
        answer = typeof input.answer === "string" ? input.answer : null;
      }
    } else {
      answer = pairs;
      if (!options?.length) {
        options = pairs.map((pair) => pair.left);
      }
    }
  }

  if (type === "SHORT_ANSWER" || type === "LONG_ANSWER") {
    if (typeof answer !== "string") {
      answer =
        answer == null
          ? null
          : typeof answer === "boolean"
            ? answer
              ? "True"
              : "False"
            : JSON.stringify(answer);
    }
    options = null;
  }

  if (type === "MCQ" && (options?.length ?? 0) < 2) {
    type = "SHORT_ANSWER";
    options = null;
  }

  return {
    type,
    question,
    options: options?.length ? options : null,
    answer,
    topic: input.topic ? String(input.topic).trim() : null,
    domain: coerceDomain(input.domain),
  };
}

export function sanitizeQuestionsForDb(
  questions: Array<{
    type?: unknown;
    question?: unknown;
    options?: unknown;
    answer?: unknown;
    topic?: unknown;
    domain?: unknown;
  }>
): SanitizedQuestion[] {
  return questions
    .map((question) => sanitizeQuestionForDb(question))
    .filter((question): question is SanitizedQuestion => question !== null);
}
