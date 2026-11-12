/** Shared by solo and online play: "off" turns off playing a card automatically when it is the only legal one. */
export const forcedPlayStorageKey = "contractplay.forcedPlay";
/** How long a forced card waits before it is played, so the player sees it go. */
export const FORCED_PLAY_MS = 500;

/** Whether forced cards are played automatically (on unless the player turned it off). */
export function forcedPlayEnabled(storage: Pick<Storage, "getItem">): boolean {
  try { return storage.getItem(forcedPlayStorageKey) !== "off"; } catch { return true; }
}
