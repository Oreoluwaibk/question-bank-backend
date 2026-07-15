import { Router, Request, Response } from "express";
import {
  createDeletionRequest,
  DELETION_INFO,
} from "../services/deletionRequestService";

const router = Router();

router.get("/info", (_req: Request, res: Response) => {
  res.json(DELETION_INFO);
});

router.post("/request", async (req: Request, res: Response) => {
  const { email, reason } = req.body as {
    email?: string;
    reason?: string;
  };

  if (!email?.trim()) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    const { request, alreadyPending } = await createDeletionRequest({
      email,
      reason,
      source: "web",
    });

    res.json({
      message: alreadyPending
        ? "A deletion request for this email is already pending review."
        : "Your account deletion request was submitted. We will process it within 30 days.",
      requestId: request.id,
      alreadyPending,
    });
  } catch (err) {
    res.status(400).json({
      error:
        err instanceof Error ? err.message : "Could not submit deletion request",
    });
  }
});

export default router;
