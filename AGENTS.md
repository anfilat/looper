# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Overview

Looper is a browser-based language learning tool that loops through video phrases. Users drop a video file (MP4/WebM) and a matching `.phrases.json` phrases file (built offline by `scripts/align_words.py` from a video and YouTube JSON3 subtitles), then each phrase plays in a continuous loop. It ships as an installable **PWA** with offline support.

## Commands

```bash
npm run dev          # Start dev server on port 3000
npm run build        # TypeScript check + Vite build
npm run test         # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode
npm run preview      # Preview production build
```

## Architecture

React 19 + TypeScript with Vite. Components are plain functions with hooks (no state library). Styling is CSS Modules (`*.module.css`) plus a small global `style.css` for resets. Configured as a PWA via `vite-plugin-pwa` (manifest, service worker, offline fallback) in `vite.config.ts`, with base path `/looper/`.

**Entry point:** `src/main.tsx` imports `style.css` and renders `App` into `#app` via `createRoot`.

**Data flow:** video + YouTube JSON3 subtitle file → `scripts/align_words.py` (offline: forced alignment gives every word a real start *and* end, groups words into sentences, splits phrases longer than 10s) → `.phrases.json` (`{"version": 1, "phrases": ...}` shaped as `Phrase[]`) → `parser.ts` (thin validated loader) → `PhrasePlayer` (loops the current phrase or, in word mode, a single word; 500ms gap, 0.5x–2x playback speed) → `App` (screen state, recents, progress persistence).

**Offline helper:** `scripts/align_words.py` — builds the `.phrases.json` the app plays: aligns the known subtitle text to the audio with a CTC forced aligner (torchaudio MMS_FA), so word starts/ends are acoustic, not "end = next word's start" guesses; groups words into sentences, splits phrases longer than 10s, and merges unstressed clitics (`the`, `of`, auxiliaries, pronouns, anything very short) with a neighbouring word when no pause separates them — lone clitic loops sound truncated or, under ~100 ms, do not play at all (the app cuts ~100 ms off every loop end). Unaligned events (e.g. outside `--start/--end`) keep original timings. Requires `torch`, `torchaudio`, `uroman`, `soundfile` and `ffmpeg` (see README).

**CLI companions:** `scripts/cut_word.py` — cuts one word (or, without `--word`, a whole phrase) out of the media file into a new audio file via ffmpeg; 1-based indices matching the app's counters, `--pad-ms`, re-encode by default (`--copy` for stream copy). `scripts/looper.py` — console counterpart of the app player: same keyboard map and subtitle behaviour (truncated at the current word in word mode), phrase/word units rendered sample-accurately by ffmpeg (`atempo` speed, 8ms fades) and looped via `afplay`/`ffplay`; progress sidecar `FILE.phrases.json.progress`, restored on the next run. It reuses `cut_word.py`'s loader (`load_phrases`/`fail`), so both stay in sync. Note: the aligner's bias defaults (`--bias-ms -50`, `--end-bias-ms 75`, `--min-word-ms 300`) compensate the browser player's ~100ms loop-end cut; for standalone cuts and console looping regenerate an unbiased file (`--bias-ms 0 --end-bias-ms 0 --min-word-ms 0`).

**Key modules in `src/`:**
- `main.tsx` — Entry point. Imports styles and mounts `App` on `#app` via `createRoot`.
- `parser.ts` — Validated loader for the `.phrases.json` file written by `scripts/align_words.py`; returns `Phrase[]` with per-word timings (`WordTiming`: start/end per word, ends are acoustic), or `[]` for malformed/unsupported data. No subtitle parsing happens in the app.
- `player.ts` — `PhrasePlayer` class. Manages video playback, phrase/word looping via `requestAnimationFrame`, playback speed control (0.5x–2x), navigation (next/prev/start/pause/resume), and two playback modes: phrase mode (whole phrase) and word mode (single word of the current phrase; `toggleMode`, `nextWord`/`prevWord`, `playToCurrentWord` — one-shot phrase start → current word via P, then restores the pre-P state). Word index resets to 0 on phrase change; phrase navigation without word timings falls back to the phrase range.
- `hooks/usePhrasePlayer.ts` — React binding for `PhrasePlayer`: creates the player when the video mounts, starts looping on `loadeddata`, mirrors `phraseIndex`/`speed` into state, returns stable `controls`. Callbacks are held in refs so the player is never re-created.
- `screens/PlayerScreen.tsx` — The player screen: video element, subtitle overlay (truncated at the current word in word mode), phrase/word counters, mode label, speed label, keyboard shortcuts (Space: play/pause, Left/Right: prev/next phrase, Up/Down: playback speed, W: toggle phrase/word mode, X/Z: next/prev word (word mode only), P: play phrase start → current word (word mode only), S: toggle subtitles, 0/Home: go to start), click-to-pause. Cleanup (listeners, object URL) happens in effect cleanups.
- `screens/FilePickerScreen.tsx` — The file selection screen: drop zone, recents list, File System Access API picker with plain file-input fallback, video (`.mp4`/`.webm`) / phrases (`.json`) classification by extension. The hidden file input lives outside the drop zone so its synthetic click does not re-trigger the drop-zone handler.
- `recents.ts` — Recent files storage: display list (max 5, newest first) in localStorage, `FileSystemFileHandle`s in IndexedDB; add/remove/touch helpers.
- `fs-access.d.ts` — Ambient declarations for the Chromium-only File System Access API parts used here.
- `App.tsx` — `App` component. Thin orchestrator: screen state (picker/player), the shared open flow (load the phrases file, recents bookkeeping, failure handling), recents state, localStorage progress persistence.
- `types.ts` — `Phrase`, `WordTiming` interfaces.

**Tests** live alongside source (`parser.test.ts`, `player.test.ts`). They cover the phrases loader and the `PhrasePlayer` class; the React components are untested. The clitic-merge logic in `scripts/align_words.py` has its own dependency-free checks: `python3 scripts/test_align_words.py` (run it when changing the merge rules).

## Deployment

The project is deployed to GitHub Pages (base path: `/looper/`) via `.github/workflows/deploy.yml` on push to `main`. The workflow uses Node 24, runs `npm ci` + `npm run build`, and uploads `dist/` as the Pages artifact.
