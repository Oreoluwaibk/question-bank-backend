import type { Response } from "express";
import { DeviceLimitError } from "../services/deviceSessionService";

export function deviceErrorResponse(res: Response, err: unknown) {
  if (err instanceof DeviceLimitError) {
    return res.status(403).json({
      error: err.message,
      code: err.code,
    });
  }

  return null;
}
