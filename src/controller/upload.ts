import fs from "fs";
import os from "os";
import path from "path";
import mammoth from "mammoth";
import { extractText } from "unpdf";

function isPdfBuffer(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer.subarray(0, 4).toString("utf8") === "%PDF";
}

function isDocxBuffer(buffer: Buffer): boolean {
  return buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function resolveMimeType(
  mimetype: string,
  originalname: string,
  buffer?: Buffer
): string {
  const ext = path.extname(originalname).toLowerCase();
  const mime = (mimetype ?? "").toLowerCase();

  if (
    mime === "application/pdf" ||
    mime === "application/x-pdf" ||
    mime.includes("pdf") ||
    ext === ".pdf" ||
    (buffer && isPdfBuffer(buffer))
  ) {
    return "application/pdf";
  }

  if (
    mime.includes("wordprocessingml") ||
    ext === ".docx" ||
    (buffer && isDocxBuffer(buffer) && !isPdfBuffer(buffer))
  ) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }

  return mimetype;
}

export function normalizeDisplayName(name?: string): string {
  const raw = name?.trim() || "document.pdf";
  if (/\.(pdf|docx)$/i.test(raw)) return raw;
  return `${raw}.pdf`;
}

export async function convertBufferToText(
  buffer: Buffer,
  displayName: string
): Promise<{ text: string; error: string }> {
  if (!buffer.length) {
    return { text: "", error: "Uploaded file is empty" };
  }

  const resolvedMime = resolveMimeType("", displayName, buffer);
  const tmpPath = path.join(
    os.tmpdir(),
    `qb-${Date.now()}-${Math.random().toString(36).slice(2)}`
  );

  try {
    fs.writeFileSync(tmpPath, buffer);

    if (resolvedMime === "application/pdf" || isPdfBuffer(buffer)) {
      const uint8Array = new Uint8Array(buffer);
      const { text } = await extractText(uint8Array, { mergePages: true });
      return { text, error: "" };
    }

    if (resolvedMime.includes("wordprocessingml") || isDocxBuffer(buffer)) {
      const result = await mammoth.extractRawText({ path: tmpPath });
      return { text: result.value, error: "" };
    }

    return { text: "", error: "Unsupported file type" };
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
