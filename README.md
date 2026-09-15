# Looper

A language-learning tool: a video and its subtitles are cut into phrases,
and each phrase — or a single word within it — plays in a tight loop for
repeated listening.

Two players share one data file (`.phrases.json`, built offline by
`scripts/align_words.py`):

- **`scripts/looper.py`** — console player, the primary one.
- **Browser app** (`src/`) — deprecated, phrase playback only.

## Console player

`scripts/looper.py` loops the current unit in a terminal. The unit is
rendered once by ffmpeg — cut, tempo-stretched (pitch preserved), with 8 ms
fades — and then looped as a file, so boundaries play back exactly as they
are stored: nothing is trimmed or seeked imprecisely. Sound goes through
`afplay` (macOS) or `ffplay -nodisp`; pausing stops the sound and resumes
the unit from its start.

```bash
python3 scripts/looper.py VIDEO.mp4 FILE.phrases.json [--phrase N] [--word-mode]
    [--speed 1.0] [--gap-ms 500] [--pad-ms 0] [--no-progress]
```

| Key | Action |
|---|---|
| `Space` | Pause / resume |
| `←` / `→` | Previous / next phrase |
| `↑` / `↓` | Increase / decrease playback speed (0.5×–2×, pitch preserved) |
| `W` | Toggle phrase / word mode |
| `X` / `Z` | Next / previous word *(word mode only)* |
| `P` | Play the phrase from its start up to the current word once, then resume the word loop *(word mode only)* |
| `S` | Toggle subtitles |
| `0` / `Home` | Go to first phrase |
| `Q` | Quit |

Cyrillic layout equivalents work too. Subtitles are plain text, cut off
after the current word in word mode, so upcoming words stay hidden.
Progress (phrase, word, mode, speed) is saved to
`FILE.phrases.json.progress` on every navigation and restored on the next
run; `--phrase` overrides it, `--no-progress` disables it.

## Building the phrases file

`scripts/align_words.py` builds the `.phrases.json` every player consumes:
a list of phrases, each carrying its text and per-word timings.

```json
{"version": 1, "phrases": [
  {"startTimeMs": 0, "endTimeMs": 4200, "text": "…",
   "words": [{"text": "…", "startTimeMs": 0, "endTimeMs": 380}, …]}]}
```

It takes a media file and a YouTube `.json3` subtitle file and re-aligns
the known subtitle text to the audio with a CTC forced aligner (Meta MMS
via torchaudio), so word starts *and* ends are acoustic, not guessed — a
word loops over its actual sound, without the trailing silence up to the
next word. The script also groups words into sentences, splits sentences
longer than 10 s at commas or timing gaps, and merges unstressed clitics
with neighbouring words (below). The players themselves do no subtitle
parsing.

Setup (`torch`, `torchaudio`, `uroman`, `soundfile` in a venv, `ffmpeg` on
PATH):

```bash
uv venv .venv --python 3.12                      # once
uv pip install --python .venv/bin/python torch torchaudio uroman soundfile

.venv/bin/python scripts/align_words.py VIDEO.mp4 SUBS.json3
```

This writes `SUBS.phrases.json` — feed it plus the media to the console
player (or drop both into the deprecated browser app). The first run
downloads the MMS aligner checkpoint (~1.2 GB); on Apple Silicon the
script aligns ~6–7 subtitle events per second via MPS, so a 1.5-hour video
takes a few minutes.

### Timing flags

The defaults already target audible boundaries, suitable for every player:

- `--end-bias-ms` (default +75) — a correction of the aligner itself, not a
  player compensation: raw CTC word ends sit before the acoustic offset,
  and a final stop's release (the `d` burst of `gold`) can land up to
  ~70 ms after the aligned end. Word ends are clamped to the next word's
  start, so it never swallows a neighbouring word in fused speech.
- `--bias-ms` (default 0) — shifts word starts; a small negative value
  adds a pre-roll cushion if a player's seeks land late.
- `--tail-ms` (default 250) — phrase-end padding after the last word.

Also handy: `--start/--end SEC` (align a time slice only, cheap for long
videos), `--limit N` (align at most N events, quick tests), `--device cpu`,
`-o OUT.phrases.json`.

### Clitic merging

Unstressed clitics (`the`, `of`, `in`, …) are acoustically fused with a
neighbouring word. Looped on their own they sound truncated, and very
short units barely sound at all — in any player. The script therefore
merges such words into neighbouring units:

- list-based forward clitics (articles, prepositions, conjunctions) join
  the next word;
- auxiliaries, copulas and pronouns join the previous word;
- any word too short by its raw aligned sound joins a no-pause neighbour;
- a final unit too short to survive looping is rescued into an adjacent
  group.

Merges never cross a sentence boundary and are capped at 3 words / 1000 ms
by default; the playability rescue may slightly exceed the caps. Merged
units show up in `words[]` with a multi-word `text` (e.g. `"of the stuff"`)
spanning the whole group. Tune with `--clitic-gap-ms` (pause threshold),
`--clitic-words` / `--clitic-back-words` (word lists; empty string
disables), `--short-word-ms`, `--min-playable-ms`, `--max-group-words`,
`--max-group-ms`.

Synthetic checks for the merge rules (no alignment deps needed):

```bash
python3 scripts/test_align_words.py
```

## Cutting one word into a file

`scripts/cut_word.py` slices a single word (or, without `--word`, a whole
phrase) out of the media file into a new audio file, using the aligned
per-word timings. Numbers are 1-based, like the player's counters:

```bash
python3 scripts/cut_word.py VIDEO.mp4 FILE.phrases.json --phrase 3 --word 5
python3 scripts/cut_word.py VIDEO.mp4 FILE.phrases.json --phrase 3      # whole phrase
```

The slice is re-encoded by default for accurate cut edges (`--copy` for a
fast stream copy); `--pad-ms N` pads the window on both sides. Requires
`ffmpeg` on PATH.

## Browser app (deprecated)

Superseded by the console player; still works, including offline as an
installable PWA. Phrase playback only:

1. Start the dev server (`npm run dev`) and open the app
2. Drop a video file (`.mp4`/`.webm`) and a `.phrases.json` phrases file
3. Each phrase plays in a loop with a short gap between repeats

| Key | Action |
|---|---|
| `Space` | Pause / resume |
| `←` | Previous phrase |
| `→` | Next phrase |
| `↑` / `↓` | Increase / decrease playback speed |
| `S` | Toggle subtitle text |
| `0` / `Home` | Go to first phrase |

Clicking the video pauses/resumes, same as `Space`. Progress is saved per
video in localStorage.

## Development

```bash
npm install
npm run dev        # dev server on port 3000
npm run test       # Vitest: parser + PhrasePlayer
npm run build      # TypeScript check + Vite build
```

Python-side checks: `python3 scripts/test_align_words.py` (clitic merge
rules, dependency-free).

## License

MIT
