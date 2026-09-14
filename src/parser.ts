import type { Phrase, WordTiming } from "./types";

/**
 * Load the phrases file written by scripts/align_words.py:
 * {"version": 1, "phrases": [...]}. The file already contains ready-made
 * phrases with per-word timings (real acoustic ends from forced alignment);
 * no subtitle parsing happens in the app. Returns [] for anything malformed.
 */
export function parsePhrases(data: unknown): Phrase[] {
  if (typeof data !== "object" || data === null) return [];
  const { version, phrases } = data as {
    version?: unknown;
    phrases?: unknown;
  };
  if (version !== 1 || !Array.isArray(phrases)) return [];

  const result: Phrase[] = [];
  for (const entry of phrases) {
    const phrase = parsePhrase(entry);
    if (!phrase) return [];
    result.push(phrase);
  }
  return result;
}

function parsePhrase(entry: unknown): Phrase | null {
  if (typeof entry !== "object" || entry === null) return null;
  const { startTimeMs, endTimeMs, text, words } = entry as Record<
    string,
    unknown
  >;
  if (
    typeof startTimeMs !== "number" ||
    typeof endTimeMs !== "number" ||
    typeof text !== "string" ||
    !Array.isArray(words)
  ) {
    return null;
  }

  const wordTimings: WordTiming[] = [];
  for (const word of words) {
    if (typeof word !== "object" || word === null) return null;
    const w = word as Record<string, unknown>;
    if (
      typeof w.text !== "string" ||
      typeof w.startTimeMs !== "number" ||
      typeof w.endTimeMs !== "number"
    ) {
      return null;
    }
    wordTimings.push({
      text: w.text,
      startTimeMs: w.startTimeMs,
      endTimeMs: w.endTimeMs,
    });
  }
  if (wordTimings.length === 0) return null;

  return { startTimeMs, endTimeMs, text, words: wordTimings };
}
