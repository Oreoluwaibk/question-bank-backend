import { Agent, CursorAgentError } from "@cursor/sdk";

const DEFAULT_MODEL = "composer-2.5";
const MAX_ATTEMPTS = 3;
const PROMPT_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runPrompt(prompt: string, apiKey: string): Promise<string> {
  const result = await Promise.race([
    Agent.prompt(prompt, {
      apiKey,
      model: { id: DEFAULT_MODEL },
      local: {
        cwd: process.cwd(),
        autoReview: false,
      },
    }),
    new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error(`Cursor prompt timed out after ${PROMPT_TIMEOUT_MS}ms`)),
        PROMPT_TIMEOUT_MS
      );
    }),
  ]);

  if (result.status === "error") {
    throw new Error(`Cursor agent run failed (${result.id})`);
  }

  if (result.status === "cancelled") {
    throw new Error(`Cursor agent run cancelled (${result.id})`);
  }

  return result.result ?? "";
}

/**
 * One-shot Cursor agent prompt. Returns the final assistant text.
 */
export async function cursorPrompt(prompt: string): Promise<string> {
  const apiKey = process.env.CURSOR_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("CURSOR_API_KEY is not set");
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await runPrompt(prompt, apiKey);
    } catch (err) {
      lastError = err;

      if (err instanceof CursorAgentError && !err.isRetryable) {
        throw new Error(`Cursor API error: ${err.message}`);
      }

      if (attempt < MAX_ATTEMPTS) {
        await sleep(attempt * 2_000);
      }
    }
  }

  if (lastError instanceof CursorAgentError) {
    throw new Error(`Cursor API error: ${lastError.message}`);
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error("Cursor prompt failed");
}
