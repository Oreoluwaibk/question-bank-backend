import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  convertBufferToText,
  normalizeDisplayName,
} from "../controller/upload";
import { extractQuestions } from "../services/ai-question.service";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";

const router = Router();

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({
  dest: uploadsDir,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

async function processDocumentUpload(
  req: Request,
  res: Response,
  buffer: Buffer,
  rawFileName?: string
) {
  const userId = req.user!.id;
  const displayName = normalizeDisplayName(rawFileName);

  const { data: subscription } = await supabaseAdmin
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (!subscription) {
    return res.status(403).json({ error: "Subscription not found" });
  }

  const { count: materialCount } = await supabaseAdmin
    .from("materials")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (materialCount! >= subscription.material_limit) {
    return res.status(403).json({
      error: "Material upload limit reached for your plan",
    });
  }

  const { error, text } = await convertBufferToText(buffer, displayName);

  if (error) {
    if (error === "Unsupported file type") {
      return res.status(415).json({ error: "Unsupported file type" });
    }
    return res.status(500).json({ error: error || "Failed to extract text" });
  }

  let extractedQuestions;
  try {
    extractedQuestions = await extractQuestions(text, ["MCQ"], 50);
  } catch {
    return res
      .status(502)
      .json({ error: "Failed to extract questions from document" });
  }

  if (!Array.isArray(extractedQuestions) || extractedQuestions.length === 0) {
    return res.status(400).json({ error: "No questions extracted" });
  }

  const materialTitle = displayName.replace(/\.[^/.]+$/, "").trim();

  const { data: material, error: materialError } = await supabaseAdmin
    .from("materials")
    .insert({
      user_id: userId,
      title: materialTitle,
      source_file: displayName,
      question_count: extractedQuestions.length,
    })
    .select()
    .single();

  if (materialError) {
    return res.status(400).json({
      error: materialError.message || "Material could not be saved",
    });
  }

  const rows = extractedQuestions.map((q) => ({
    creator_id: userId,
    material_id: material.id,
    material_title: materialTitle,
    type: q.type,
    question: q.question,
    options: q.options ?? null,
    answer: q.answer ?? null,
    topic: q.topic ?? null,
    domain: q.domain,
    language: "en",
    is_published: false,
  }));

  const { data, error: insertError } = await supabaseAdmin
    .from("questions")
    .insert(rows)
    .select();

  if (insertError) {
    return res.status(400).json({ error: insertError.message });
  }

  res.status(201).json({
    message: "Material uploaded and questions saved",
    material: {
      id: material.id,
      title: materialTitle,
    },
    questionCount: data.length,
  });
}

router
  .get("/", async (_req: Request, res: Response) => {
    return res.status(200).send("You are ready to upload");
  })
  .post(
    "/document",
    requireAuth,
    async (req: Request, res: Response) => {
      const { fileName, data } = req.body as {
        fileName?: string;
        data?: string;
      };

      if (!data) {
        return res.status(400).json({ error: "No file data provided" });
      }

      try {
        const buffer = Buffer.from(data, "base64");
        return processDocumentUpload(req, res, buffer, fileName);
      } catch {
        return res.status(400).json({ error: "Invalid file data" });
      }
    }
  )
  .post("/", requireAuth, upload.single("file"), async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const displayName = normalizeDisplayName(
      (req.body?.fileName as string | undefined) || req.file.originalname
    );

    try {
      const buffer = fs.readFileSync(req.file.path);
      return processDocumentUpload(req, res, buffer, displayName);
    } catch {
      return res.status(500).json({ error: "Failed to read uploaded file" });
    } finally {
      fs.unlink(req.file.path, () => {});
    }
  });

export default router;
