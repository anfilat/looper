import type { Json3Data, Phrase } from "./types";

interface Word {
  text: string;
  startTimeMs: number;
}

const SENTENCE_END_RE = /[.!?]$/;

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

      const firstReal = sentenceWords.find((w) => w.text.trim() !== "");

      phrases.push({
        startTimeMs: firstReal?.startTimeMs ?? sentenceWords[0].startTimeMs,
        endTimeMs,
        text: sentenceWords.map((w) => w.text).join("").replace(/\s+/g, " ").trim(),
      });
      sentenceWords = [];
    }
  }

  if (sentenceWords.length > 0) {
    const lastReal = [...sentenceWords]
      .reverse()
      .find((w) => w.text.trim() !== "");
    const firstReal = sentenceWords.find((w) => w.text.trim() !== "");

    phrases.push({
      startTimeMs: firstReal?.startTimeMs ?? sentenceWords[0].startTimeMs,
      endTimeMs: (lastReal ?? sentenceWords[sentenceWords.length - 1]).startTimeMs + 500,
      text: sentenceWords.map((w) => w.text).join("").replace(/\s+/g, " ").trim(),
    });
  }

  return phrases;
}
