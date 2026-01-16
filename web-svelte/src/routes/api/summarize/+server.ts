import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import OpenAI from "openai";
import { OPENAI_API_KEY } from "$env/static/private";

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// Security limits
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_FILENAME_LENGTH = 255;

// Allowed file extensions (whitelist)
const ALLOWED_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "html",
  "htm",
  "pdf",
  "docx",
  "csv",
  "json",
  "xml",
  "yaml",
  "yml",
  "log",
  "rst",
  "tex",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
]);

// Allowed MIME types (whitelist)
const ALLOWED_MIME_TYPES = new Set([
  "text/plain",
  "text/markdown",
  "text/html",
  "text/csv",
  "text/xml",
  "application/json",
  "application/xml",
  "application/pdf",
  "application/rtf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

/**
 * Sanitize filename to prevent path traversal and other attacks
 */
function sanitizeFilename(filename: string): string {
  // Remove path components
  const basename = filename.split(/[/\\]/).pop() || "file";
  // Remove null bytes and control characters
  const cleaned = basename.replace(/[\x00-\x1f\x7f]/g, "");
  // Limit length
  return cleaned.slice(0, MAX_FILENAME_LENGTH);
}

/**
 * Validate file extension and MIME type
 */
function validateFileType(
  filename: string,
  mimeType: string,
): { valid: boolean; ext: string } {
  const ext = filename.toLowerCase().split(".").pop() || "";

  // Check extension whitelist
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return { valid: false, ext };
  }

  // Check MIME type whitelist (allow empty/generic types as browsers may not set them)
  if (
    mimeType &&
    mimeType !== "application/octet-stream" &&
    !ALLOWED_MIME_TYPES.has(mimeType) &&
    !mimeType.startsWith("text/")
  ) {
    return { valid: false, ext };
  }

  return { valid: true, ext };
}

/**
 * POST /api/summarize
 * Accepts file uploads and sends to OpenAI for processing.
 * Supports PDF, images, and text documents.
 *
 * Request: multipart/form-data with 'file' field
 * Response: { text: string, filename?: string }
 */
export const POST: RequestHandler = async ({ request }) => {
  const contentType = request.headers.get("content-type") || "";

  let filename: string;
  let fileBuffer: ArrayBuffer;
  let mimeType: string;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      throw error(400, "No file provided");
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      throw error(413, "File too large. Maximum size is 20MB.");
    }

    if (file.size === 0) {
      throw error(400, "File is empty");
    }

    // Sanitize filename
    filename = sanitizeFilename(file.name);
    if (!filename || filename === ".") {
      throw error(400, "Invalid filename");
    }

    mimeType = file.type || getMimeType(filename);

    // Validate file type
    const validation = validateFileType(filename, mimeType);
    if (!validation.valid) {
      throw error(
        415,
        `Unsupported file type: ${validation.ext || mimeType}. Allowed: PDF, DOCX, TXT, MD, HTML, images.`,
      );
    }

    fileBuffer = await file.arrayBuffer();
  } else {
    throw error(400, "Invalid content type. Use multipart/form-data");
  }

  const ext = filename?.toLowerCase().split(".").pop() || "";

  // Handle based on file type
  let processedText: string;

  try {
    if (mimeType === "application/pdf" || ext === "pdf") {
      // Use OpenAI with PDF support
      processedText = await processWithOpenAI(fileBuffer, mimeType, filename);
    } else if (
      mimeType.startsWith("image/") ||
      ["png", "jpg", "jpeg", "gif", "webp"].includes(ext)
    ) {
      // Use OpenAI vision for images
      processedText = await processImageWithOpenAI(fileBuffer, mimeType);
    } else if (
      mimeType.startsWith("text/") ||
      [
        "txt",
        "md",
        "markdown",
        "html",
        "htm",
        "csv",
        "json",
        "xml",
        "yaml",
        "yml",
        "log",
        "rst",
        "tex",
        "rtf",
      ].includes(ext)
    ) {
      // Text files - decode and process
      const text = new TextDecoder().decode(fileBuffer);
      processedText = await processTextWithOpenAI(text);
    } else if (
      mimeType ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      // DOCX - send to OpenAI as file
      processedText = await processWithOpenAI(fileBuffer, mimeType, filename);
    } else {
      // Try to process as text, let OpenAI figure it out
      const text = new TextDecoder().decode(fileBuffer);
      if (text && text.length > 50 && !containsBinaryData(text)) {
        processedText = await processTextWithOpenAI(text);
      } else {
        throw error(
          415,
          `Unsupported file format: ${ext || mimeType}. Try PDF, DOCX, TXT, MD, HTML, or images.`,
        );
      }
    }
  } catch (err) {
    console.error("File processing failed:", err);
    if (err && typeof err === "object" && "status" in err) {
      throw err;
    }
    throw error(500, "Failed to process file");
  }

  if (!processedText || processedText.trim().length < 20) {
    throw error(422, "Could not extract meaningful content from the document.");
  }

  return json({
    text: processedText,
    ...(filename && { filename }),
  });
};

/**
 * Process PDF/documents with OpenAI file input
 */
async function processWithOpenAI(
  buffer: ArrayBuffer,
  mimeType: string,
  filename?: string,
): Promise<string> {
  const base64 = Buffer.from(buffer).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `You are a text processor for a speed-reading app. Your job is to extract and condense document content into clean, readable paragraphs optimized for rapid serial visual presentation (RSVP).

Rules:
- Extract all the main readable text content from the document
- Remove any markup, formatting artifacts, headers, footers, or metadata
- Remove redundant information and filler content
- Keep the essential narrative, key facts, and important details
- Preserve direct quotes if they're important
- Aim for roughly 40-60% of original length for long documents
- For shorter documents, preserve more content

Output rules:
- Use plain text only, no markdown formatting
- Separate paragraphs with double newlines
- Do not add any commentary, headers, or labels
- Start directly with the content

If the content appears to be garbage or meaningless, return an empty string.`,
      },
      {
        role: "user",
        content: [
          {
            type: "file",
            file: {
              filename: filename || "document",
              file_data: dataUrl,
            },
          },
          {
            type: "text",
            text: "Extract and summarize the content of this document for speed reading.",
          },
        ],
      },
    ],
    max_tokens: 8000,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

/**
 * Process images with OpenAI vision
 */
async function processImageWithOpenAI(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  const base64 = Buffer.from(buffer).toString("base64");
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const response = await openai.chat.completions.create({
    model: "gpt-4.1-mini",
    messages: [
      {
        role: "system",
        content: `You are a text processor for a speed-reading app. Extract any text visible in the image (OCR) and describe the key content. Format as clean, readable paragraphs for rapid serial visual presentation.

Output rules:
- Use plain text only, no markdown formatting
- Separate paragraphs with double newlines
- Start directly with the content`,
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: {
              url: dataUrl,
            },
          },
          {
            type: "text",
            text: "Extract and describe all text and key content from this image.",
          },
        ],
      },
    ],
    max_tokens: 4000,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

/**
 * Process plain text with OpenAI
 */
async function processTextWithOpenAI(text: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4.1-nano",
    messages: [
      {
        role: "system",
        content: `You are a text processor for a speed-reading app. Your job is to condense document content into clean, readable paragraphs optimized for rapid serial visual presentation (RSVP).

Rules:
- Remove any markup, code, formatting artifacts, or metadata
- Remove redundant information and filler content
- Keep the essential narrative, key facts, and important details
- Preserve direct quotes if they're important
- Aim for roughly 40-60% of original length for long documents
- For shorter documents, preserve more content

Output rules:
- Use plain text only, no markdown formatting
- Separate paragraphs with double newlines
- Do not add any commentary, headers, or labels
- Start directly with the content

If the content appears to be garbage or meaningless, return an empty string.`,
      },
      {
        role: "user",
        content: text.slice(0, 100000),
      },
    ],
    max_tokens: 8000,
  });

  return response.choices[0]?.message?.content?.trim() || "";
}

/**
 * Get MIME type from filename
 */
function getMimeType(filename: string): string {
  const ext = filename.toLowerCase().split(".").pop() || "";
  const mimeTypes: Record<string, string> = {
    pdf: "application/pdf",
    txt: "text/plain",
    md: "text/markdown",
    html: "text/html",
    htm: "text/html",
    csv: "text/csv",
    json: "application/json",
    xml: "application/xml",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    doc: "application/msword",
    rtf: "application/rtf",
  };
  return mimeTypes[ext] || "application/octet-stream";
}

/**
 * Check if text contains binary data
 */
function containsBinaryData(text: string): boolean {
  // Check for null bytes or high concentration of non-printable characters
  let nonPrintable = 0;
  const sample = text.slice(0, 1000);
  for (let i = 0; i < sample.length; i++) {
    const code = sample.charCodeAt(i);
    if (code === 0 || (code < 32 && code !== 9 && code !== 10 && code !== 13)) {
      nonPrintable++;
    }
  }
  return nonPrintable / sample.length > 0.1;
}
