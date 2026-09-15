# Looper

A language-learning tool for looping through video phrases: each phrase — or a single word within it — plays in a tight loop, for repeated listening. **The primary player is the console one**, `scripts/looper.py` (below); the browser app still works but is **deprecated**.

## Console player (primary)

`scripts/looper.py` runs Looper's loops in a terminal. The current unit is
rendered once by ffmpeg — cut, tempo-stretched (pitch preserved), with 8 ms
fades — and then looped as a file, so boundaries play back exactly as they
are stored: nothing is trimmed or seeked imprecisely.

```
python3 scripts/looper.py VIDEO.mp4 FILE.phrases.json [--phrase N] [--word-mode]
    [--speed 1.0] [--gap-ms 500] [--pad-ms 0] [--no-progress]
```

Build the phrases file with `--bias-ms 0 --end-bias-ms 75 --min-word-ms 0`
(see [Building the phrases file](#building-the-phrases-file-offline-forced-alignment)
for what each flag compensates) so word boundaries match their real audible
boundaries.

The keyboard mirrors the browser app — `Space`, `←`/`→`, `↑`/`↓`, `W`, `X`/`Z`, `P`,
`S`, `0`/`Home` — plus `Q` to quit (Cyrillic layout equivalents work too).
Subtitles behave exactly like the app: plain text, cut off after the
current word in word mode. Progress is saved to
`FILE.phrases.json.progress` and restored on the next run; `--phrase`
overrides it, `--no-progress` disables it. Playback goes through `afplay`
(macOS) or `ffplay -nodisp`; pausing stops the sound and resumes the unit
from its start.

## Browser app (deprecated)

Superseded by the console player above; still works, including offline as an
installable PWA.

1. Open the app and drop a video file (`.mp4`/`.webm`) and a `.phrases.json` phrases file (built with the [offline helper](#building-the-phrases-file-offline-forced-alignment) below)
2. Each phrase from the subtitle plays in a loop with a short gap between repeats
3. Press `W` to drill a single word instead of the whole phrase

In word mode, subtitles (when enabled with `S`) are cut off after the current word, so upcoming words stay hidden.

### Controls

Keyboard shortcuts:

| Key | Action |
|---|---|
| `Space` | Pause / resume |
| `←` | Previous phrase |
| `→` | Next phrase |
| `↑` / `↓` | Increase / decrease playback speed |
| `S` | Toggle subtitle text |
| `W` | Toggle phrase / word mode |
| `X` | Next word in the phrase *(word mode only)* |
| `Z` | Previous word in the phrase *(word mode only)* |
| `P` | Play the phrase from its start up to the current word, then return to what was playing before *(word mode only)* |
| `0` / `Home` | Go to first phrase |

Mouse:

| Input | Action |
|---|---|
| Click anywhere in the app | Pause / resume (same as `Space`) |

Progress is saved per video in localStorage.

## Building the phrases file (offline forced alignment)

The app plays a `.phrases.json` file: a list of phrases, each carrying its
words with per-word timings. It is built offline from a video and a YouTube
`.json3` subtitle file by `scripts/align_words.py`, which re-aligns the known
subtitle text to the audio with a CTC forced aligner (Meta MMS via
torchaudio). Word starts *and* ends come from the aligner — so in word mode a
word loops over its actual sound, without the trailing silence up to the next
word. Sentence grouping, the 10-second phrase splitting and clitic merging
(below) also happen in the script, so the app itself does no subtitle parsing.

```
uv venv .venv --python 3.12                      # once
uv pip install --python .venv/bin/python torch torchaudio uroman soundfile

.venv/bin/python scripts/align_words.py VIDEO.mp4 SUBS.json3
```

This writes `SUBS.phrases.json`; feed the media plus that file to the console
player (or drop both into the deprecated browser app).

The first run downloads the MMS aligner checkpoint (~1.2 GB). On Apple Silicon
it processes ~6–7 subtitle events per second via MPS; a 1.5-hour video takes a
few minutes. Useful flags: `--start/--end SEC` (align a time slice, handy for
quick tests), `--limit N`, `--device cpu`, `--tail-ms` (default 250 ms;
phrase-end padding after the last word), and the timing-bias trio:

- `--end-bias-ms` (default +75 ms) — a correction of the aligner itself, not a
  player compensation: CTC word spans end before the acoustic offset, and a
  final stop's release (the `d` burst of `gold`) can land up to ~70 ms after
  the aligned end. Keep it for every consumer; word ends are clamped to the
  next word's start, so it never swallows a neighbouring word in fused speech.
- `--bias-ms` (default −50 ms) and `--min-word-ms` (default 300 ms) —
  compensate the deprecated browser player (imprecise seeks; it stops word
  loops ~100 ms before `endTimeMs`). Zero both for the console player and
  standalone cuts.

Unstressed clitics (`the`, `of`, `in`, …) sound truncated when looped on
their own — acoustically they are usually fused with a neighbouring word,
and in the deprecated browser app units of ~100 ms or less do not sound at
all, because it cuts ~100 ms off the end of every loop. The script therefore
merges such words
into neighbouring units: list-based forward clitics join the next word,
auxiliaries and pronouns join the previous one, and any word that is very
short by its raw aligned sound, or whose final unit is too short to survive
the loop cut, joins a no-pause neighbour. Tune with `--clitic-gap-ms`
(pause threshold), `--clitic-words` / `--clitic-back-words` (word lists;
empty string disables), `--short-word-ms`, `--min-playable-ms`, and the
`--max-group-words` / `--max-group-ms` group caps (3 words / 1000 ms by
default). Merged units show up in `words[]` with a multi-word `text`
(e.g. `"of the stuff"`) and span the whole group.

Synthetic checks for the merge rules (no alignment deps needed):

```
python3 scripts/test_align_words.py
```

## Cutting one word into a file

`scripts/cut_word.py` slices a single word (or, without `--word`, a whole
phrase) out of the media file into a new audio file, using the aligned
per-word timings. Numbers are 1-based, like the app's counters:

```
python3 scripts/cut_word.py VIDEO.mp4 FILE.phrases.json --phrase 3 --word 5
python3 scripts/cut_word.py VIDEO.mp4 FILE.phrases.json --phrase 3      # whole phrase
```

By default the slice is re-encoded for accurate cut edges (`--copy` for a
fast stream copy), and `--pad-ms N` pads the window on both sides. Requires
`ffmpeg` on PATH.

For word boundaries that match the real audible ones — in the console player
and in standalone cuts — disable only the browser compensations and keep the
acoustic end correction:

```
.venv/bin/python scripts/align_words.py VIDEO.mp4 SUBS.json3 \
    -o SUBS.clean.phrases.json --bias-ms 0 --end-bias-ms 75 --min-word-ms 0
python3 scripts/cut_word.py VIDEO.mp4 SUBS.clean.phrases.json --phrase 5 --word 2
```

Zeroing `--end-bias-ms` as well (the old advice) truncates final stops: raw
CTC ends sit before the acoustic offset, so the `d` of `gold` gets cut
mid-closure, before its release burst. The bias is safe in fused speech —
word ends are clamped to the next word's start.

## Development

```
npm install
npm run dev
```

## Build

```
npm run build
```

## License

MIT
