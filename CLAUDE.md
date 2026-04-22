# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Looper is a browser-based language learning tool that loops through video phrases using YouTube JSON3 subtitles. Users drop a video file (MP4/WebM) and a matching `.json3` subtitle file, then each subtitle phrase plays in a continuous loop.

## Commands

```bash
npm run dev          # Start dev server on port 3000
npm run build        # TypeScript check + Vite build
npm run test         # Run tests once (Vitest)
npm run test:watch   # Run tests in watch mode
npm run preview      # Preview production build
```

The project is deployed to GitHub Pages (base path: `/looper/`) via `.github/workflows/deploy.yml` on push to main.

## Architecture

Vanilla TypeScript with Vite. No framework — pure DOM manipulation via classes.

**Data flow:** YouTube JSON3 subtitle file → `parser.ts` (extracts words, groups into sentences, splits long phrases at 10s limit) → `Phrase[]` → `PhrasePlayer` (loops video to each phrase's time range with 200ms gap, supports 0.5x–2x playback speed) → `AppUI` (renders video + subtitle overlay, handles keyboard input, persists progress to localStorage).

**Key modules in `src/`:**
- `parser.ts` — Converts JSON3 events into `Phrase[]`. Splits long sentences at commas or timing gaps. Recursively handles phrases exceeding 10s.
- `player.ts` — `PhrasePlayer` class. Manages video playback, phrase looping via `timeupdate` events, playback speed control (0.5x–2x), and navigation (next/prev/start/pause/resume).
- `ui.ts` — `AppUI` class. File drag-and-drop handling, player rendering, keyboard shortcuts (Space: play/pause, Left/Right: prev/next phrase, Up/Down: playback speed, S: toggle subtitles, 0/Home: go to start), and localStorage progress persistence.
- `types.ts` — `Phrase`, `Json3Data`, `Json3Event`, `AppState` interfaces.

**Tests** live alongside source (`parser.test.ts`). Tests cover the parser only — the player and UI are untested.
