/**
 * Security utilities for the Gulp RSVP application
 */

/**
 * Sanitize user input to prevent XSS attacks
 * Escapes HTML special characters
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Validate that a string is a safe filename
 * Returns sanitized filename or null if invalid
 */
export function sanitizeFilename(filename: string): string | null {
  if (!filename || typeof filename !== "string") {
    return null;
  }

  // Remove path components (prevent directory traversal)
  const basename = filename.split(/[/\\]/).pop() || "";

  // Remove null bytes and control characters
  const cleaned = basename.replace(/[\x00-\x1f\x7f]/g, "");

  // Remove potentially dangerous characters
  const safe = cleaned.replace(/[<>:"|?*]/g, "");

  // Limit length
  const limited = safe.slice(0, 255);

  // Must have content after cleaning
  if (!limited || limited === "." || limited === "..") {
    return null;
  }

  return limited;
}

/**
 * Validate URL for SSRF protection
 * Returns validated URL or throws an error
 */
export function validateUrl(urlString: string): URL {
  const MAX_URL_LENGTH = 2048;

  // Blocked hosts (internal/private networks)
  const BLOCKED_PATTERNS = [
    /^localhost$/i,
    /^127\./,
    /^0\./,
    /^10\./,
    /^192\.168\./,
    /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
    /^169\.254\./,
    /^\[?::1\]?$/,
    /^metadata\.google/i,
    /\.internal$/i,
    /\.local$/i,
    /\.localhost$/i,
  ];

  if (!urlString || typeof urlString !== "string") {
    throw new Error("URL is required");
  }

  if (urlString.length > MAX_URL_LENGTH) {
    throw new Error("URL is too long");
  }

  let url: URL;
  try {
    url = new URL(urlString.trim());
  } catch {
    throw new Error("Invalid URL format");
  }

  // Only allow HTTP(S)
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  // Check against blocked patterns
  const hostname = url.hostname.toLowerCase();
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(hostname))) {
    throw new Error("This URL cannot be accessed");
  }

  return url;
}

/**
 * Generate a cryptographically secure random string
 */
export function generateSecureToken(length: number = 32): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Validate content type header
 */
export function validateContentType(
  contentType: string | null,
  expected: string[],
): boolean {
  if (!contentType) {
    return false;
  }
  const type = contentType.split(";")[0].trim().toLowerCase();
  return expected.some((e) => type === e || type.includes(e));
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

export const RATE_LIMITS: Record<string, RateLimitConfig> = {
  general: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 60, // 60 requests per minute
  },
  api: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 15, // 15 API requests per minute
  },
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5, // 5 attempts per 15 minutes
  },
};

/**
 * Allowed file types for upload
 */
export const ALLOWED_FILE_TYPES = {
  extensions: new Set([
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
  ]),
  mimeTypes: new Set([
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
  ]),
  maxSize: 20 * 1024 * 1024, // 20MB
};

/**
 * Validate file type
 */
export function isAllowedFileType(filename: string, mimeType: string): boolean {
  const ext = filename.toLowerCase().split(".").pop() || "";

  // Check extension
  if (!ALLOWED_FILE_TYPES.extensions.has(ext)) {
    return false;
  }

  // Check MIME type (allow empty/generic as browsers may not set them)
  if (
    mimeType &&
    mimeType !== "application/octet-stream" &&
    !ALLOWED_FILE_TYPES.mimeTypes.has(mimeType) &&
    !mimeType.startsWith("text/")
  ) {
    return false;
  }

  return true;
}

/**
 * Strip potentially dangerous content from text
 */
export function sanitizeText(text: string): string {
  // Remove null bytes
  return text.replace(/\0/g, "");
}

/**
 * Create a safe error message (don't leak internal details)
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    // List of safe error messages to pass through
    const safePatterns = [
      /^URL/i,
      /^File/i,
      /^Invalid/i,
      /^Missing/i,
      /^Unsupported/i,
      /^Too many/i,
      /^Content/i,
    ];

    if (safePatterns.some((pattern) => pattern.test(error.message))) {
      return error.message;
    }
  }

  return "An error occurred while processing your request";
}
