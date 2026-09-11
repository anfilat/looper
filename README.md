# Looper

A browser-based tool for looping through video phrases with subtitle support. Designed for language learning by repeating short segments of video one at a time. Supports two loop modes: the whole phrase, or a single word within it.

## Usage

1. Open the app and drop a video file (`.mp4`/`.webm`) and a YouTube `.json3` subtitle file
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

## Sharper word boundaries (offline forced alignment)

YouTube's word-level timestamps are approximate: in word mode words often lose
their beginnings/endings and capture pieces of neighboring words. The offline
helper `scripts/align_words.py` re-aligns the known subtitle text to the audio
with a CTC forced aligner (Meta MMS via torchaudio) and writes a `.json3` in
the same format, but with accurate word boundaries. Drop the video plus the
aligned `.json3` into the app as usual — no app changes needed.

```
uv venv .venv --python 3.12                      # once
uv pip install --python .venv/bin/python torch torchaudio uroman soundfile

.venv/bin/python scripts/align_words.py VIDEO.mp4 SUBS.json3 -o SUBS.aligned.json3
```

The first run downloads the MMS aligner checkpoint (~1.2 GB). On Apple Silicon
it processes ~6–7 subtitle events per second via MPS; a 1.5-hour video takes a
few minutes. Useful flags: `--start/--end SEC` (align a time slice, handy for
quick tests), `--limit N`, `--device cpu`, `--bias-ms` (default −50 ms; CTC
word spans start slightly after the acoustic onset, so starts are shifted
earlier for a small pre-roll cushion).

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
