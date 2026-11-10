import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Whether the table currently fills the screen. */
export async function isFullscreen(): Promise<boolean> {
  if (isTauri()) return getCurrentWindow().isFullscreen();
  return !!document.fullscreenElement;
}

/** Switches full-screen mode and resolves to the new state. */
export async function setFullscreen(next: boolean): Promise<boolean> {
  if (isTauri()) {
    await getCurrentWindow().setFullscreen(next);
    return next;
  }
  if (next && !document.fullscreenElement) await document.documentElement.requestFullscreen?.();
  if (!next && document.fullscreenElement) await document.exitFullscreen?.();
  return !!document.fullscreenElement;
}
