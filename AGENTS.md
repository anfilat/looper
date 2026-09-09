# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Project Overview

Looper is a browser-based language learning tool that loops through video phrases using YouTube JSON3 subtitles. Users drop a video file (MP4/WebM) and a matching `.json3` subtitle file, then each subtitle phrase plays in a continuous loop. It ships as an installable **PWA** with offline support.

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

**Data flow:** YouTube JSON3 subtitle file → `parser.ts` (extracts words, groups into sentences, splits long phrases at 10s limit) → `Phrase[]` → `PhrasePlayer` (loops video to each phrase's time range with 200ms gap, supports 0.5x–2x playback speed) → `App` (screen state, recents, progress persistence).

**Key modules in `src/`:**
- `main.tsx` — Entry point. Imports styles and mounts `App` on `#app` via `createRoot`.
- `parser.ts` — Converts JSON3 events into `Phrase[]`. Splits long sentences at commas or timing gaps. Recursively handles phrases exceeding 10s.
- `player.ts` — `PhrasePlayer` class. Manages video playback, phrase looping via `requestAnimationFrame`, playback speed control (0.5x–2x), and navigation (next/prev/start/pause/resume).
- `hooks/usePhrasePlayer.ts` — React binding for `PhrasePlayer`: creates the player when the video mounts, starts looping on `loadeddata`, mirrors `phraseIndex`/`speed` into state, returns stable `controls`. Callbacks are held in refs so the player is never re-created.
- `screens/PlayerScreen.tsx` — The player screen: video element, subtitle overlay, phrase counter, speed label, keyboard shortcuts (Space: play/pause, Left/Right: prev/next phrase, Up/Down: playback speed, S: toggle subtitles, 0/Home: go to start), click-to-pause. Cleanup (listeners, object URL) happens in effect cleanups.
- `screens/FilePickerScreen.tsx` — The file selection screen: drop zone, recents list, File System Access API picker with plain file-input fallback, video/subtitle classification by extension. The hidden file input lives outside the drop zone so its synthetic click does not re-trigger the drop-zone handler.
- `recents.ts` — Recent files storage: display list (max 5, newest first) in localStorage, `FileSystemFileHandle`s in IndexedDB; add/remove/touch helpers.
- `fs-access.d.ts` — Ambient declarations for the Chromium-only File System Access API parts used here.
- `App.tsx` — `App` component. Thin orchestrator: screen state (picker/player), the shared open flow (parse subtitles, recents bookkeeping, failure handling), recents state, localStorage progress persistence.
- `types.ts` — `Phrase`, `Json3Data`, `Json3Event` interfaces.

**Tests** live alongside source (`parser.test.ts`, `player.test.ts`). They cover the parser and the `PhrasePlayer` class; the React components are untested.

## Deployment

The project is deployed to GitHub Pages (base path: `/looper/`) via `.github/workflows/deploy.yml` on push to `main`. The workflow uses Node 24, runs `npm ci` + `npm run build`, and uploads `dist/` as the Pages artifact.
