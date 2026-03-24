/**
 * Question types allowed in the system
 * Controlled by frontend & enforced by backend
 */
export type QuestionType =
  | "MCQ"
  | "TRUE_FALSE"
  | "SHORT_ANSWER"
  | "LONG_ANSWER"
  | "FILL_IN_THE_BLANK"
  | "MATCHING";

/**
 * Final normalized question
 * Safe to store in DB or return to frontend
 */
// export interface Question {
//   number: number;
//   type: QuestionType;
//   question: string;
//   options: string[] | null;
//   answer: string | boolean | null;
//   topic: string | null;
// }

/**
 * Raw AI output shape (before normalization)
 * NEVER store this directly
 */
export interface AIQuestionRaw {
  number: number;
  type: QuestionType;
  question: unknown;
  options?: unknown;
  answer?: unknown;
  topic?: unknown;
}

/**
 * Request payload from frontend
 */
export interface ExtractQuestionsRequest {
  questionTypes: QuestionType[];
  maxQuestions?: number;
}


export type QuestionDomain =
  | "SCIENCE"
  | "TECHNOLOGY"
  | "ENGINEERING"
  | "MATHEMATICS"
  | "MEDICINE"
  | "LAW"
  | "BUSINESS"
  | "ECONOMICS"
  | "EDUCATION"
  | "HISTORY"
  | "GEOGRAPHY"
  | "POLITICS"
  | "RELIGION"
  | "PHILOSOPHY"
  | "PSYCHOLOGY"
  | "SOCIOLOGY"
  | "ETHICS"
  | "ENVIRONMENT"
  | "ART"
  | "LANGUAGE"
  | "DAILY_LIFE"
  | "GENERAL";


export interface Question {
  number: number;
  type: QuestionType;
  question: string;
  options: string[] | null;
  answer: string | boolean | null;
  topic: string | null;
  domain: QuestionDomain;
}

export type CreateQuestionInput = {
  materialTitle: string;
  type: QuestionType;
  question: string;
  options?: any[] | null;
  answer?: any;
  topic?: string | null;
  domain: QuestionDomain;
  language?: string;
  isPublished?: boolean;
};
