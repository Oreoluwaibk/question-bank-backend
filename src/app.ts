import express, { Application } from "express";
import router from "./routes";


const app: Application = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/', router);
app.get("/", (req, res) => {
  res.json({ message: "TypeScript backend running 🚀" });
});

export default app;
