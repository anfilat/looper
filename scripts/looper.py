#!/usr/bin/env python3
"""Console word/phrase looper: play a phrases file's units in a tight loop.

Looper's primary player (the browser app is deprecated, phrase-only): an
audio file plus a .phrases.json (see scripts/align_words.py) are looped
phrase-by-phrase or word-by-word with ffmpeg-grade, sample-accurate
boundaries — the player never trims or seeks imprecisely, so word
boundaries play back exactly as stored. The aligner's timing defaults
target these audible boundaries: --end-bias-ms corrects the aligner itself
(raw CTC ends sit before the acoustic offset; a final stop's release lands
up to ~70 ms after the aligned end).

The current unit (word, phrase, or a P-prefix) is rendered once into a temp
wav — cut, tempo-stretched (pitch preserved) and given 8 ms fades — then
played in a loop through afplay (macOS) or ffplay -nodisp, with a pause
between iterations. Re-render happens only when the unit or speed changes.

Usage:
  python scripts/looper.py AUDIO FILE.phrases.json [--phrase N] [--word-mode]
      [--speed 1.0] [--gap-ms 500] [--pad-ms 0] [--no-progress]

Keys (same as the app):
  Space      pause/resume (resumes from the start of the unit)
  Left/Right previous/next phrase (unpauses)
  W          toggle phrase/word mode
  Z / X      previous/next word (word mode; unpauses)
  P          play phrase start -> current word once, then return to the
             state before P (word loop, or pause if it was paused)
  Up/Down    playback speed 0.5x..2.0x (step 0.25, pitch preserved)
  0 / Home   go to the first phrase (unpauses)
  S          toggle subtitle line
  Q / Ctrl-C quit

Progress (phrase/word/mode/speed) is saved to FILE.phrases.json.progress on
every navigation and restored on the next run, unless --phrase or
--no-progress is given.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import select
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from threading import Event, Thread
from typing import Any

from cut_word import fail, load_phrases

SPEED_MIN, SPEED_MAX, SPEED_STEP = 0.5, 2.0, 0.25
FADE_S = 0.008

# CSI/SS3 sequences: arrows, Home/End. Terminals in application cursor mode
# send \x1bO? instead of \x1b[? — accept both.
_ESC_RE = re.compile(rb"\x1b(?:\[[0-9;?]*[A-Za-z~]|O[A-Za-z])")
_ESC_KEYS = {
    b"\x1b[A": "up", b"\x1bOA": "up",
    b"\x1b[B": "down", b"\x1bOB": "down",
    b"\x1b[C": "right", b"\x1bOC": "right",
    b"\x1b[D": "left", b"\x1bOD": "left",
    b"\x1b[H": "home", b"\x1bOH": "home", b"\x1b[1~": "home",
}


class Unit:
    """A playble window: "word", "phrase", or a one-shot "prefix" (P key)."""

    def __init__(self, kind: str, start_ms: int, end_ms: int):
        self.kind = kind
        self.start_ms = start_ms
        self.end_ms = end_ms


def detect_player() -> list[str] | None:
    if shutil.which("ffmpeg") is None:
        fail("ffmpeg not found on PATH (see scripts/align_words.py requirements)")
    if shutil.which("afplay"):
        return ["afplay"]
    if shutil.which("ffplay"):
        return ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"]
    return None


def wrap_lines(text: str, width: int) -> list[str]:
    """Wrap on spaces only; never mid-word. First line stays bare if empty."""
    words = text.split()
    if not words:
        return [""]
    lines: list[str] = []
    cur = ""
    for word in words:
        cand = f"{cur} {word}" if cur else word
        if len(cand) > max(width, 8) and cur:
            lines.append(cur)
            cur = word
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines or [""]


class Looper:
    def __init__(self, audio: Path, phrases: list[dict[str, Any]],
                 args: argparse.Namespace):
        self.audio = audio
        self.phrases = phrases
        self.gap_ms = args.gap_ms
        self.pad_ms = args.pad_ms
        self.progress_path = None if args.no_progress else args.phrases.with_name(
            args.phrases.name + ".progress")

        self.phrase_idx = 0          # 0-based
        self.word_idx = 0            # 0-based within the phrase
        self.word_mode = bool(args.word_mode)
        self.speed = min(max(args.speed, SPEED_MIN), SPEED_MAX)
        self.paused = False
        self.show_subtitles = True
        self.prefix = False          # P: one-shot phrase start -> current word
        self.prefix_was_paused = False  # pause state to restore when it ends
        self.dirty = False           # worker changed visible state; main loop redraws
        self.quit = Event()

        self.token = 0               # bumped on any unit/speed change
        self.player = detect_player()
        if self.player is None:
            fail("no audio player found: need afplay (macOS) or ffplay")
        self.tmpdir = Path(tempfile.mkdtemp(prefix="looper-"))
        self.prev_lines = 0
        self._pending = b""
        self._eof = False

    # ---------- state helpers ----------

    def phrase(self) -> dict[str, Any]:
        return self.phrases[self.phrase_idx]

    def words(self) -> list[dict[str, Any]]:
        words = self.phrase().get("words")
        return words if isinstance(words, list) else []

    def current_unit(self) -> Unit:
        p = self.phrase()
        words = self.words()
        if self.word_mode and words and not self.prefix:
            w = words[self.word_idx]
            return Unit("word", w["startTimeMs"], w["endTimeMs"])
        if self.word_mode and self.prefix and words:
            w = words[self.word_idx]
            return Unit("prefix", p["startTimeMs"], w["endTimeMs"])
        # phrase mode, or word mode without word timings: whole phrase
        return Unit("phrase", p["startTimeMs"], p["endTimeMs"])

    def bump(self) -> None:
        self.token += 1

    def save_progress(self) -> None:
        if self.progress_path is None:
            return
        data = {"phrase": self.phrase_idx + 1, "word": self.word_idx + 1,
                "wordMode": self.word_mode, "speed": self.speed}
        try:
            self.progress_path.write_text(json.dumps(data), encoding="utf-8")
        except OSError:
            pass

    def load_progress(self) -> None:
        if self.progress_path is None or not self.progress_path.is_file():
            return
        try:
            data = json.loads(self.progress_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return
        phrase = data.get("phrase")
        if isinstance(phrase, int) and 1 <= phrase <= len(self.phrases):
            self.phrase_idx = phrase - 1
        word = data.get("word")
        if isinstance(word, int) and 1 <= word <= len(self.words()):
            self.word_idx = word - 1
        if isinstance(data.get("wordMode"), bool):
            self.word_mode = data["wordMode"]
        if isinstance(data.get("speed"), (int, float)):
            self.speed = min(max(float(data["speed"]), SPEED_MIN), SPEED_MAX)

    # ---------- rendering / playing (worker thread) ----------

    def render(self, unit: Unit) -> Path:
        start_s = max(unit.start_ms - self.pad_ms, 0) / 1000
        dur_s = (unit.end_ms - unit.start_ms + 2 * self.pad_ms) / 1000
        out = self.tmpdir / f"unit_{self.token}.wav"

        filters: list[str] = []
        if abs(self.speed - 1.0) > 1e-6:
            filters.append(f"atempo={self.speed:.4g}")
        out_dur = dur_s / self.speed
        if out_dur > 4 * FADE_S:  # fades must not swallow very short units
            filters.append(f"afade=t=in:st=0:d={FADE_S}")
            filters.append(f"afade=t=out:st={out_dur - FADE_S:.3f}:d={FADE_S}")

        cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
               "-ss", f"{start_s:.3f}", "-t", f"{dur_s:.3f}", "-i", str(self.audio),
               "-vn"]
        if filters:
            cmd += ["-af", ",".join(filters)]
        cmd += ["-c:a", "pcm_s16le", str(out)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            sys.stderr.write(result.stderr)
            fail(f"ffmpeg failed with code {result.returncode}")
        # Drop renders older than the current one.
        for old in self.tmpdir.glob("unit_*.wav"):
            if old != out:
                try:
                    old.unlink()
                except OSError:
                    pass
        return out

    def play(self, wav: Path, token: int) -> bool:
        """Play once; True iff it ran to the natural end."""
        try:
            proc = subprocess.Popen(self.player + [str(wav)])  # type: ignore[operator]
        except OSError as exc:
            fail(f"cannot start player: {exc}")
        while proc.poll() is None:
            if self.quit.is_set() or self.token != token:
                proc.terminate()
                proc.wait()
                return False
            if self.paused:
                proc.terminate()
                proc.wait()
                return False
            time.sleep(0.02)
        return True

    def gap_sleep(self, token: int) -> None:
        end = time.monotonic() + self.gap_ms / 1000
        while time.monotonic() < end:
            if self.quit.is_set() or self.token != token or self.paused:
                return
            time.sleep(0.05)

    def worker(self) -> None:
        while not self.quit.is_set():
            token = self.token
            unit = self.current_unit()
            wav = self.render(unit)
            if self.quit.is_set() or self.token != token:
                continue
            while self.paused and not self.quit.is_set() and self.token == token:
                time.sleep(0.05)
            if self.quit.is_set() or self.token != token:
                continue
            finished = self.play(wav, token)
            if self.quit.is_set() or self.token != token:
                continue
            if finished and unit.kind == "prefix":
                self.prefix = False
                self.paused = self.prefix_was_paused
                self.bump()
                self.dirty = True  # the status line shows the restored pause again
                continue
            if finished:
                self.gap_sleep(token)

    # ---------- display ----------

    def subtitle_text(self) -> str:
        p = self.phrase()
        words = self.words()
        if self.word_mode and words:
            return " ".join(w["text"] for w in words[:self.word_idx + 1])
        return str(p.get("text", ""))

    def status_line(self) -> str:
        words = self.words()
        word_part = (f"word {self.word_idx + 1}/{len(words)} · " if self.word_mode and words else "")
        mode = "word" if self.word_mode else "phrase"
        pause = " · paused" if self.paused else ""
        return (f"phrase {self.phrase_idx + 1}/{len(self.phrases)} · {word_part}"
                f"{mode} · {self.speed:g}x{pause}")

    def draw(self) -> None:
        cols = shutil.get_terminal_size().columns
        lines = [self.status_line()]
        if self.show_subtitles:
            lines += wrap_lines(self.subtitle_text(), cols)
        parts = []
        if self.prev_lines:
            # The cursor sits at the END of the last written line (the join
            # below emits no trailing newline), so getting back to the first
            # line is \r + (N-1) lines up — NOT \x1b[N F, which would drift
            # one row up on every redraw.
            parts.append("\r")
            if self.prev_lines > 1:
                parts.append(f"\x1b[{self.prev_lines - 1}A")
            parts.append("\x1b[J")  # clear this row and everything below
        parts.append("\r\n".join("\x1b[2K" + ln for ln in lines))
        sys.stdout.write("".join(parts))
        sys.stdout.flush()
        self.prev_lines = len(lines)

    # ---------- keyboard ----------

    def _wait_fd(self, timeout: float) -> bool:
        """True if more bytes arrive on stdin within the timeout."""
        return bool(select.select([sys.stdin], [], [], timeout)[0])

    def _fill(self, timeout: float | None = None) -> bool:
        """Read more raw bytes from the fd (no Python-side buffering).
        Returns False on EOF or (with a timeout) if nothing arrived."""
        if timeout is not None and not self._wait_fd(timeout):
            return False
        data = os.read(sys.stdin.fileno(), 32)
        if not data:
            self._eof = True
            return False
        self._pending += data
        return True

    def read_key(self, timeout: float | None = None) -> str | None:
        """Next key: a decoded character, a named key (up/down/left/right/
        home/esc), "" on poll timeout, or None on EOF."""
        while True:
            if self._pending:
                if self._pending.startswith(b"\x1b"):
                    if len(self._pending) > 1:
                        match = _ESC_RE.match(self._pending)
                        if match:  # complete escape sequence
                            seq = match.group(0)
                            self._pending = self._pending[len(seq):]
                            return _ESC_KEYS.get(seq, "esc")
                        if re.fullmatch(rb"\x1b(?:\[[0-9;?]*|O)?", self._pending[:6]):
                            # sequence may be split across reads: wait for tail
                            if self._fill(0.05):
                                continue
                        # \x1b followed by a printable byte: treat as Esc
                        self._pending = self._pending[1:]
                        return "esc"
                    # lone \x1b: give the rest of the sequence 50 ms to land
                    if self._fill(0.05):
                        continue
                    self._pending = self._pending[1:]
                    return "esc"
                if self._pending[0] < 0x80:  # ASCII
                    ch = chr(self._pending[0])
                    self._pending = self._pending[1:]
                    return ch
                for n in (4, 3, 2):  # UTF-8 multibyte (e.g. Cyrillic keys)
                    try:
                        ch = self._pending[:n].decode("utf-8")
                    except UnicodeDecodeError:
                        continue
                    if ch:
                        self._pending = self._pending[n:]
                        return ch
                # partial multibyte char: wait for its tail
                if self._fill(0.1):
                    continue
                self._pending = self._pending[1:]  # undecodable: drop a byte
                continue
            if self._eof:
                return None
            if not self._fill(timeout):
                return ""

    def handle_key(self, key: str) -> None:
        if key == " ":
            self.paused = not self.paused
            self.bump()
        elif key in ("right", "d"):
            self.phrase_idx = min(self.phrase_idx + 1, len(self.phrases) - 1)
            self.word_idx = 0
            self.paused = False
            self.bump()
        elif key in ("left", "a"):
            self.phrase_idx = max(self.phrase_idx - 1, 0)
            self.word_idx = 0
            self.paused = False
            self.bump()
        elif key in ("w", "W", "ц", "Ц"):
            self.word_mode = not self.word_mode
            self.bump()
        elif key in ("x", "X", "ч", "Ч"):
            if self.word_mode:
                self.word_idx = min(self.word_idx + 1, max(len(self.words()) - 1, 0))
                self.paused = False
                self.bump()
        elif key in ("z", "Z", "я", "Я"):
            if self.word_mode:
                self.word_idx = max(self.word_idx - 1, 0)
                self.paused = False
                self.bump()
        elif key in ("p", "P", "з", "З"):
            if self.word_mode and self.words():
                self.prefix_was_paused = self.paused
                self.prefix = True
                self.paused = False
                self.bump()
        elif key == "up":
            self.speed = min(round(self.speed + SPEED_STEP, 2), SPEED_MAX)
            self.bump()
        elif key == "down":
            self.speed = max(round(self.speed - SPEED_STEP, 2), SPEED_MIN)
            self.bump()
        elif key in ("0", "home"):
            self.phrase_idx = 0
            self.word_idx = 0
            self.paused = False
            self.bump()
        elif key in ("s", "S", "ы", "Ы"):
            self.show_subtitles = not self.show_subtitles
        elif key in ("q", "Q", "й", "Й", "\x03"):
            self.quit.set()
            return
        else:
            return
        self.save_progress()

    # ---------- main loop ----------

    def run(self) -> None:
        import termios
        old_term = termios.tcgetattr(sys.stdin)
        try:
            import tty
            tty.setraw(sys.stdin.fileno())
            worker = Thread(target=self.worker, daemon=True)
            worker.start()
            self.draw()
            while not self.quit.is_set():
                key = self.read_key(0.2)
                if key is None:  # EOF on stdin
                    break
                if key == "":  # poll: worker may have changed visible state
                    if self.dirty:
                        self.dirty = False
                        self.draw()
                    continue
                self.handle_key(key)
                self.draw()
        except KeyboardInterrupt:
            self.quit.set()
        finally:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_term)
            self.quit.set()
            time.sleep(0.05)  # let the worker terminate any player process
            shutil.rmtree(self.tmpdir, ignore_errors=True)
            print()


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Console phrase/word looper for .phrases.json files."
    )
    parser.add_argument("audio", type=Path, help="audio (or video) file")
    parser.add_argument("phrases", type=Path, help=".phrases.json from scripts/align_words.py")
    parser.add_argument("--phrase", type=int, default=None,
                        help="start phrase, 1-based (overrides saved progress)")
    parser.add_argument("--word-mode", action="store_true",
                        help="start in word mode instead of phrase mode")
    parser.add_argument("--speed", type=float, default=1.0,
                        help="initial playback speed, 0.5..2.0 (default 1.0)")
    parser.add_argument("--gap-ms", type=int, default=500,
                        help="pause between loop iterations, milliseconds")
    parser.add_argument("--pad-ms", type=int, default=0,
                        help="pad each played unit on both sides, milliseconds")
    parser.add_argument("--no-progress", action="store_true",
                        help="do not read or write the progress sidecar file")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    if not args.audio.is_file():
        fail(f"audio file not found: {args.audio}")
    phrases = load_phrases(args.phrases)
    if not phrases:
        fail(f"{args.phrases}: no phrases")
    if not sys.stdin.isatty():
        fail("interactive terminal required")

    looper = Looper(args.audio, phrases, args)
    if args.phrase is not None:
        if not 1 <= args.phrase <= len(phrases):
            fail(f"phrase {args.phrase} out of range: file has {len(phrases)} phrases")
        looper.phrase_idx = args.phrase - 1
    else:
        looper.load_progress()
    looper.run()


if __name__ == "__main__":
    main()
