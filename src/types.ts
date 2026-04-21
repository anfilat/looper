export interface Phrase {
  startTimeMs: number;
  endTimeMs: number;
  text: string;
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

export interface AppState {
  phrases: Phrase[];
  currentIndex: number;
  subtitlesVisible: boolean;
  videoFileName: string;
}
