import { cursorPrompt } from "../lib/cursor";
import {
  sanitizeQuestionForDb,
  type SanitizedQuestion,
} from "../lib/questionSanitizer";
import {
  Question,
  QuestionType,
  QuestionDomain
} from "../types/question.types";

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
  "GENERAL"
];

const HARD_CAP = 200;
/** Keep prompts small — one model call handles the full batch. */
const SOURCE_TEXT_BUDGET = 14_000;
const MAX_AI_CALLS = 2;

/**
 * MAIN ENTRY
 * maxQuestions = target number of questions to return
 */
export async function extractQuestions(
  text: string,
  allowedTypes: QuestionType[],
  maxQuestions: number
): Promise<Question[]> {
  if (!allowedTypes.length) {
    throw new Error("No question types provided");
  }

  const target = Math.min(maxQuestions, HARD_CAP);
  const sourceText = prepareSourceText(text, SOURCE_TEXT_BUDGET);
  let questions: Question[] = [];

  for (let call = 0; call < MAX_AI_CALLS && questions.length < target; call++) {
    const remaining = target - questions.length;
    const batch = await requestQuestions(
      sourceText,
      allowedTypes,
      remaining,
      questions
    );

    questions = dedupeQuestions([...questions, ...batch]);
  }

  return questions.slice(0, target).map((q, i) => ({
    ...q,
    number: i + 1
  }));
}

async function requestQuestions(
  sourceText: string,
  allowedTypes: QuestionType[],
  count: number,
  existing: Question[]
): Promise<Question[]> {
  const avoidList =
    existing.length > 0
      ? `\nDo not repeat or rephrase these:\n${existing
          .slice(-20)
          .map((q) => `- ${q.question}`)
          .join("\n")}`
      : "";

  const content = await cursorPrompt(`
Create exactly ${count} practice questions from the study material.

Allowed types: ${allowedTypes.join(", ")}

Output rules:
- Return JSON only (no markdown fences)
- Do NOT use tools
- Base questions on the material below
- MCQ: 4 options, answer must equal one option string
- TRUE_FALSE: answer must be boolean
- FILL_IN_THE_BLANK: answer is string[]
- MATCHING: answer is [{ "left": "...", "right": "..." }, ...]
- Assign one domain from: ${ALLOWED_DOMAINS.join(", ")}
${avoidList}

Schema:
{"questions":[{"type":"MCQ","question":"...","options":["A","B","C","D"],"answer":"A","topic":"...","domain":"GENERAL"}]}

MATERIAL:
${sourceText}
`);

  const raw = parseJsonResponse(content);

  return Array.isArray(raw.questions)
    ? raw.questions
        .map(normalizeQuestion)
        .filter((question): question is Question => question !== null)
    : [];
}

function prepareSourceText(text: string, maxLength: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  const slice = trimmed.slice(0, maxLength);
  const lastBreak = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("\n"),
    slice.lastIndexOf(" ")
  );

  if (lastBreak > maxLength * 0.7) {
    return slice.slice(0, lastBreak).trim();
  }

  return slice.trim();
}

function dedupeQuestions(questions: Question[]): Question[] {
  const seen = new Set<string>();
  const result: Question[] = [];

  for (const question of questions) {
    const key = question.question.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(question);
  }

  return result;
}

function normalizeQuestion(q: any): Question | null {
  const sanitized = sanitizeQuestionForDb(q);
  if (!sanitized) return null;
  return toQuestion(sanitized);
}

function toQuestion(sanitized: SanitizedQuestion): Question {
  return {
    number: 0,
    type: sanitized.type,
    question: sanitized.question,
    options: sanitized.options,
    answer: sanitized.answer as Question["answer"],
    topic: sanitized.topic,
    domain: sanitized.domain,
  };
}

function parseJsonResponse(content: string | null | undefined): { questions?: unknown[] } {
  const trimmed = (content ?? "").trim();
  if (!trimmed) return {};

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch {
        return {};
      }
    }
    return {};
  }
}
