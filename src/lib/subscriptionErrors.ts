import type { Response } from "express";

export function subscriptionErrorResponse(res: Response, err: unknown) {
  const code =
    err instanceof Error && "code" in err
      ? String((err as Error & { code?: string }).code)
      : undefined;

  if (code === "SUBSCRIPTION_REQUIRED") {
    return res.status(403).json({
      error:
        err instanceof Error
          ? err.message
          : "Subscribe to Pro to use this feature",
      code: "SUBSCRIPTION_REQUIRED",
    });
  }

  return null;
}
