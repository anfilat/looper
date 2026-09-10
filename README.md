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
