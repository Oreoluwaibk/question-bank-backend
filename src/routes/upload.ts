import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  convertBufferToText,
  normalizeDisplayName,
} from "../controller/upload";
import { extractQuestions } from "../services/ai-question.service";
import { sanitizeQuestionsForDb } from "../lib/questionSanitizer";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";
import type { QuestionType } from "../types/question.types";
import { requireProSubscription } from "../services/subscriptionService";
import { subscriptionErrorResponse } from "../lib/subscriptionErrors";

const DEFAULT_UPLOAD_TYPES: QuestionType[] = ["MCQ"];
const DEFAULT_UPLOAD_COUNT = 20;

function parseQuestionTypes(value: unknown): QuestionType[] {
  if (!Array.isArray(value) || !value.length) {
    return DEFAULT_UPLOAD_TYPES;
  }

  const allowed: QuestionType[] = [
    "MCQ",
    "TRUE_FALSE",
    "SHORT_ANSWER",
    "LONG_ANSWER",
    "FILL_IN_THE_BLANK",
    "MATCHING"
  ];

  const parsed = value.filter((item): item is QuestionType =>
    typeof item === "string" && allowed.includes(item as QuestionType)
  );

  return parsed.length ? parsed : DEFAULT_UPLOAD_TYPES;
}

function parseQuestionCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isFinite(count)) return DEFAULT_UPLOAD_COUNT;
  return Math.min(200, Math.max(5, Math.floor(count)));
}

async function findMaterialByTitle(userId: string, title: string) {
  const { data, error } = await supabaseAdmin
    .from("materials")
    .select("id, title, question_count")
    .eq("user_id", userId)
    .eq("title", title)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

async function appendQuestionsToMaterial(
  material: { id: string; title: string; question_count?: number | null },
  addedCount: number
) {
  const { error } = await supabaseAdmin
    .from("materials")
    .update({
      question_count: (material.question_count ?? 0) + addedCount,
    })
    .eq("id", material.id);

  if (error) {
    throw new Error(error.message);
  }
}

async function resolveMaterialForUpload(
  userId: string,
  materialTitle: string,
  displayName: string,
  questionCount: number,
  appendToMaterialTitle?: string
): Promise<{
  material: { id: string; title: string };
  appended: boolean;
}> {
  const explicitAppend = Boolean(appendToMaterialTitle?.trim());
  const lookupTitle = appendToMaterialTitle?.trim() || materialTitle;

  const existingMaterial = await findMaterialByTitle(userId, lookupTitle);

  if (existingMaterial) {
    await appendQuestionsToMaterial(existingMaterial, questionCount);
    return { material: existingMaterial, appended: true };
  }

  if (explicitAppend) {
    throw new Error("MATERIAL_NOT_FOUND");
  }

  const { data: createdMaterial, error: materialError } = await supabaseAdmin
    .from("materials")
    .insert({
      user_id: userId,
      title: materialTitle,
      source_file: displayName,
      question_count: questionCount,
    })
    .select("id, title")
    .single();

  if (materialError) {
    if (materialError.code === "23505") {
      const racedMaterial = await findMaterialByTitle(userId, materialTitle);
      if (racedMaterial) {
        await appendQuestionsToMaterial(racedMaterial, questionCount);
        return { material: racedMaterial, appended: true };
      }
    }
    throw new Error(materialError.message || "Material could not be saved");
  }

  if (!createdMaterial) {
    throw new Error("Material could not be saved");
  }

  return { material: createdMaterial, appended: false };
}

async function processDocumentUpload(
  req: Request,
  res: Response,
  buffer: Buffer,
  rawFileName?: string,
  options?: {
    appendToMaterialTitle?: string;
    questionCount?: number;
    questionTypes?: QuestionType[];
  }
) {
  const userId = req.user!.id;
  const displayName = normalizeDisplayName(rawFileName);
  const questionTypes = options?.questionTypes ?? DEFAULT_UPLOAD_TYPES;
  const questionCount = options?.questionCount ?? DEFAULT_UPLOAD_COUNT;
  const appendToMaterialTitle = options?.appendToMaterialTitle?.trim();

  try {
    await requireProSubscription(userId);
  } catch (err) {
    const response = subscriptionErrorResponse(res, err);
    if (response) return response;
    return res.status(403).json({ error: "Subscription required" });
  }

  const { error, text } = await convertBufferToText(buffer, displayName);

  if (error) {
    if (error === "Unsupported file type") {
      return res.status(415).json({ error: "Unsupported file type" });
    }
    return res.status(500).json({ error: error || "Failed to extract text" });
  }

  if (!text.trim()) {
    return res.status(400).json({
      error: "No readable text found in document. Try a PDF with selectable text.",
    });
  }

  let extractedQuestions;
  try {
    extractedQuestions = await extractQuestions(
      text,
      questionTypes,
      questionCount
    );
  } catch (err) {
    console.error("Question extraction failed:", err);
    return res.status(502).json({
      error: "Failed to extract questions from document",
      details:
        err instanceof Error ? err.message : "Unknown extraction error",
    });
  }

  if (!Array.isArray(extractedQuestions) || extractedQuestions.length === 0) {
    return res.status(400).json({ error: "No questions extracted" });
  }

  const sanitizedQuestions = sanitizeQuestionsForDb(extractedQuestions);

  if (!sanitizedQuestions.length) {
    return res.status(400).json({
      error: "No valid questions could be saved (check answer formats)",
    });
  }

  let materialTitle = displayName.replace(/\.[^/.]+$/, "").trim();
  let material: { id: string; title: string };
  let appended = false;

  try {
    const resolved = await resolveMaterialForUpload(
      userId,
      materialTitle,
      displayName,
      sanitizedQuestions.length,
      appendToMaterialTitle
    );
    material = resolved.material;
    materialTitle = resolved.material.title;
    appended = resolved.appended;
  } catch (err) {
    if (err instanceof Error && err.message === "MATERIAL_NOT_FOUND") {
      return res.status(404).json({ error: "Material not found" });
    }
    return res.status(400).json({
      error: err instanceof Error ? err.message : "Material could not be saved",
    });
  }

  const rows = sanitizedQuestions.map((q) => ({
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
    message: appended
      ? "Questions added to material"
      : "Material uploaded and questions saved",
    material: {
      id: material.id,
      title: materialTitle,
    },
    questionCount: data.length,
    appended,
  });
}

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

router
  .get("/", async (_req: Request, res: Response) => {
    return res.status(200).send("You are ready to upload");
  })
  .post(
    "/document",
    requireAuth,
    async (req: Request, res: Response) => {
      const { fileName, data, appendToMaterialTitle, questionCount, questionTypes } =
        req.body as {
          fileName?: string;
          data?: string;
          appendToMaterialTitle?: string;
          questionCount?: number;
          questionTypes?: QuestionType[];
        };

      if (!data) {
        return res.status(400).json({ error: "No file data provided" });
      }

      try {
        const buffer = Buffer.from(data, "base64");
        return processDocumentUpload(req, res, buffer, fileName, {
          appendToMaterialTitle,
          questionCount: parseQuestionCount(questionCount),
          questionTypes: parseQuestionTypes(questionTypes),
        });
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
