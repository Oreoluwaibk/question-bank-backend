import { Agent, CursorAgentError, type SDKAgent } from "@cursor/sdk";

const DEFAULT_MODEL = "composer-2.5";
const MAX_ATTEMPTS = 3;
const PROMPT_TIMEOUT_MS = 180_000;

let sharedAgent: SDKAgent | null = null;
let sharedAgentKey: string | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSharedAgent(apiKey: string): Promise<SDKAgent> {
  if (sharedAgent && sharedAgentKey === apiKey) {
    return sharedAgent;
  }

  if (sharedAgent) {
    await sharedAgent[Symbol.asyncDispose]().catch(() => undefined);
    sharedAgent = null;
    sharedAgentKey = null;
  }

  sharedAgent = await Agent.create({
    apiKey,
    model: { id: DEFAULT_MODEL },
    local: {
      cwd: process.cwd(),
      autoReview: false,
    },
  });
  sharedAgentKey = apiKey;

  return sharedAgent;
}

async function runPrompt(prompt: string, apiKey: string): Promise<string> {
  const agent = await getSharedAgent(apiKey);

  const result = await Promise.race([
    (async () => {
      const run = await agent.send(prompt);
      const finished = await run.wait();
      if (finished.status === "error") {
        throw new Error(`Cursor agent run failed (${finished.id})`);
      }
      if (finished.status === "cancelled") {
        throw new Error(`Cursor agent run cancelled (${finished.id})`);
      }
      return finished.result ?? "";
    })(),
    new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`Cursor prompt timed out after ${PROMPT_TIMEOUT_MS}ms`)
          ),
        PROMPT_TIMEOUT_MS
      );
    }),
  ]);

  return result;
}

/**
 * One-shot Cursor agent prompt. Reuses a shared local agent between calls.
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

      if (sharedAgent) {
        await sharedAgent[Symbol.asyncDispose]().catch(() => undefined);
        sharedAgent = null;
        sharedAgentKey = null;
      }

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
