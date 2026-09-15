#!/usr/bin/env python3
"""Cut one word (or a whole phrase) out of an audio file into a new file.

Reads the .phrases.json produced by scripts/align_words.py, picks the window
of the requested word (or phrase), and slices the audio with ffmpeg:

  python scripts/cut_word.py AUDIO FILE.phrases.json --phrase 3 --word 5
      [-o OUT.m4a] [--pad-ms 50] [--copy]

Phrase and word numbers are 1-based, matching the counters shown in the app.
Omit --word to cut the whole phrase. Word ends are acoustic (forced-alignment)
and tight, so a little --pad-ms often makes the cut sound more natural.

By default the slice is re-encoded (accurate cut edges, codec chosen by the
output extension); --copy switches to fast stream copy, where edges snap to
the codec's frame boundaries. Requires ffmpeg on PATH.

Exit codes: 0 ok, 1 bad data/arguments, 2 ffmpeg failed.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

# Output extension -> extra ffmpeg arguments for the re-encode path.
CODEC_ARGS: dict[str, list[str]] = {
    ".mp3": ["-c:a", "libmp3lame", "-q:a", "2"],
    ".m4a": ["-c:a", "aac", "-b:a", "192k"],
    ".mp4": ["-c:a", "aac", "-b:a", "192k"],
    ".wav": ["-c:a", "pcm_s16le"],
    ".flac": ["-c:a", "flac"],
    ".ogg": ["-c:a", "libvorbis", "-q:a", "4"],
    ".oga": ["-c:a", "libvorbis", "-q:a", "4"],
    ".opus": ["-c:a", "libopus", "-b:a", "96k"],
}


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def load_phrases(path: Path) -> list[dict[str, Any]]:
    """Load and minimally validate a .phrases.json; fail() on bad data."""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        fail(f"phrases file not found: {path}")
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"cannot read phrases file {path}: {exc}")

    phrases = data.get("phrases") if isinstance(data, dict) else None
    if not isinstance(phrases, list) or not all(isinstance(p, dict) for p in phrases):
        fail(f"{path}: expected {{\"version\": 1, \"phrases\": [...]}}")
    for i, phrase in enumerate(phrases, 1):
        for key in ("startTimeMs", "endTimeMs"):
            if not isinstance(phrase.get(key), (int, float)):
                fail(f"{path}: phrase {i} has no numeric {key}")
    return phrases


def pick_window(
    phrases: list[dict[str, Any]], phrase_no: int, word_no: int | None
) -> tuple[float, float, str]:
    """Return (start_s, end_s, label) for the 1-based phrase/word numbers."""
    if not 1 <= phrase_no <= len(phrases):
        fail(f"phrase {phrase_no} out of range: file has {len(phrases)} phrases")
    phrase = phrases[phrase_no - 1]

    if word_no is None:
        start_ms = phrase["startTimeMs"]
        end_ms = phrase["endTimeMs"]
        text = str(phrase.get("text", "")).strip()
        return start_ms / 1000, end_ms / 1000, f"phrase {phrase_no}: {text!r}"

    words = phrase.get("words")
    if not isinstance(words, list) or not words:
        fail(f"phrase {phrase_no} has no word timings")
    if not 1 <= word_no <= len(words):
        fail(f"word {word_no} out of range: phrase {phrase_no} has {len(words)} words")
    word = words[word_no - 1]
    if not isinstance(word, dict) or not all(
        isinstance(word.get(k), (int, float)) for k in ("startTimeMs", "endTimeMs")
    ):
        fail(f"word {word_no} of phrase {phrase_no} has no numeric timings")

    start_ms = word["startTimeMs"]
    end_ms = word["endTimeMs"]
    text = str(word.get("text", "")).strip()
    return start_ms / 1000, end_ms / 1000, f"word {word_no} of phrase {phrase_no}: {text!r}"


def default_output(audio: Path, phrase_no: int, word_no: int | None) -> Path:
    stem = f"{audio.stem}_p{phrase_no}"
    if word_no is not None:
        stem += f"_w{word_no}"
    return audio.with_name(stem + audio.suffix)


def run_ffmpeg(
    audio: Path, out: Path, start_s: float, end_s: float, stream_copy: bool
) -> None:
    if shutil.which("ffmpeg") is None:
        fail("ffmpeg not found on PATH (see scripts/align_words.py requirements)")

    args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{start_s:.3f}", "-t", f"{max(end_s - start_s, 0.001):.3f}",
            "-i", str(audio), "-vn"]
    if stream_copy:
        args += ["-c", "copy"]
    else:
        args += CODEC_ARGS.get(out.suffix.lower(), [])
    args.append(str(out))

    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        print(f"error: ffmpeg failed with code {result.returncode}", file=sys.stderr)
        sys.exit(2)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Cut a word (or whole phrase) from an audio file into a new file."
    )
    parser.add_argument("audio", type=Path, help="source audio (or video) file")
    parser.add_argument("phrases", type=Path, help=".phrases.json from scripts/align_words.py")
    parser.add_argument("--phrase", type=int, required=True, help="phrase number, 1-based")
    parser.add_argument("--word", type=int, default=None,
                        help="word number, 1-based; omit to cut the whole phrase")
    parser.add_argument("-o", "--output", type=Path, default=None,
                        help="output file (default: <audio>_p<N>[_w<M>].<audio suffix>)")
    parser.add_argument("--pad-ms", type=int, default=0,
                        help="pad the cut window on both sides, milliseconds")
    parser.add_argument("--copy", action="store_true",
                        help="stream copy instead of re-encode (fast, but cut edges "
                             "snap to codec frame boundaries)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    if not args.audio.is_file():
        fail(f"audio file not found: {args.audio}")
    if args.phrase < 1 or (args.word is not None and args.word < 1):
        fail("--phrase and --word are 1-based and must be >= 1")

    phrases = load_phrases(args.phrases)
    start_s, end_s, label = pick_window(phrases, args.phrase, args.word)

    pad_s = args.pad_ms / 1000
    start_s = max(start_s - pad_s, 0.0)
    end_s = end_s + pad_s

    out = args.output or default_output(args.audio, args.phrase, args.word)
    run_ffmpeg(args.audio, out, start_s, end_s, args.copy)

    print(f"{out}: {label} [{start_s:.3f}s - {end_s:.3f}s]")


if __name__ == "__main__":
    main()
