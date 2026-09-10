import { useEffect, useMemo, useRef, useState } from "react";
import { usePhrasePlayer } from "../hooks/usePhrasePlayer";
import type { Phrase } from "../types";
import styles from "./PlayerScreen.module.css";

export interface PlayerScreenProps {
  videoFile: File;
  phrases: Phrase[];
  startIndex: number;
  /** Called on every phrase change so the app can persist progress. */
  onPhraseChange(index: number): void;
  /** The video element failed to load or decode. */
  onVideoError(): void;
}

/** Player screen: video, subtitle overlay, HUD and keyboard/click controls.
  * All document-level listeners and the video object URL are cleaned up on
  * unmount. */
export function PlayerScreen({
  videoFile,
  phrases,
  startIndex,
  onPhraseChange,
  onVideoError,
}: PlayerScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [subtitlesVisible, setSubtitlesVisible] = useState(false);
  const { phraseIndex, wordIndex, mode, speed, controls } = usePhrasePlayer(
    videoRef,
    phrases,
    startIndex,
    onPhraseChange,
    onVideoError
  );

  // Object URL for the dropped file; revoked when the file changes / unmount.
  const videoUrl = useMemo(() => URL.createObjectURL(videoFile), [videoFile]);
  useEffect(() => () => URL.revokeObjectURL(videoUrl), [videoUrl]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      switch (e.code) {
        case "Space":
          e.preventDefault();
          controls.togglePause();
          break;
        case "ArrowLeft":
          controls.prevPhrase();
          break;
        case "ArrowRight":
          controls.nextPhrase();
          break;
        case "ArrowUp":
          controls.increaseSpeed();
          break;
        case "ArrowDown":
          controls.decreaseSpeed();
          break;
        case "KeyS":
          setSubtitlesVisible((visible) => !visible);
          break;
        case "KeyW":
          controls.toggleMode();
          break;
        case "KeyX":
          if (mode === "word") controls.nextWord();
          break;
        case "KeyZ":
          if (mode === "word") controls.prevWord();
          break;
        case "KeyP":
          if (mode === "word") controls.playToCurrentWord();
          break;
        case "Digit0":
        case "Home":
          controls.goToStart();
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [controls, mode]);

  const currentPhrase = phrases[phraseIndex];
  const wordCount = currentPhrase?.words.length ?? 0;
  // In word mode subtitles stop at the current word — future words stay hidden.
  const subtitleText =
    mode === "word" && currentPhrase && wordCount > 0
      ? currentPhrase.words
          .slice(0, wordIndex + 1)
          .map((w) => w.text)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      : currentPhrase?.text;

  // Mouse click on the video area toggles playback, same as Space. The
  // bottom bar is outside the clickable area.
  return (
    <div className={styles.layout}>
      <div className={styles.player} onClick={controls.togglePause}>
        <video ref={videoRef} src={videoUrl} />
        {subtitlesVisible && subtitleText && (
          <div className={styles.subtitleOverlay}>{subtitleText}</div>
        )}
      </div>
      <div className={styles.bottomBar}>
        <div className={styles.speedLabel}>{speed}x</div>
        <div className={styles.modeLabel}>
          {mode === "word" ? "Word mode" : "Phrase mode"}
        </div>
        {mode === "word" && (
          <div className={styles.wordCounter}>
            {wordIndex + 1} / {wordCount}
          </div>
        )}
        <div className={styles.phraseCounter}>
          {phraseIndex + 1} / {phrases.length}
        </div>
      </div>
    </div>
  );
}
