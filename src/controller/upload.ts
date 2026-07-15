import fs from "fs";
import os from "os";
import path from "path";
import mammoth from "mammoth";
import { extractText } from "unpdf";

export const UNSUPPORTED_DOCUMENT_MESSAGE =
  "Only PDF and DOCX files are supported. Images, videos, and audio are not allowed.";

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString("utf8") === "%PDF";
}

function isDocxBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

export type DocumentKind = "pdf" | "docx";

export function detectDocumentKind(
  buffer: Buffer,
  displayName: string
): DocumentKind | null {
  const ext = path.extname(displayName).toLowerCase();

  if (ext !== ".pdf" && ext !== ".docx") {
    return null;
  }

  if (ext === ".pdf") {
    return isPdfBuffer(buffer) ? "pdf" : null;
  }

  return isDocxBuffer(buffer) && !isPdfBuffer(buffer) ? "docx" : null;
}

export function normalizeDisplayName(name?: string): string {
  const raw = name?.trim() || "document.pdf";
  if (/\.(pdf|docx)$/i.test(raw)) {
    return raw;
  }
  return raw;
}

export async function convertBufferToText(
  buffer: Buffer,
  displayName: string
): Promise<{ text: string; error: string }> {
  if (!buffer.length) {
    return { text: "", error: "Uploaded file is empty" };
  }

  const kind = detectDocumentKind(buffer, displayName);
  if (!kind) {
    return { text: "", error: UNSUPPORTED_DOCUMENT_MESSAGE };
  }

  const tmpPath = path.join(
    os.tmpdir(),
    `qb-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.writeFileSync(tmpPath, buffer);

    if (kind === "pdf") {
      const uint8Array = new Uint8Array(buffer);
      const { text } = await extractText(uint8Array, { mergePages: true });
      return { text, error: "" };
    }

    const result = await mammoth.extractRawText({ path: tmpPath });
    return { text: result.value, error: "" };
  } catch (err) {
    console.error("Error converting document to text:", err);
    return { text: "", error: "Failed to extract text" };
  } finally {
    fs.unlink(tmpPath, () => {});
  }
}

export async function handleConvertFileToText(
  file: Express.Multer.File & { displayName?: string }
): Promise<{ text: string; error: string }> {
  const originalname = normalizeDisplayName(
    file.displayName || file.originalname
  );
  const buffer = fs.readFileSync(file.path);
  return convertBufferToText(buffer, originalname);
}
