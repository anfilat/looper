export interface WordTiming {
  text: string;
  startTimeMs: number;
  /** Start of the next word, or the phrase end for the last word. */
  endTimeMs: number;
}

export interface Phrase {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  /** Words with timings; drives word mode. */
  words: WordTiming[];
}

export interface Json3Event {
  tStartMs: number;
  dDurationMs: number;
  id?: number;
  wWinId?: number;
  aAppend?: number;
  segs?: { utf8: string; tOffsetMs?: number }[];
}

export interface Json3Data {
  events: Json3Event[];
}
