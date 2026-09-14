#!/usr/bin/env python3
"""Build a Looper phrases file from a video and YouTube JSON3 subtitles.

Reads the .json3 subtitle file, re-aligns every event's known text to the
audio with a CTC forced aligner (torchaudio MMS_FA), groups the words into
sentences and phrases, and writes a .phrases.json the Looper app loads
directly:

  {"version": 1, "phrases": [
      {"startTimeMs": ..., "endTimeMs": ..., "text": "...",
       "words": [{"text": "...", "startTimeMs": ..., "endTimeMs": ...}]}]}

Both word starts and ends come from the aligner (ends are no longer guessed
as "the next word's start"). Sentence grouping and the 10-second phrase
splitting also happen here, so the app needs no subtitle-parsing logic.

Usage:
  python scripts/align_words.py VIDEO_OR_AUDIO SUBS.json3 [-o OUT.phrases.json]
      [--start SEC] [--end SEC] [--limit N] [--pad SEC] [--device auto]
      [--bias-ms -50] [--end-bias-ms 75] [--min-word-ms 300] [--tail-ms 250]

  --start/--end  align only events starting inside [start, end] (seconds);
                 other events keep their original timings (phrases are still
                 built for the whole file). Audio is extracted only for that
                 window, so slices of long videos are cheap.
  --limit        align at most N events (quick tests)
  --pad          extra audio context around each event window (default 0.75s)
  --device       auto (default), cpu, mps or cuda
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

SAMPLE_RATE = 16000
MAX_WINDOW_S = 15.0  # cap per-event crop even when original timings are wild
MAX_PHRASE_MS = 10_000  # split longer sentences into loop-friendly phrases
MIN_START_STEP_MS = 10  # keep word starts strictly increasing
SENTENCE_END = (".", "!", "?")


def load_audio(media: Path, cut_start_s: float, length_s: float | None):
    """Extract mono 16 kHz WAV with ffmpeg; return waveform tensor [1, T]."""
    import soundfile as sf
    import torch

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        wav_path = Path(tmp.name)
    cmd = ["ffmpeg", "-y", "-v", "error", "-ss", f"{cut_start_s:.3f}"]
    if length_s is not None:
        cmd += ["-t", f"{length_s:.3f}"]
    cmd += ["-i", str(media), "-vn", "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "wav", str(wav_path)]
    subprocess.run(cmd, check=True, capture_output=True)
    data, sr = sf.read(wav_path, dtype="float32")
    wav_path.unlink(missing_ok=True)
    assert sr == SAMPLE_RATE, f"expected {SAMPLE_RATE} Hz, got {sr}"
    return torch.from_numpy(data).unsqueeze(0)


def make_romanizer():
    import uroman

    if hasattr(uroman, "Uroman"):
        u = uroman.Uroman()
        return u.romanize_string
    return uroman.romanize_string


@dataclass
class Word:
    """One subtitle word with timings in ms (floats; rounded on output)."""

    text: str
    start: float  # aligned start, or the original one for skipped events
    orig_start: float
    end: float | None = None  # aligner end; None until aligned or filled
    score: float = 0.0


def flatten_words(events: list[dict]) -> tuple[list[Word], list[tuple[int, int]]]:
    """All subtitle words in file order, plus each event's (offset, count) slice.

    Tokens are whitespace-split per seg ("\\n" segs skipped) — the same
    flattening the app-side parser used to do.
    """
    words: list[Word] = []
    ranges: list[tuple[int, int]] = []
    for e in events:
        base = len(words)
        start_ms = e.get("tStartMs", 0)
        for seg in e.get("segs") or []:
            text = seg.get("utf8", "")
            if not text or text == "\n":
                continue
            seg_start = start_ms + (seg.get("tOffsetMs") or 0)
            for tok in text.split():
                words.append(Word(text=tok, start=seg_start, orig_start=seg_start))
        ranges.append((base, len(words) - base))
    return words, ranges


def find_split_point(words: list[Word]) -> int:
    """Where to split an over-long sentence: the comma closest to the middle,
    else the largest timing gap between words. Only inner positions qualify
    (a split after the first or before the last word is useless — the old
    parser used to give up entirely when the best candidate landed on an
    edge, leaving 100s phrases on unpunctuated stretches). Returns -1 when
    no candidate exists."""
    mid = (words[0].start + words[-1].start) / 2
    commas = [i for i in range(1, len(words) - 1) if "," in words[i].text]
    if commas:
        return min(commas, key=lambda i: abs(words[i].start - mid))
    best_gap, idx = 0.0, -1
    for i in range(1, len(words) - 1):
        gap = words[i + 1].start - words[i].start
        if gap > best_gap:
            best_gap, idx = gap, i
    return idx


def make_phrase(words: list[Word], tail_ms: float) -> dict:
    return {
        "startTimeMs": round(words[0].start),
        "endTimeMs": round(words[-1].end + tail_ms),
        "text": " ".join(w.text for w in words),
        "words": [
            {"text": w.text, "startTimeMs": round(w.start), "endTimeMs": round(w.end)}
            for w in words
        ],
    }


def split_if_needed(words: list[Word], tail_ms: float) -> list[dict]:
    """Sentences longer than MAX_PHRASE_MS are split (recursively) at a comma
    near the middle or at the largest gap between words."""
    if len(words) <= 1 or words[-1].end + tail_ms - words[0].start <= MAX_PHRASE_MS:
        return [make_phrase(words, tail_ms)]
    idx = find_split_point(words)
    if idx <= 0 or idx >= len(words) - 1:
        return [make_phrase(words, tail_ms)]
    return split_if_needed(words[: idx + 1], tail_ms) + split_if_needed(words[idx + 1 :], tail_ms)


def build_phrases(words: list[Word], tail_ms: float) -> list[dict]:
    """Group words into sentences by trailing ./!/? and split over-long ones."""
    phrases: list[dict] = []
    sentence: list[Word] = []
    for w in words:
        sentence.append(w)
        if w.text.endswith(SENTENCE_END):
            phrases.extend(split_if_needed(sentence, tail_ms))
            sentence = []
    if sentence:
        phrases.extend(split_if_needed(sentence, tail_ms))
    return phrases


def token_runs(path: list[int]) -> list[tuple[int, int, int]]:
    """Maximal non-blank runs of the Viterbi path as (label, start_frame, end_frame)."""
    runs = []
    prev = 0
    start = 0
    for f, v in enumerate(path + [0]):  # sentinel blank closes the last run
        if v != prev:
            if prev != 0:
                runs.append((prev, start, f))
            if v != 0:
                start = f
            prev = v
    return runs


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("media", type=Path)
    ap.add_argument("subs", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=None)
    ap.add_argument("--start", type=float, default=None, help="align events from this second")
    ap.add_argument("--end", type=float, default=None, help="align events until this second")
    ap.add_argument("--limit", type=int, default=None, help="align at most N events")
    ap.add_argument("--pad", type=float, default=0.75, help="audio context around each event, seconds")
    ap.add_argument("--bias-ms", type=float, default=-50.0,
                    help="shift word starts by this many ms (default -50: CTC spans start "
                         "~50ms after the acoustic onset; negative adds a pre-roll cushion)")
    ap.add_argument("--end-bias-ms", type=float, default=75.0,
                    help="extend word ends by this many ms (default 75: CTC spans end "
                         "before the acoustic offset)")
    ap.add_argument("--min-word-ms", type=float, default=300.0,
                    help="minimum word duration in ms (default 300: the app stops word "
                         "loops ~100ms before endTimeMs, so shorter words lose their tail)")
    ap.add_argument("--tail-ms", type=float, default=250.0,
                    help="phrase end padding after the last word, in ms (default 250)")
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    out = args.out or args.subs.with_name(args.subs.stem + ".phrases.json")

    data = json.loads(args.subs.read_text(encoding="utf-8"))
    events = data.get("events", [])
    if not events:
        sys.exit("no events in subtitle file")
    starts_ms = [e.get("tStartMs", 0) for e in events]
    words, event_ranges = flatten_words(events)
    if not words:
        sys.exit("no words in subtitle file")

    def event_end_ms(i: int) -> float:
        e = events[i]
        start = e.get("tStartMs", 0)
        end = start + (e.get("dDurationMs") or 0)
        if end <= start:  # no usable duration: until the next event starts
            nxt = starts_ms[i + 1] if i + 1 < len(starts_ms) else None
            end = nxt if nxt and nxt > start else start + 2000
        return end

    # Which events to align.
    todo = []
    for i, e in enumerate(events):
        if event_ranges[i][1] == 0:
            continue
        if args.start is not None and starts_ms[i] < args.start * 1000:
            continue
        if args.end is not None and starts_ms[i] >= args.end * 1000:
            continue
        todo.append(i)
    if args.limit:
        todo = todo[: args.limit]
    if not todo:
        sys.exit("no events with words in the selected range")

    # Start of the next word-bearing event: rolling-caption windows overlap
    # heavily, so this caps the crop and stops an event from stealing the
    # next event's words (they often share a display window).
    next_word_start_ms = {}
    for pos, i in enumerate(todo):
        nxt = todo[pos + 1] if pos + 1 < len(todo) else None
        next_word_start_ms[i] = starts_ms[nxt] if nxt is not None else None

    # Extract only the audio we need (+ context).
    audio_offset = max(0.0, min(
        (args.start if args.start is not None else 0.0),
        starts_ms[todo[0]] / 1000 - 2.0,
    ))
    last_needed = max(event_end_ms(i) for i in todo) / 1000 + args.pad + 1.0
    audio_len = last_needed - audio_offset
    print(f"extracting audio {audio_offset:.1f}s..{audio_offset + audio_len:.1f}s ...", file=sys.stderr)

    print("loading model (first run downloads ~1.2 GB) ...", file=sys.stderr)
    import torch
    import torchaudio
    from torchaudio.functional import forced_align

    device = args.device
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else ("mps" if torch.backends.mps.is_available() else "cpu")

    bundle = torchaudio.pipelines.MMS_FA
    model = bundle.get_model().to(device).eval()
    # get_dict(): char -> class index, 0 is the CTC blank ('-').
    char_to_token = {ch: idx for ch, idx in bundle.get_dict().items() if idx > 0}
    romanize = make_romanizer()

    waveform = load_audio(args.media, audio_offset, audio_len)
    audio_dur = waveform.size(-1) / SAMPLE_RATE + audio_offset
    print(f"audio: {audio_dur:.1f}s, device: {device}", file=sys.stderr)

    stats = {"events": 0, "words": 0, "fallback": 0, "shifts": [], "scores": []}

    with torch.no_grad():
        for n, i in enumerate(todo):
            base, count = event_ranges[i]
            tokens = [w.text for w in words[base : base + count]]
            crop_start = max(0.0, starts_ms[i] / 1000 - args.pad)
            crop_end = min(audio_dur, event_end_ms(i) / 1000 + args.pad, crop_start + MAX_WINDOW_S)
            nws = next_word_start_ms[i]
            if nws is not None:
                crop_end = min(crop_end, nws / 1000 + 0.4)
            if crop_end - crop_start < 0.15:
                stats["fallback"] += 1
                continue
            crop = waveform[:, int((crop_start - audio_offset) * SAMPLE_RATE):
                            int((crop_end - audio_offset) * SAMPLE_RATE)].to(device)
            if crop.numel() < SAMPLE_RATE // 10:
                stats["fallback"] += 1
                continue

            # Romanize each word separately so transcript word boundaries
            # always match the source words; join with single spaces.
            roman_words = [romanize(w) for w in tokens]
            transcript = " ".join(rw for rw in roman_words if rw).lower()
            if not transcript.strip():
                stats["fallback"] += 1
                continue

            # Per-character token indices; chars outside the CTC vocabulary
            # (punctuation, symbols) carry no token.
            char_token: list[int | None] = []
            token_ids: list[int] = []
            for ch in transcript:
                if ch == " ":
                    char_token.append(None)
                elif ch in char_to_token:
                    char_token.append(len(token_ids))
                    token_ids.append(char_to_token[ch])
                else:
                    char_token.append(None)
            if not token_ids:
                stats["fallback"] += 1
                continue

            try:
                emission, _ = model(crop)  # [1, T, C]
                log_probs = emission.log_softmax(dim=-1).cpu()
                alignments, frame_scores = forced_align(
                    log_probs, torch.tensor([token_ids], dtype=torch.int32))
                path = alignments[0].tolist()
                frame_scores = frame_scores[0].tolist()
            except Exception as ex:  # noqa: BLE001
                if args.verbose:
                    print(f"event {i}: align failed: {ex}", file=sys.stderr)
                stats["fallback"] += 1
                continue

            # Non-blank runs of the Viterbi path map 1:1 to tokens in order.
            runs = token_runs(path)
            if len(runs) != len(token_ids) or any(r[0] != t for r, t in zip(runs, token_ids)):
                if args.verbose:
                    print(f"event {i}: path/token mismatch ({len(runs)} vs {len(token_ids)})", file=sys.stderr)
                stats["fallback"] += 1
                continue
            token_span = {tok_idx: (st, en) for tok_idx, (_, st, en) in enumerate(runs)}

            ratio = crop.size(-1) / emission.size(1) / SAMPLE_RATE  # seconds per frame

            # Transcript char positions -> word indices -> tokens -> frames.
            word_of_char: list[int] = []
            wi = 0
            for ch in transcript:
                if ch == " ":
                    wi += 1
                word_of_char.append(min(wi, len(tokens) - 1))
            word_spans: list[list[tuple[int, int]]] = [[] for _ in tokens]
            for pos, ti in enumerate(char_token):
                if ti is not None:
                    word_spans[word_of_char[pos]].append(token_span[ti])

            gap_frames = int(0.25 / ratio)  # intra-word token gaps never reach this
            word_times: list[tuple[float, float, float] | None] = [None] * len(tokens)
            for wi in range(len(tokens)):
                spans = word_spans[wi]
                # Trim stray edge tokens: a span split from the rest of the
                # word by a large gap is the aligner latching onto unrelated
                # audio (typically the previous line's tail inside an
                # overlapping rolling-caption crop), not this word's speech.
                while len(spans) >= 2 and spans[1][0] - spans[0][1] > gap_frames:
                    spans = spans[1:]
                while len(spans) >= 2 and spans[-1][0] - spans[-2][1] > gap_frames:
                    spans = spans[:-1]
                frames = [f for st, en in spans for f in range(st, en)]
                if not frames:
                    continue
                start = crop_start + min(frames) * ratio + args.bias_ms / 1000.0
                word_times[wi] = (
                    start,
                    crop_start + max(frames) * ratio,
                    sum(frame_scores[f] for f in frames) / len(frames),
                )
                stats["scores"].append(word_times[wi][2])

            # Fill words the aligner could not pin (no tokens): interpolate.
            if all(t is None for t in word_times):
                stats["fallback"] += 1
                continue
            last_end = crop_start
            for wi in range(len(word_times)):
                if word_times[wi] is None:
                    nxt = next((t for t in word_times[wi + 1:] if t), None)
                    fill_start = last_end
                    fill_end = nxt[0] if nxt else last_end + 0.05
                    word_times[wi] = (fill_start, fill_end, 0.0)
                last_end = word_times[wi][1]

            # Record the aligned timings into the global word list.
            for wi, wt in enumerate(word_times):
                w = words[base + wi]
                w.start = wt[0] * 1000
                w.end = wt[1] * 1000
                w.score = wt[2]
                stats["shifts"].append(w.start - w.orig_start)
            stats["events"] += 1
            stats["words"] += count
            if args.verbose or (n + 1) % 200 == 0:
                print(f"  {n + 1}/{len(todo)} events aligned", file=sys.stderr)

    # Word starts must strictly increase across the whole file (word order):
    # rolling-caption windows overlap, so adjacent aligned events can violate
    # this; bump the latecomers by the minimum amount.
    prev_start = None
    for w in words:
        if prev_start is not None and w.start <= prev_start:
            w.start = prev_start + MIN_START_STEP_MS
        prev_start = w.start

    # Word ends: aligned words use the aligner's end plus a bias, at least
    # min-word long, and never past the next word's start. Fallback words
    # (unaligned events) keep the old heuristic: end at the next word's start.
    for i, w in enumerate(words):
        next_start = words[i + 1].start if i + 1 < len(words) else None
        if w.end is not None:
            end = max(w.end + args.end_bias_ms, w.start + args.min_word_ms)
        else:
            end = next_start if next_start is not None else w.start + 500
        if next_start is not None:
            # Clamp last: aligned starts can sit a few ms apart, and the
            # min-duration floor must never push an end past the next start.
            end = min(end, next_start)
        else:
            end = max(end, w.start + MIN_START_STEP_MS)
        w.end = end

    phrases = build_phrases(words, args.tail_ms)
    out.write_text(json.dumps({"version": 1, "phrases": phrases}, ensure_ascii=False), encoding="utf-8")

    shifts, scores = stats["shifts"], stats["scores"]
    print(f"\n{out}: {stats['events']} events / {stats['words']} words aligned, "
          f"{stats['fallback']} kept original, {len(phrases)} phrases", file=sys.stderr)
    if shifts:
        mean = sum(shifts) / len(shifts)
        mae = sum(abs(s) for s in shifts) / len(shifts)
        p95 = sorted(abs(s) for s in shifts)[int(0.95 * len(shifts))]
        print(f"shift vs original: mean {mean:+.0f} ms, MAE {mae:.0f} ms, p95 {p95:.0f} ms", file=sys.stderr)
    if scores:
        scores.sort()
        print(f"word score: median {scores[len(scores) // 2]:.2f}, p05 {scores[int(0.05 * len(scores))]:.2f}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
