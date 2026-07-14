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
const CHUNK_SIZE = 4_000;
const QUESTIONS_PER_CALL = 10;

/**
 * MAIN ENTRY
 * maxQuestions = MINIMUM number required
 */
export async function extractQuestions(
  text: string,
  allowedTypes: QuestionType[],
  maxQuestions: number
): Promise<Question[]> {
  if (!allowedTypes.length) {
    throw new Error("No question types provided");
  }

  const TARGET = Math.min(maxQuestions, HARD_CAP);
  const chunks = splitIntoChunks(text, CHUNK_SIZE);

  let questions: Question[] = [];

  // 1️⃣ FIRST: Extract from document
  for (const chunk of chunks) {
    if (questions.length >= TARGET) break;

    const remaining = TARGET - questions.length;
    const extracted = await extractFromChunk(
      chunk,
      allowedTypes,
      Math.min(remaining, QUESTIONS_PER_CALL)
    );

    questions.push(...extracted);
  }

  // 2️⃣ SECOND: Generate missing questions if needed
  if (questions.length < TARGET) {
    const missing = TARGET - questions.length;

    const generated = await generateAdditionalQuestions(
      text,
      allowedTypes,
      missing,
      questions
    );

    questions.push(...generated);
  }

  return questions.slice(0, TARGET).map((q, i) => ({
    ...q,
    number: i + 1
  }));
}

/* ---------------------------------- */
/* -------- EXTRACTION STEP ---------- */
/* ---------------------------------- */

async function extractFromChunk(
  text: string,
  allowedTypes: QuestionType[],
  maxQuestions: number
): Promise<Question[]> {
  const content = await cursorPrompt(`
Extract questions from the text.

Allowed types:
${allowedTypes.join(", ")}

Rules:
- Extract UP TO ${maxQuestions} questions
- Do NOT invent new content
- Do NOT repeat questions
- Assign ONE domain
- Do NOT use tools
- Output JSON only, no markdown fences
- MATCHING answers MUST be: [{ "left": "term", "right": "match" }, ...]
- FILL_IN_THE_BLANK answers MUST be: ["blank1", "blank2", ...]
- MCQ answer MUST be one of the options strings
- TRUE_FALSE answer MUST be boolean true or false

Return:
{
  "questions": [
    {
      "type": "MCQ" | "TRUE_FALSE" | "SHORT_ANSWER" | "LONG_ANSWER" | "FILL_IN_THE_BLANK" | "MATCHING",
      "question": string,
      "options": string[] | null,
      "answer": string | boolean | null,
      "topic": string | null,
      "domain": "${ALLOWED_DOMAINS.join('" | "')}"
    }
  ]
}

TEXT:
${text}
`);

  const raw = parseJsonResponse(content);

  return Array.isArray(raw.questions)
    ? raw.questions
        .map(normalizeQuestion)
        .filter((question): question is Question => question !== null)
    : [];
}

/* ---------------------------------- */
/* -------- GENERATION STEP ----------- */
/* ---------------------------------- */

async function generateAdditionalQuestions(
  sourceText: string,
  allowedTypes: QuestionType[],
  count: number,
  existing: Question[]
): Promise<Question[]> {
  const content = await cursorPrompt(`
Generate NEW exam questions based on the material.

Allowed types:
${allowedTypes.join(", ")}

Rules:
- Generate EXACTLY ${count} questions
- Do NOT repeat or rephrase existing questions
- Base questions on the concepts in the material
- Assign ONE domain
- Do NOT use tools
- Output JSON only, no markdown fences
- MATCHING answers MUST be: [{ "left": "term", "right": "match" }, ...]
- FILL_IN_THE_BLANK answers MUST be: ["blank1", "blank2", ...]
- MCQ answer MUST be one of the options strings
- TRUE_FALSE answer MUST be boolean true or false

Existing questions (DO NOT DUPLICATE):
${existing.map(q => `- ${q.question}`).join("\n")}

Return:
{
  "questions": [
    {
      "type": "MCQ" | "TRUE_FALSE" | "SHORT_ANSWER" | "LONG_ANSWER" | "FILL_IN_THE_BLANK" | "MATCHING",
      "question": string,
      "options": string[] | null,
      "answer": string | boolean | null,
      "topic": string | null,
      "domain": "${ALLOWED_DOMAINS.join('" | "')}"
    }
  ]
}

MATERIAL:
${sourceText.slice(0, 6_000)}
`);

  const raw = parseJsonResponse(content);

  return Array.isArray(raw.questions)
    ? raw.questions
        .map(normalizeQuestion)
        .filter((question): question is Question => question !== null)
    : [];
}

/* ---------------------------------- */
/* -------- NORMALIZATION ------------ */
/* ---------------------------------- */

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

/* ---------------------------------- */
/* -------- HELPERS ------------------ */
/* ---------------------------------- */

function splitIntoChunks(text: string, size: number): string[] {
  const chunks: string[] = [];
  let i = 0;

  while (i < text.length) {
    chunks.push(text.slice(i, i + size));
    i += size;
  }

  return chunks;
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
