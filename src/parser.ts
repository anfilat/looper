import type { Json3Data, Json3Event, Phrase } from "./types";

const SENTENCE_END_RE = /[.!?]$/;
const MAX_SENTENCE_DURATION_MS = 15000;

function getEventText(event: Json3Event): string {
  if (!event.segs) return "";
  return event.segs.map((seg) => seg.utf8).join("");
}

export function parsePhrases(data: Json3Data): Phrase[] {
  const phrases: Phrase[] = [];
  let buffer: { startTimeMs: number; endTimeMs: number; text: string } | null =
    null;

  for (const event of data.events) {
    const text = getEventText(event).trim();
    if (!text) continue;

    const eventEnd = event.tStartMs + event.dDurationMs;

    if (!buffer) {
      buffer = {
        startTimeMs: event.tStartMs,
        endTimeMs: eventEnd,
        text,
      };
    } else {
      buffer.text += " " + text;
      buffer.endTimeMs = eventEnd;
    }

    const duration = buffer.endTimeMs - buffer.startTimeMs;

    if (SENTENCE_END_RE.test(text) || duration >= MAX_SENTENCE_DURATION_MS) {
      if (duration >= MAX_SENTENCE_DURATION_MS && !SENTENCE_END_RE.test(text)) {
        const lastComma = buffer.text.lastIndexOf(",");
        if (lastComma !== -1) {
          const before = buffer.text.slice(0, lastComma).trim();
          const after = buffer.text.slice(lastComma + 1).trim();
          phrases.push({
            startTimeMs: buffer.startTimeMs,
            endTimeMs: event.tStartMs,
            text: before,
          });
          buffer = {
            startTimeMs: event.tStartMs,
            endTimeMs: eventEnd,
            text: after,
          };
          continue;
        }
      }
      phrases.push({
        startTimeMs: buffer.startTimeMs,
        endTimeMs: buffer.endTimeMs,
        text: buffer.text,
      });
      buffer = null;
    }
  }

  if (buffer) {
    phrases.push({
      startTimeMs: buffer.startTimeMs,
      endTimeMs: buffer.endTimeMs,
      text: buffer.text,
    });
  }

  return phrases;
}
