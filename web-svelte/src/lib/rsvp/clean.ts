/**
 * Clean extracted content into readable paragraphs for RSVP.
 * This module aggressively strips navigation, footers, images, and all
 * non-readable content from extraction services like Jina Reader.
 */

/**
 * Remove Jina Reader metadata that appears at the top of extracted content.
 */
function stripJinaMetadata(text: string): string {
  return (
    text
      // Remove Title: line
      .replace(/^Title:\s*.+$/gim, "")
      // Remove URL Source: line
      .replace(/^URL Source:\s*.+$/gim, "")
      // Remove Markdown Content header
      .replace(/^Markdown Content:\s*$/gim, "")
      // Remove Published/Updated date lines
      .replace(/^(Published|Updated|Date|Posted|Written):\s*.+$/gim, "")
      // Remove Author lines
      .replace(/^(Author|By|Written by):\s*.+$/gim, "")
      // Remove reading time estimates
      .replace(/^\d+\s*(min|minute)s?\s*(read|reading).*$/gim, "")
      .replace(/^reading time:?\s*.+$/gim, "")
  );
}

/**
 * Remove markdown formatting while preserving paragraph structure.
 */
function stripMarkdown(text: string): string {
  return (
    text
      // Remove markdown images ![alt](url) - BEFORE links so we don't leave alt text
      .replace(/!\[[^\]]*\]\([^)]+\)/g, "")
      // Remove HTML img tags
      .replace(/<img[^>]*>/gi, "")
      // Remove markdown links [text](url) -> text
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      // Remove reference-style links [text][ref]
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      // Remove reference definitions [ref]: url
      .replace(/^\[[^\]]+\]:\s*.+$/gm, "")
      // Remove inline code `code`
      .replace(/`([^`]+)`/g, "$1")
      // Remove code blocks ```...``` (including language hints)
      .replace(/```[\w]*\n[\s\S]*?```/g, "")
      .replace(/```[\s\S]*?```/g, "")
      // Remove indented code blocks (4+ spaces at start)
      .replace(/^(?: {4}|\t).+$/gm, "")
      // Remove bold **text** or __text__
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/__([^_]+)__/g, "$1")
      // Remove italic *text* or _text_ (but not underscores in words)
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/(?<![a-zA-Z])_([^_\n]+)_(?![a-zA-Z])/g, "$1")
      // Remove strikethrough ~~text~~
      .replace(/~~([^~]+)~~/g, "$1")
      // Remove headers (# ## ### etc.) but keep the text
      .replace(/^#{1,6}\s+(.+)$/gm, "$1")
      // Remove blockquotes > but keep the text
      .replace(/^>\s*/gm, "")
      // Remove horizontal rules
      .replace(/^[-*_]{3,}\s*$/gm, "")
      // Remove list markers (- * + or numbered) but keep the text
      .replace(/^[\s]*[-*+]\s+/gm, "")
      .replace(/^[\s]*\d+\.\s+/gm, "")
      // Remove HTML tags completely
      .replace(/<[^>]+>/g, "")
      // Remove HTML entities
      .replace(/&[a-z]+;/gi, " ")
      .replace(/&#\d+;/g, " ")
  );
}

/**
 * Remove URLs that appear as plain text (not in markdown syntax).
 */
function stripUrls(text: string): string {
  return (
    text
      // Remove standalone URLs on their own line
      .replace(/^https?:\/\/[^\s]+$/gm, "")
      // Remove URLs in the middle of text (leave a space)
      .replace(/https?:\/\/[^\s]+/g, " ")
      // Remove www. URLs
      .replace(/www\.[^\s]+/g, " ")
  );
}

/**
 * Remove common boilerplate patterns from extracted text.
 */
function removeBoilerplate(text: string): string {
  const lines = text.split("\n");
  const cleanedLines: string[] = [];

  // Patterns that suggest boilerplate/navigation (case insensitive)
  const boilerplatePatterns = [
    // Navigation
    /^(skip to|jump to|go to|back to|return to)\s/i,
    /^(menu|navigation|nav|footer|header|sidebar|breadcrumb)/i,
    /^(home|about|contact|search|help|faq)\s*$/i,
    /^(previous|next|older|newer)\s*(post|article|page)?s?\s*$/i,

    // Auth/account
    /^(sign in|sign up|log in|log out|login|logout|register|subscribe|unsubscribe)/i,
    /^(my account|your account|profile|settings|dashboard)/i,
    /^(forgot password|reset password|create account)/i,

    // Social/sharing
    /^(share|tweet|facebook|linkedin|pinterest|instagram|twitter|email this|print)/i,
    /^(follow us|connect with us|join us|like us)/i,
    /^\d+\s*(shares?|likes?|comments?|views?|retweets?)/i,

    // Related content
    /^(related|recommended|you may also|you might also|more from|trending|popular)/i,
    /^(see also|read more|read next|up next|don't miss)/i,
    /^(latest|recent)\s*(posts?|articles?|news|stories)/i,

    // Ads/promo
    /^(advertisement|sponsored|promo|ad|ads)\b/i,
    /^(special offer|limited time|sale|discount|deal)/i,

    // Legal/footer
    /^(copyright|©|\(c\)|all rights reserved)/i,
    /^(privacy policy|terms of service|terms and conditions|cookie policy)/i,
    /^(disclaimer|legal|sitemap)/i,

    // Newsletter/subscription
    /^(newsletter|subscribe to|get updates|join our|sign up for)/i,
    /^(enter your email|your email address)/i,

    // Comments section
    /^(leave a comment|post a comment|comments|comment section)/i,
    /^(reply|replies|\d+\s*comments?)/i,

    // Misc UI elements
    /^(loading|please wait|click here|tap here|swipe)/i,
    /^(show more|show less|expand|collapse|toggle)/i,
    /^(table of contents|contents|toc)\s*$/i,
    /^\[.*\]\s*$/, // Bracketed items like [Menu] [Close]
    /^[\s]*\|[\s]*/, // Pipe-separated nav items
    /^[-•·►▸▶→←↑↓]\s*$/, // Lone bullets/arrows

    // Image captions/credits that got left behind
    /^(image|photo|picture|illustration|figure|fig\.?)\s*:?\s*\d*/i,
    /^(credit|source|via|courtesy):?\s/i,
    /^(getty|shutterstock|unsplash|pexels|adobe stock)/i,

    // Timestamps without content
    /^\d{1,2}[:.]\d{2}\s*(am|pm)?\s*$/i,
    /^(today|yesterday|tomorrow)\s*$/i,
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d+/i,

    // Social proof / badges
    /^(verified|certified|official|trusted)/i,
    /^\d+[km]?\+?\s*(followers?|subscribers?|members?)/i,

    // Empty or meaningless
    /^[.\-_=*#]+$/, // Lines of just punctuation
    /^[\s]*$/, // Empty lines handled separately but catch whitespace-only
  ];

  // Patterns for lines that are likely part of nav menus (short, no punctuation)
  const navItemPattern = /^[A-Z][a-zA-Z\s]{0,20}$/;

  let consecutiveShortLines = 0;
  const MAX_CONSECUTIVE_SHORT = 3; // If we see many short lines, likely nav

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip empty lines (we'll normalize later)
    if (!trimmed) {
      cleanedLines.push("");
      consecutiveShortLines = 0;
      continue;
    }

    // Skip lines matching boilerplate patterns
    let isBoilerplate = false;
    for (const pattern of boilerplatePatterns) {
      if (pattern.test(trimmed)) {
        isBoilerplate = true;
        break;
      }
    }

    if (isBoilerplate) {
      consecutiveShortLines = 0;
      continue;
    }

    // Skip very short lines that are likely nav items
    // (less than 4 chars and doesn't end with sentence punctuation)
    if (trimmed.length < 4 && !/[.!?]$/.test(trimmed)) {
      consecutiveShortLines++;
      continue;
    }

    // Detect nav menu: multiple consecutive short capitalized items
    if (
      trimmed.length < 25 &&
      navItemPattern.test(trimmed) &&
      !trimmed.includes(".")
    ) {
      consecutiveShortLines++;
      if (consecutiveShortLines >= MAX_CONSECUTIVE_SHORT) {
        // Skip this and previous short lines were likely nav
        continue;
      }
    } else {
      consecutiveShortLines = 0;
    }

    // Skip lines that are just numbers (page numbers, counts, etc.)
    if (/^\d+$/.test(trimmed)) {
      continue;
    }

    // Skip lines that look like timestamps or dates only
    if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) {
      continue;
    }

    // Skip lines that are just email addresses
    if (/^[\w.-]+@[\w.-]+\.\w+$/.test(trimmed)) {
      continue;
    }

    cleanedLines.push(trimmed);
  }

  return cleanedLines.join("\n");
}

/**
 * Remove content that appears after common "end of article" markers.
 */
function truncateAtEndMarkers(text: string): string {
  const endMarkers = [
    /^related\s+(posts?|articles?|stories?|content)/im,
    /^(you may also like|recommended for you|more from)/im,
    /^(comments?|leave a reply|post a comment)/im,
    /^(share this|share on)/im,
    /^(about the author|author bio)/im,
    /^(tags?|categories?|topics?):\s/im,
    /^(subscribe|newsletter|sign up for)/im,
    /^(advertisement|sponsored content)/im,
    /^(footer|copyright ©)/im,
  ];

  let result = text;

  for (const marker of endMarkers) {
    const match = result.match(marker);
    if (match && match.index !== undefined) {
      // Only truncate if we have substantial content before the marker
      const before = result.slice(0, match.index).trim();
      if (before.length > 200) {
        result = before;
      }
    }
  }

  return result;
}

/**
 * Normalize paragraph breaks and whitespace.
 */
function normalizeParagraphs(text: string): string {
  return (
    text
      // Normalize line endings
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      // Collapse 3+ newlines into 2 (paragraph break)
      .replace(/\n{3,}/g, "\n\n")
      // Collapse multiple spaces into one
      .replace(/[ \t]+/g, " ")
      // Trim each line
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      // Remove lines that are now empty or just whitespace
      .replace(/\n\s*\n/g, "\n\n")
      // Final trim
      .trim()
  );
}

/**
 * Final cleanup pass to catch anything we missed.
 */
function finalCleanup(text: string): string {
  return (
    text
      // Remove any remaining markdown-style elements
      .replace(/\[x\]/gi, "") // Checkboxes
      .replace(/\[ \]/g, "")
      // Remove emoji (optional - comment out if you want to keep them)
      // .replace(/[\u{1F600}-\u{1F64F}]/gu, '')
      // .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
      // .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
      // .replace(/[\u{2600}-\u{26FF}]/gu, '')
      // .replace(/[\u{2700}-\u{27BF}]/gu, '')
      // Remove excessive punctuation
      .replace(/([.!?]){2,}/g, "$1")
      .replace(/,{2,}/g, ",")
      // Clean up spaces around punctuation
      .replace(/\s+([.,!?;:])/g, "$1")
      .replace(/([.,!?;:])\s+/g, "$1 ")
      // Remove leading/trailing punctuation on lines
      .split("\n")
      .map((line) => line.replace(/^[,;:\s]+/, "").replace(/[,;\s]+$/, ""))
      .join("\n")
      // Final whitespace normalization
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Clean extracted content into readable paragraphs.
 * This is the main entry point for the cleaning pipeline.
 *
 * @param rawText - Raw extracted text (possibly markdown from Jina Reader)
 * @returns Clean paragraph text suitable for RSVP
 */
export function cleanToParagraphs(rawText: string): string {
  if (!rawText || typeof rawText !== "string") {
    return "";
  }

  let text = rawText;

  // Pipeline: each step progressively cleans the content
  text = stripJinaMetadata(text);
  text = stripMarkdown(text);
  text = stripUrls(text);
  text = removeBoilerplate(text);
  text = truncateAtEndMarkers(text);
  text = normalizeParagraphs(text);
  text = finalCleanup(text);

  return text;
}

/**
 * Extract a plain text summary suitable for RSVP from messy input.
 * Alias for cleanToParagraphs for semantic clarity.
 */
export const extractCleanText = cleanToParagraphs;
