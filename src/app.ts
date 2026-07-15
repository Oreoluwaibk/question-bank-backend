import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import router from "./routes";
import { handlePaystackWebhook } from "./routes/subscription";

const app: Application = express();

app.use(cors());

app.post(
  "/api/subscription/webhook",
  express.raw({ type: "application/json" }),
  handlePaystackWebhook
);

app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/api/", router);
app.get("/", (_req, res) => {
  res.json({ message: "TypeScript backend running 🚀" });
});

app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

export default app;
