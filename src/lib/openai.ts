import OpenAI from "openai";

/**
 * Singleton OpenAI client
 * Used across services (AI question extraction, etc.)
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
