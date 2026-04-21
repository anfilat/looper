# Looper

A browser-based tool for looping through video phrases with subtitle support. Designed for language learning by repeating short segments of video one at a time.

## Usage

1. Open the app and drop a video file (`.mp4`/`.webm`) and a YouTube `.json3` subtitle file
2. Each phrase from the subtitle plays in a loop with a short gap between repeats

### Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Next phrase |
| `←` | Previous phrase |
| `.` | Toggle subtitle text (pauses playback) |
| `0` / `Home` | Go to first phrase |

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
