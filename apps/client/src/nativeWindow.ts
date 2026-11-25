import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

// Safari before iPadOS / macOS 16.4 only has the webkit-prefixed Fullscreen API.
type WebkitDocument = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type WebkitElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? (document as WebkitDocument).webkitFullscreenElement ?? null;
}

/** The events a browser fires when it enters or leaves full screen. */
export const fullscreenChangeEvents = ["fullscreenchange", "webkitfullscreenchange"] as const;

/** Whether the table currently fills the screen. */
export async function isFullscreen(): Promise<boolean> {
  if (isTauri()) return getCurrentWindow().isFullscreen();
  return !!fullscreenElement();
}

/** Switches full-screen mode and resolves to the new state. */
export async function setFullscreen(next: boolean): Promise<boolean> {
  if (isTauri()) {
    await getCurrentWindow().setFullscreen(next);
    return next;
  }
  if (next && !fullscreenElement()) {
    const root = document.documentElement as WebkitElement;
    if (root.requestFullscreen) await root.requestFullscreen();
    else if (root.webkitRequestFullscreen) await root.webkitRequestFullscreen();
    else throw new Error("Full screen is not supported");
  }
  if (!next && fullscreenElement()) {
    const doc = document as WebkitDocument;
    if (doc.exitFullscreen) await doc.exitFullscreen();
    else await doc.webkitExitFullscreen?.();
  }
  return !!fullscreenElement();
}
