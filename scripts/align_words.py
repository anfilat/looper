#!/usr/bin/env python3
"""Refine YouTube JSON3 word timings with forced alignment (torchaudio MMS_FA).

Reads the original .json3 subtitle file, aligns every event's known text to the
audio with a CTC forced aligner, and writes a .json3 in the same word-level
format (one seg per word) where each word's tOffsetMs reflects its real start.

Usage:
  python scripts/align_words.py VIDEO_OR_AUDIO SUBS.json3 [-o OUT.json3]
      [--start SEC] [--end SEC] [--limit N] [--pad SEC] [--device auto]

  --start/--end  align only events starting inside [start, end] (seconds);
                 other events are copied unchanged. Audio is extracted only
                 for that window, so slices of long videos are cheap.
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
from pathlib import Path

SAMPLE_RATE = 16000
MAX_WINDOW_S = 15.0  # cap per-event crop even when original timings are wild


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


def event_words(event: dict) -> list[str]:
    """Whitespace-separated word tokens from an event's segs ('\\n' segs skipped)."""
    words: list[str] = []
    for seg in event.get("segs") or []:
        text = seg.get("utf8", "")
        if not text or text == "\n":
            continue
        words.extend(t for t in text.split() if t)
    return words


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
    ap.add_argument("--device", default="auto", choices=["auto", "cpu", "mps", "cuda"])
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    out = args.out or args.subs.with_name(args.subs.stem + ".aligned.json3")

    data = json.loads(args.subs.read_text(encoding="utf-8"))
    events = data.get("events", [])
    if not events:
        sys.exit("no events in subtitle file")
    starts_ms = [e.get("tStartMs", 0) for e in events]

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
        if not event_words(e):
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
            e = events[i]
            words = event_words(e)
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
            roman_words = [romanize(w) for w in words]
            transcript = " ".join(rw for rw in roman_words if rw)
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
                word_of_char.append(min(wi, len(words) - 1))
            word_frames: list[list[int]] = [[] for _ in words]
            for pos, ti in enumerate(char_token):
                if ti is not None:
                    st, en = token_span[ti]
                    word_frames[word_of_char[pos]].extend(range(st, en))

            word_times: list[tuple[float, float, float] | None] = [None] * len(words)
            for wi in range(len(words)):
                frames = word_frames[wi]
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
                last_end = word_times[wi][1]  # type: ignore[index]

            # Shift stats vs original word starts (word-level files only).
            orig_starts = [starts_ms[i] + (seg.get("tOffsetMs") or 0)
                           for seg in e.get("segs") or []
                           if seg.get("utf8", "") not in ("", "\n") and seg["utf8"].split()]
            for wi in range(min(len(orig_starts), len(words))):
                stats["shifts"].append(word_times[wi][0] * 1000 - orig_starts[wi])  # type: ignore[index]

            # Rewrite the event: one seg per word, YouTube word-level style.
            new_start_ms = round(word_times[0][0] * 1000)  # type: ignore[index]
            segs = []
            for wi, word in enumerate(words):
                off = max(0, round(word_times[wi][0] * 1000) - new_start_ms)  # type: ignore[index]
                segs.append({"utf8": word if wi == 0 else " " + word, "tOffsetMs": off})
            # No trailing "\n" seg: in YouTube word-level files the line break
            # arrives as a separate aAppend event, which we keep untouched —
            # a synthetic one here doubles the separator and confuses the
            # parser's long-phrase splitting.
            e["tStartMs"] = new_start_ms
            e["dDurationMs"] = max(100, round(word_times[-1][1] * 1000) - new_start_ms)  # type: ignore[index]
            e["segs"] = segs
            stats["events"] += 1
            stats["words"] += len(words)
            if args.verbose or (n + 1) % 200 == 0:
                print(f"  {n + 1}/{len(todo)} events aligned", file=sys.stderr)

    # The app derives each word's end from the next word's start, so word
    # starts must strictly increase across the whole file. Rolling-caption
    # windows overlap, so adjacent aligned events can violate this; bump the
    # latecomers by the minimum amount.
    prev_ms = None
    for e in events:
        segs = [s for s in e.get("segs") or []
                if s.get("utf8") not in ("", "\n") and s["utf8"].strip()]
        for idx, s in enumerate(segs):
            off = s.get("tOffsetMs") or 0
            start = e["tStartMs"] + off
            if prev_ms is not None and start <= prev_ms:
                delta = prev_ms + 10 - start
                if idx == 0:
                    e["tStartMs"] += delta  # shift the whole event, offsets stay
                else:
                    s["tOffsetMs"] = off + delta
                start = prev_ms + 10
            prev_ms = start

    out.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    shifts, scores = stats["shifts"], stats["scores"]
    print(f"\n{out}: {stats['events']} events / {stats['words']} words aligned, "
          f"{stats['fallback']} kept original", file=sys.stderr)
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
