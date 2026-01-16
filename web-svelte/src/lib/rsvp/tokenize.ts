/**
 * Tokenize text into words for RSVP display.
 * Keeps punctuation attached to words (e.g., "word," stays as one token).
 * This is a simple v1 implementation; can be enhanced later for smarter handling.
 */

/**
 * Normalize whitespace and split text into tokens.
 * @param text - The source text to tokenize
 * @returns Array of word tokens
 */
export function tokenize(text: string): string[] {
	if (!text || typeof text !== 'string') {
		return [];
	}

	// Normalize various whitespace characters to single spaces
	const normalized = text
		.replace(/[\r\n\t]+/g, ' ') // Convert newlines/tabs to spaces
		.replace(/\s+/g, ' ') // Collapse multiple spaces
		.trim();

	if (!normalized) {
		return [];
	}

	// Split by whitespace, filter out empty strings
	return normalized.split(' ').filter((token) => token.length > 0);
}

/**
 * Get the total word count from text.
 * @param text - The source text
 * @returns Number of tokens
 */
export function getWordCount(text: string): number {
	return tokenize(text).length;
}

/**
 * Estimate reading time in minutes at a given WPM.
 * @param text - The source text
 * @param wpm - Words per minute
 * @returns Estimated minutes (decimal)
 */
export function estimateReadingTime(text: string, wpm: number): number {
	const wordCount = getWordCount(text);
	if (wpm <= 0) return 0;
	return wordCount / wpm;
}

/**
 * Format reading time as a human-readable string.
 * @param minutes - Reading time in minutes
 * @returns Formatted string like "2m 30s" or "45s"
 */
export function formatReadingTime(minutes: number): string {
	const totalSeconds = Math.round(minutes * 60);
	const mins = Math.floor(totalSeconds / 60);
	const secs = totalSeconds % 60;

	if (mins === 0) {
		return `${secs}s`;
	}
	if (secs === 0) {
		return `${mins}m`;
	}
	return `${mins}m ${secs}s`;
}
