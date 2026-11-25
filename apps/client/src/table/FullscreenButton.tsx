import { useEffect, useState } from "react";
import { isNativeClient } from "../nativeFiles.js";
import { fullscreenChangeEvents, isFullscreen, setFullscreen } from "../nativeWindow.js";

/**
 * Tracks full-screen mode and toggles it from the F key (Escape also leaves it in the desktop app, where the
 * browser does not). `onUnavailable` reports a browser that refuses full screen.
 */
export function useFullscreen(onUnavailable: () => void): [boolean, () => void] {
  const [fullscreen, setFullscreenState] = useState(false);
  const toggle = () => {
    void (async () => {
      try {
        setFullscreenState(await setFullscreen(!(await isFullscreen())));
      } catch {
        onUnavailable();
      }
    })();
  };
  useEffect(() => {
    const sync = () => { void isFullscreen().then(setFullscreenState).catch(() => undefined); };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape" && isNativeClient()) {
        void setFullscreen(false).then(setFullscreenState).catch(() => undefined);
      }
    };
    sync();
    for (const name of fullscreenChangeEvents) document.addEventListener(name, sync);
    document.addEventListener("keydown", onKey);
    return () => {
      for (const name of fullscreenChangeEvents) document.removeEventListener(name, sync);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  return [fullscreen, toggle];
}

/** The table's full-screen toggle (four corners). */
export function FullscreenButton({ fullscreen, onToggle }: { fullscreen: boolean; onToggle: () => void }) {
  const label = fullscreen ? "Exit full screen" : "Full screen";
  return <button className="icon-button" type="button" aria-label={label} aria-pressed={fullscreen} title={`${label} (F)`} onClick={onToggle}>
    <svg viewBox="0 0 24 24" aria-hidden="true">{fullscreen
      ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
  </button>;
}
