export interface WordTiming {
  text: string;
  startTimeMs: number;
  /** Acoustic end of the word (forced-alignment data); unlike older files,
   *  it does not stretch to the next word's start — a silence gap may follow. */
  endTimeMs: number;
}

export interface Phrase {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
  /** Per-word timings (forced alignment data); drives word mode in the
   *  console player (scripts/looper.py) and scripts/cut_word.py. */
  words: WordTiming[];
}
