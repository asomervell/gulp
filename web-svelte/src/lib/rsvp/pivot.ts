/**
 * Calculate the "Optimal Recognition Point" (ORP) / pivot letter index for RSVP.
 * The pivot letter is the one that should be highlighted and aligned to the centerline.
 *
 * This is typically around 1/3 into the word, adjusted for word length.
 * The goal is to help the eye fixate at a natural reading position.
 */

/**
 * Get the index of the pivot letter for a word.
 * @param word - The word to find the pivot for
 * @returns The 0-based index of the pivot letter
 */
export function getPivotIndex(word: string): number {
	if (!word || word.length === 0) {
		return 0;
	}

	const len = word.length;

	// For very short words, pivot is at the start
	if (len <= 1) return 0;
	if (len <= 3) return 1;
	if (len <= 5) return 1;
	if (len <= 7) return 2;
	if (len <= 9) return 2;
	if (len <= 11) return 3;
	if (len <= 13) return 3;

	// For longer words, use roughly 1/4 to 1/3 position
	return Math.floor(len / 4);
}

/**
 * Split a word into three parts: before pivot, pivot letter, after pivot.
 * This is useful for rendering with the pivot letter highlighted.
 * @param word - The word to split
 * @returns Object with left, pivot, and right parts
 */
export function splitAtPivot(word: string): {
	left: string;
	pivot: string;
	right: string;
} {
	if (!word || word.length === 0) {
		return { left: '', pivot: '', right: '' };
	}

	const pivotIndex = getPivotIndex(word);

	return {
		left: word.slice(0, pivotIndex),
		pivot: word[pivotIndex] || '',
		right: word.slice(pivotIndex + 1)
	};
}

/**
 * Calculate the character offset needed to align the pivot to a centerline.
 * This returns the number of characters before the pivot.
 * @param word - The word being displayed
 * @returns Number of characters before the pivot
 */
export function getPivotOffset(word: string): number {
	return getPivotIndex(word);
}
