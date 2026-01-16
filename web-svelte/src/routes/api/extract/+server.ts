import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import Firecrawl from "@mendable/firecrawl-js";
import Groq from "groq-sdk";
import { FIRECRAWL_API_KEY, GROQ_API_KEY } from "$env/static/private";

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });
const groq = new Groq({ apiKey: GROQ_API_KEY });

// Maximum URL length to prevent abuse
const MAX_URL_LENGTH = 2048;

// Blocked hosts (internal/private networks, localhost, etc.)
const BLOCKED_HOSTS = [
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
  "169.254.", // Link-local
  "10.", // Private class A
  "192.168.", // Private class C
  "172.16.",
  "172.17.",
  "172.18.",
  "172.19.", // Private class B
  "172.20.",
  "172.21.",
  "172.22.",
  "172.23.",
  "172.24.",
  "172.25.",
  "172.26.",
  "172.27.",
  "172.28.",
  "172.29.",
  "172.30.",
  "172.31.",
  "metadata.google", // Cloud metadata
  "169.254.169.254", // AWS/GCP metadata
  ".internal",
  ".local",
];

/**
 * Check if a hostname is blocked (internal/private)
 */
function isBlockedHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return BLOCKED_HOSTS.some(
    (blocked) =>
      lower === blocked || lower.startsWith(blocked) || lower.endsWith(blocked),
  );
}

/**
 * Validate and sanitize URL
 */
function validateUrl(urlString: string): URL {
  // Check length
  if (urlString.length > MAX_URL_LENGTH) {
    throw new Error("URL is too long");
  }

  // Parse URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString.trim());
  } catch {
    throw new Error("Invalid URL format");
  }

  // Check protocol
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only HTTP and HTTPS URLs are allowed");
  }

  // Check for blocked hosts (SSRF protection)
  if (isBlockedHost(parsedUrl.hostname)) {
    throw new Error("This URL cannot be accessed");
  }

  // Check for IP addresses that might bypass hostname checks
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(parsedUrl.hostname)) {
    const parts = parsedUrl.hostname.split(".").map(Number);
    // Block private IP ranges
    if (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    ) {
      throw new Error("This URL cannot be accessed");
    }
  }

  return parsedUrl;
}

/**
 * POST /api/extract
 * Extracts clean paragraph text from a URL using Firecrawl,
 * then sanitizes with Groq for fast, clean RSVP-ready text.
 *
 * Request body: { url: string }
 * Response: { text: string, sourceUrl: string, title?: string }
 */
export const POST: RequestHandler = async ({ request }) => {
  // Validate content type
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    throw error(400, "Content-Type must be application/json");
  }

  let body: { url?: string };

  try {
    body = await request.json();
  } catch {
    throw error(400, "Invalid JSON body");
  }

  const { url } = body;

  if (!url || typeof url !== "string") {
    throw error(400, 'Missing or invalid "url" field');
  }

  // Validate and sanitize URL
  let validatedUrl: URL;
  try {
    validatedUrl = validateUrl(url);
  } catch (err) {
    throw error(400, err instanceof Error ? err.message : "Invalid URL");
  }

  // Step 1: Extract content using Firecrawl
  let rawContent: string;
  let title: string | undefined;

  try {
    const scrapeResult = await firecrawl.scrape(validatedUrl.toString(), {
      formats: ["markdown"],
      onlyMainContent: true,
    });

    if (!scrapeResult.markdown) {
      throw new Error("Firecrawl returned no content");
    }

    rawContent = scrapeResult.markdown;
    title = scrapeResult.metadata?.title;
  } catch (err) {
    console.error("Firecrawl extraction failed:", err);
    throw error(
      502,
      "Failed to extract content from URL. The page may be unavailable or blocked.",
    );
  }

  // Step 2: Sanitize with Groq (fast inference)
  let cleanedText: string;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are a text processor for a speed-reading app. Your job is to extract and condense webpage content into clean, readable paragraphs optimized for rapid serial visual presentation (RSVP).

Rules:
- Remove all navigation, headers, footers, ads, and boilerplate
- Remove image captions, alt text, and media references
- Remove social sharing text, comments sections, related articles
- Remove author bios, publication dates, tags, categories

For NEWS ARTICLES and BLOG POSTS:
- Condense to the essential narrative and key facts
- Remove repetitive information and filler content
- Keep direct quotes if they're important
- Aim for roughly 40-60% of original length
- Preserve the story arc: setup, key points, conclusion

For OTHER CONTENT (documentation, essays, tutorials):
- Keep more of the original text
- Remove only obvious fluff and repetition
- Preserve technical details and explanations

Output rules:
- Use plain text only, no markdown formatting
- Separate paragraphs with double newlines
- Do not add any commentary, headers, or labels
- Start directly with the content

If the content appears to be garbage or non-article content, return an empty string.`,
        },
        {
          role: "user",
          content: rawContent.slice(0, 15000), // Limit input size
        },
      ],
      temperature: 0,
      max_tokens: 8000,
    });

    cleanedText = completion.choices[0]?.message?.content?.trim() || "";
  } catch (err) {
    console.error("Groq sanitization failed:", err);
    // Fallback: return raw content with basic cleanup
    cleanedText = rawContent
      .replace(/!\[.*?\]\(.*?\)/g, "") // Remove images
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // Convert links to text
      .replace(/^#{1,6}\s+/gm, "") // Remove headers
      .replace(/\n{3,}/g, "\n\n") // Normalize line breaks
      .trim();
  }

  if (!cleanedText || cleanedText.length < 50) {
    throw error(422, "Could not extract meaningful content from the URL.");
  }

  return json({
    text: cleanedText,
    sourceUrl: validatedUrl.toString(),
    ...(title && { title }),
  });
};
