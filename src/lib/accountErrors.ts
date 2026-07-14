import type { Response } from "express";
import { AccountDeactivatedError } from "../services/accountService";

export function accountErrorResponse(res: Response, err: unknown) {
  if (err instanceof AccountDeactivatedError) {
    return res.status(403).json({
      error: err.message,
      code: err.code,
    });
  }

  return null;
}
