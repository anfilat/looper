import type { Json3Data, Phrase, WordTiming } from "./types";

interface Word {
  text: string;
  startTimeMs: number;
}

const SENTENCE_END_RE = /[.!?]$/;
const MAX_PHRASE_DURATION_MS = 10_000;

function extractWords(data: Json3Data): Word[] {
  const words: Word[] = [];

  for (const event of data.events) {
    if (!event.segs) continue;

    for (const seg of event.segs) {
      const text = seg.utf8;
      if (text === "\n") {
        if (words.length > 0) {
          const lastTime = words[words.length - 1].startTimeMs;
          words.push({ text: " ", startTimeMs: lastTime });
        }
        continue;
      }
      if (text.trim() === "") continue;

      const startTimeMs = event.tStartMs + (seg.tOffsetMs || 0);
      words.push({ text, startTimeMs });
    }
  }

  return words;
}

function findNextRealWord(words: Word[], fromIndex: number): Word | null {
  for (let i = fromIndex; i < words.length; i++) {
    if (words[i].text.trim() !== "") return words[i];
  }
  return null;
}

function findSplitPoint(words: Word[]): number {
  const firstReal = words.find((w) => w.text.trim() !== "");
  const lastReal = [...words].reverse().find((w) => w.text.trim() !== "");
  const midTime =
    ((firstReal?.startTimeMs ?? words[0].startTimeMs) +
      (lastReal?.startTimeMs ?? words[words.length - 1].startTimeMs)) /
    2;

  let bestComma = -1;
  for (let i = 0; i < words.length - 1; i++) {
    if (!words[i].text.includes(",")) continue;
    if (
      bestComma === -1 ||
      Math.abs(words[i].startTimeMs - midTime) <
        Math.abs(words[bestComma].startTimeMs - midTime)
    ) {
      bestComma = i;
    }
  }
  if (bestComma !== -1) return bestComma;

  let maxGap = 0;
  let maxGapIdx = -1;
  for (let i = 0; i < words.length - 1; i++) {
    const gap = words[i + 1].startTimeMs - words[i].startTimeMs;
    if (gap > maxGap) {
      maxGap = gap;
      maxGapIdx = i;
    }
  }
  return maxGapIdx;
}

function buildPhrase(words: Word[], endTimeMs: number): Phrase {
  const realWords = words.filter((w) => w.text.trim() !== "");
  const firstReal = realWords[0];
  // Word texts are stored trimmed so that joining them with a space always
  // reconstructs readable text. Raw seg texts may carry a leading space
  // (" gold") or none at all ("read" after a "\n" separator seg) — the
  // original spacing must not leak into word mode.
  const wordTimings: WordTiming[] = realWords.map((w, i) => ({
    text: w.text.replace(/\s+/g, " ").trim(),
    startTimeMs: w.startTimeMs,
    endTimeMs:
      i + 1 < realWords.length ? realWords[i + 1].startTimeMs : endTimeMs,
  }));
  return {
    startTimeMs: firstReal?.startTimeMs ?? words[0].startTimeMs,
    endTimeMs,
    text: words
      .map((w) => w.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim(),
    words: wordTimings,
  };
}

function splitIfNeeded(words: Word[], endTimeMs: number): Phrase[] {
  if (words.length <= 1) return [buildPhrase(words, endTimeMs)];

  const firstReal = words.find((w) => w.text.trim() !== "");
  const startMs = firstReal?.startTimeMs ?? words[0].startTimeMs;

  if (endTimeMs - startMs <= MAX_PHRASE_DURATION_MS) {
    return [buildPhrase(words, endTimeMs)];
  }

  const splitIdx = findSplitPoint(words);
  if (splitIdx <= 0 || splitIdx >= words.length - 1) {
    return [buildPhrase(words, endTimeMs)];
  }

  const left = words.slice(0, splitIdx + 1);
  const right = words.slice(splitIdx + 1);
  const rightFirstReal = right.find((w) => w.text.trim() !== "");
  const leftEnd =
    rightFirstReal?.startTimeMs ?? left[left.length - 1].startTimeMs + 500;

  return [
    ...splitIfNeeded(left, leftEnd),
    ...splitIfNeeded(right, endTimeMs),
  ];
}

export function parsePhrases(data: Json3Data): Phrase[] {
  const words = extractWords(data);
  if (words.length === 0) return [];

  const phrases: Phrase[] = [];
  let sentenceWords: Word[] = [];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    sentenceWords.push(word);

    if (SENTENCE_END_RE.test(word.text)) {
      const nextReal = findNextRealWord(words, i + 1);
      const endTimeMs = nextReal
        ? nextReal.startTimeMs
        : word.startTimeMs + 500;

      phrases.push(...splitIfNeeded(sentenceWords, endTimeMs));
      sentenceWords = [];
    }
  }

  if (sentenceWords.length > 0) {
    const lastReal = [...sentenceWords]
      .reverse()
      .find((w) => w.text.trim() !== "");
    const endTimeMs =
      (lastReal ?? sentenceWords[sentenceWords.length - 1]).startTimeMs + 500;

    phrases.push(...splitIfNeeded(sentenceWords, endTimeMs));
  }

  return phrases;
}
