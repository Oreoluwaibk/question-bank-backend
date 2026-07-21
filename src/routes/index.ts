import { Router } from "express";
import uploadRouter from "./upload";
import authRouter from "./auth";
import questionRouter from "./questions";
import attemptRouter from "./attempts";
import analyticsRouter from "./analytics";
import subscriptionRouter from "./subscription";
import adminRouter from "./admin";
import legalRouter from "./legal";
import accountDeletionRouter from "./accountDeletion";
import versionRouter from "./version";

const router = Router();

router.use("/auth", authRouter);
router.use("/version", versionRouter);
router.use("/legal", legalRouter);
router.use("/account-deletion", accountDeletionRouter);
router.use("/admin", adminRouter);
router.use("/upload", uploadRouter);
router.use("/attempts", attemptRouter);
router.use("/questions", questionRouter);
router.use("/analytics", analyticsRouter);
router.use("/subscription", subscriptionRouter);

export default router;