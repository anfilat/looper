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
  const { phraseIndex, speed, controls } = usePhrasePlayer(
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
        case "Digit0":
        case "Home":
          controls.goToStart();
          break;
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [controls]);

  const subtitleText = phrases[phraseIndex]?.text;

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
        <div className={styles.phraseCounter}>
          {phraseIndex + 1} / {phrases.length}
        </div>
      </div>
    </div>
  );
}
