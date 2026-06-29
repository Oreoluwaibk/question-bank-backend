import express, { Application, NextFunction, Request, Response } from "express";
import cors from "cors";
import router from "./routes";

const app: Application = express();

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use("/api/", router);
app.get("/", (_req, res) => {
  res.json({ message: "TypeScript backend running 🚀" });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

export default app;
