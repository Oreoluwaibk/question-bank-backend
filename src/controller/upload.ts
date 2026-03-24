
import { Router, Request, Response } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import mammoth from "mammoth";
import { extractText , getDocumentProxy} from "unpdf";

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
async function extractPdfData(filePath: string) {
  const buffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(buffer);
  
  // Extract text
  const { text } = await extractText(uint8Array, { mergePages: true });
  
  // Extract metadata
  const pdf = await getDocumentProxy(uint8Array);
  const metadata = await pdf.getMetadata() as any;

  console.log("This is the pdf", pdf);
  
  
  return {
    text,
    fileName: metadata.info?.Title || path.basename(filePath),
    author: metadata.info?.Author || "Unknown",
    pageCount: pdf.numPages,
    length: text.length,
    creationDate: metadata.info?.CreationDate,
    modificationDate: metadata.info?.ModDate,
    producer: metadata.info?.Producer,
    creator: metadata.info?.Creator,
  };
}

/**
 * Extract text and metadata from DOCX using mammoth
 */
async function extractDocxData(filePath: string) {
  const result = await mammoth.extractRawText({ path: filePath });
  const stats = fs.statSync(filePath);
  
  // Note: mammoth doesn't extract metadata easily
  // You'd need additional libraries for full DOCX metadata
  return {
    text: result.value,
    fileName: path.basename(filePath),
    author: "Unknown", // DOCX metadata extraction requires additional setup
    length: result.value.length,
    fileSize: stats.size,
    createdDate: stats.birthtime,
    modifiedDate: stats.mtime,
  };
}

export async function handleConvertFileToText (file: any): Promise<{ text: string; error: any; }> {
    const { mimetype, path: filePath, originalname  } = file;
    console.log("This is the mime tyoe", mimetype, filePath);
    
    let text = "";
    let error = "";
    try {
        if (mimetype === "application/pdf") {
            text = await extractPdfText(filePath);
            console.log("Extracted PDF text");
            // const pdfData = await extractPdfData(filePath);
            // data = {
            //     ...pdfData,
            //     originalFileName: originalname,
            //     type: "pdf",
            // };
            // console.log("Extracted PDF data");
        } else if (mimetype.includes("wordprocessingml")) {
            const result = await mammoth.extractRawText({ path: filePath });
            text = result.value;

            console.log("the result", result);
            // const docxData = await extractDocxData(filePath);
            // data = {
            //     ...docxData,
            //     originalFileName: originalname,
            //     type: "docx",
            // };
            
        } else {
            return {
                text,
                error: "Unsupported file type",
            }
        }

        // console.log("uploaded file", data);

        return {
            text,
            error
        }
    } catch (error) {
        console.error("Error Converting doc to text:", error);
        error = error
        return {
            text,
            error
        }
    } finally {
        fs.unlink(filePath, () => {});
    }
}