import { openai } from "../lib/openai";
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
      remaining
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
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Extract questions from the text.

Allowed types:
${allowedTypes.join(", ")}

Rules:
- Extract UP TO ${maxQuestions} questions
- Do NOT invent new content
- Do NOT repeat questions
- Assign ONE domain
- Output JSON only

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
`
      },
      { role: "user", content: text }
    ]
  });

  const raw = parseJsonResponse(response.choices[0].message.content);

  return Array.isArray(raw.questions)
    ? raw.questions.map(normalizeQuestion)
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
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `
Generate NEW exam questions based on the material.

Allowed types:
${allowedTypes.join(", ")}

Rules:
- Generate EXACTLY ${count} questions
- Do NOT repeat or rephrase existing questions
- Base questions on the concepts in the material
- Assign ONE domain
- Output JSON only

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
`
      },
      { role: "user", content: sourceText.slice(0, 6_000) }
    ]
  });

  const raw = parseJsonResponse(response.choices[0].message.content);

  return Array.isArray(raw.questions)
    ? raw.questions.map(normalizeQuestion)
    : [];
}

/* ---------------------------------- */
/* -------- NORMALIZATION ------------ */
/* ---------------------------------- */

function normalizeQuestion(q: any): Question {
  const domain: QuestionDomain = ALLOWED_DOMAINS.includes(q.domain)
    ? q.domain
    : "GENERAL";

  let options: string[] | null = q.options ?? null;
  let answer = q.answer ?? null;

  if (q.type === "TRUE_FALSE") {
    options = ["True", "False"];
    if (typeof answer !== "boolean") answer = null;
  }

  if (q.type === "MCQ" && (!Array.isArray(options) || options.length < 3)) {
    options = null;
  }

  return {
    number: 0, // reassigned later
    type: q.type,
    question: String(q.question).trim(),
    options,
    answer,
    topic: q.topic ?? null,
    domain
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
  try {
    return JSON.parse(content ?? "{}");
  } catch {
    return {};
  }
}
