import { Router } from "express";
import uploadRouter from "./upload";
import authRouter from "./auth";
import questionRouter from "./questions";
import attemptRouter from "./attempts";
import analyticsRouter from "./analytics";
import subscriptionRouter from "./subscription";
import adminRouter from "./admin";

const router = Router();

router.use("/auth", authRouter);
router.use("/admin", adminRouter);
router.use("/upload", uploadRouter);
router.use("/attempts", attemptRouter);
router.use("/questions", questionRouter);
router.use("/analytics", analyticsRouter);
router.use("/subscription", subscriptionRouter);

export default router;