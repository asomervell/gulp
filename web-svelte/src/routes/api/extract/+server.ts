import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import Firecrawl from "@mendable/firecrawl-js";
import Groq from "groq-sdk";
import { FIRECRAWL_API_KEY, GROQ_API_KEY } from "$env/static/private";

const firecrawl = new Firecrawl({ apiKey: FIRECRAWL_API_KEY });
const groq = new Groq({ apiKey: GROQ_API_KEY });

/**
 * POST /api/extract
 * Extracts clean paragraph text from a URL using Firecrawl,
 * then sanitizes with Groq for fast, clean RSVP-ready text.
 *
 * Request body: { url: string }
 * Response: { text: string, sourceUrl: string, title?: string }
 */
export const POST: RequestHandler = async ({ request }) => {
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

  // Validate URL format
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch {
    throw error(400, "Invalid URL format. Must be a valid http or https URL.");
  }

  // Step 1: Extract content using Firecrawl
  let rawContent: string;
  let title: string | undefined;

  try {
    const scrapeResult = await firecrawl.scrape(url, {
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
    sourceUrl: url,
    ...(title && { title }),
  });
};
