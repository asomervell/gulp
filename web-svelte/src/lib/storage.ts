/**
 * LocalStorage persistence helpers for RSVP state.
 * Handles saving/restoring user preferences and reading position.
 */

const STORAGE_KEY = "rsvp-state";

/**
 * The persisted state shape.
 */
export interface RsvpPersistedState {
  url: string;
  sourceText: string;
  wpm: number;
  wordIndex: number;
}

/**
 * Default state values.
 */
export const DEFAULT_STATE: RsvpPersistedState = {
  url: "",
  sourceText: "",
  wpm: 450, // Default WPM as specified
  wordIndex: 0,
};

/**
 * Check if we're in a browser environment.
 */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

/**
 * Load persisted state from localStorage.
 * Returns default state if nothing is stored or if parsing fails.
 */
export function loadState(): RsvpPersistedState {
  if (!isBrowser()) {
    return { ...DEFAULT_STATE };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { ...DEFAULT_STATE };
    }

    const parsed = JSON.parse(stored);

    // Validate and merge with defaults to ensure all fields exist
    return {
      url: typeof parsed.url === "string" ? parsed.url : DEFAULT_STATE.url,
      sourceText:
        typeof parsed.sourceText === "string"
          ? parsed.sourceText
          : DEFAULT_STATE.sourceText,
      wpm:
        typeof parsed.wpm === "number" && parsed.wpm > 0
          ? parsed.wpm
          : DEFAULT_STATE.wpm,
      wordIndex:
        typeof parsed.wordIndex === "number" && parsed.wordIndex >= 0
          ? parsed.wordIndex
          : DEFAULT_STATE.wordIndex,
    };
  } catch {
    // If parsing fails, return defaults
    return { ...DEFAULT_STATE };
  }
}

/**
 * Save state to localStorage.
 */
export function saveState(state: RsvpPersistedState): void {
  if (!isBrowser()) {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Silently fail if localStorage is full or unavailable
    console.warn("Failed to save RSVP state to localStorage");
  }
}

/**
 * Create a debounced save function.
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced save function
 */
export function createDebouncedSave(
  delay: number = 500,
): (state: RsvpPersistedState) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return (state: RsvpPersistedState) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      saveState(state);
      timeoutId = null;
    }, delay);
  };
}

/**
 * Clear all persisted state.
 */
export function clearState(): void {
  if (!isBrowser()) {
    return;
  }

  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Update a single field in the persisted state.
 * Loads current state, updates the field, and saves.
 */
export function updateStateField<K extends keyof RsvpPersistedState>(
  key: K,
  value: RsvpPersistedState[K],
): void {
  const current = loadState();
  current[key] = value;
  saveState(current);
}
