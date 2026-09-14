# Looper

A browser-based tool for looping through video phrases with subtitle support. Designed for language learning by repeating short segments of video one at a time. Supports two loop modes: the whole phrase, or a single word within it.

## Usage

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
word. Sentence grouping and the 10-second phrase splitting also happen in the
script, so the app itself does no subtitle parsing.

```
uv venv .venv --python 3.12                      # once
uv pip install --python .venv/bin/python torch torchaudio uroman soundfile

.venv/bin/python scripts/align_words.py VIDEO.mp4 SUBS.json3
```

This writes `SUBS.phrases.json`; drop the video plus that file into the app.

The first run downloads the MMS aligner checkpoint (~1.2 GB). On Apple Silicon
it processes ~6–7 subtitle events per second via MPS; a 1.5-hour video takes a
few minutes. Useful flags: `--start/--end SEC` (align a time slice, handy for
quick tests), `--limit N`, `--device cpu`, `--bias-ms` (default −50 ms; CTC
word spans start slightly after the acoustic onset, so starts are shifted
earlier for a small pre-roll cushion), `--end-bias-ms` (default +75 ms; CTC
spans end before the acoustic offset), `--min-word-ms` (default 300 ms; the
app stops word loops ~100 ms before `endTimeMs`, so shorter words would lose
their tail), `--tail-ms` (default 250 ms; phrase-end padding after the last
word).

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
