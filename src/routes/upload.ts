import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { extractText } from "unpdf";
import { handleConvertFileToText } from "../controller/upload";
import { extractQuestions } from "../services/ai-question.service";
import { requireAuth } from "../middlewares/auth";
import { supabaseAdmin } from "../services/supabaseAdmin";

const router = Router();

const upload = multer({
  dest: path.join(process.cwd(), "uploads"),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
});

/**
 * Extract text from PDF using unpdf
 */
async function extractPdfText(filePath: string): Promise<string> {
  const buffer = fs.readFileSync(filePath);
  // Convert Buffer to Uint8Array
  const uint8Array = new Uint8Array(buffer);
  const { text } = await extractText(uint8Array, { mergePages: true });
  return text;
}

router
.get("/", async (req: Request, res: Response) => {
    return res.status(200).send("You are ready to upload");
})
.post('/', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const userId = req.user!.id;

  /* -------------------------------------------------
   1️⃣ Load subscription
  -------------------------------------------------- */
  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (!subscription) {
    return res.status(403).json({ error: 'Subscription not found' });
  }

  /* -------------------------------------------------
   2️⃣ Enforce material limit
  -------------------------------------------------- */
  const { count: materialCount } = await supabaseAdmin
    .from('materials')
    .select('*', { count: 'exact', head: true })
    .eq('creator_id', userId);

  if (materialCount! >= subscription.material_limit) {
    return res.status(403).json({
      error: 'Material upload limit reached for your plan'
    });
  }

  /* -------------------------------------------------
   3️⃣ Convert file → text
  -------------------------------------------------- */
  const { error, text } = await handleConvertFileToText(req.file);

  if (error) {
    if (error === 'Unsupported file type') {
      return res.status(415).json({ error: 'Unsupported file type' });
    }
    return res.status(500).json({ error: 'Failed to extract text' });
  }

  /* -------------------------------------------------
   4️⃣ Extract questions
  -------------------------------------------------- */
  const extractedQuestions = await extractQuestions(text, ['MCQ'], 50);

  if (!Array.isArray(extractedQuestions) || extractedQuestions.length === 0) {
    return res.status(400).json({ error: 'No questions extracted' });
  }

  /* -------------------------------------------------
   5️⃣ Material title
  -------------------------------------------------- */
  const materialTitle = req.file.originalname
    .replace(/\.[^/.]+$/, '')
    .trim();

  /* -------------------------------------------------
   6️⃣ Save material record (once)
  -------------------------------------------------- */
  const { data: material, error: materialError } =
    await supabaseAdmin
      .from('materials')
      .insert({
        user_id: userId,
        title: materialTitle,
        source_file: req.file.originalname,
        question_count: extractedQuestions.length
      })
      .select()
      .single();

  if (materialError) {
    return res.status(400).json({
      error: materialError || 'Material already exists or could not be saved'
    });
  }

  /* -------------------------------------------------
   7️⃣ Map questions → DB rows
  -------------------------------------------------- */
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
    language: 'en',
    is_published: false
  }));

  /* -------------------------------------------------
   8️⃣ Insert questions
  -------------------------------------------------- */
  const { data, error: insertError } = await supabaseAdmin
    .from('questions')
    .insert(rows)
    .select();

  if (insertError) {
    return res.status(400).json({ error: insertError.message });
  }

  /* -------------------------------------------------
   9️⃣ Response
  -------------------------------------------------- */
  res.status(201).json({
    message: 'Material uploaded and questions saved',
    material: {
      id: material.id,
      title: materialTitle
    },
    questionCount: data.length
  });
});

// .post('/', requireAuth, upload.single('file'), async (req: Request, res: Response) => {
//     if (!req.file) {
//       return res.status(400).json({ error: 'No file uploaded' });
//     }

//     // 1. Convert file → text
//     const { error, text } = await handleConvertFileToText(req.file);

//     if (error) {
//       if (error === 'Unsupported file type') {
//         return res.status(415).json({ error: 'Unsupported file type' });
//       }
//       return res.status(500).json({ error: 'Failed to extract text' });
//     }

//     // 2. Extract questions from text
//     const extractedQuestions = await extractQuestions(text, ['MCQ'], 50);

//     if (!Array.isArray(extractedQuestions) || extractedQuestions.length === 0) {
//       return res.status(400).json({ error: 'No questions extracted' });
//     }

//     // 3. Build material title from file name
//     const materialTitle = req.file.originalname
//       .replace(/\.[^/.]+$/, '')
//       .trim();

//     // 4. Map extracted questions → DB rows
//     const rows = extractedQuestions.map((q) => ({
//       creator_id: req.user!.id,
//       material_title: materialTitle,
//       type: q.type,
//       question: q.question,
//       options: q.options ?? null,
//       answer: q.answer ?? null,
//       topic: q.topic ?? null,
//       domain: q.domain,
//       language: 'en',
//       is_published: false
//     }));

//     // 5. Insert into DB (bulk)
//     const { data, error: insertError } = await supabaseAdmin
//       .from('questions')
//       .insert(rows)
//       .select();

//     if (insertError) {
//       return res.status(400).json({
//         error: insertError.message
//       });
//     }

//     // 6. Response
//     res.status(201).json({
//       message: 'Questions extracted and saved successfully',
//       materialTitle,
//       count: data.length,
//       questions: data
//     });
//   }
// );


export default router;