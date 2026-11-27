import type { GameMenuItem } from "./GameMenu.js";

/**
 * Whether a tap in the bidding box first selects a call and shows what it means, and a second tap makes it. On unless
 * the player turned it off; shared by solo and online play, and remembered in this browser.
 */
export const confirmCallsStorageKey = "contractplay.confirmCalls";

export function loadConfirmCalls(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try { return storage?.getItem(confirmCallsStorageKey) !== "off"; } catch { return true; }
}

export function saveConfirmCalls(storage: Pick<Storage, "setItem"> | undefined, on: boolean): void {
  try { storage?.setItem(confirmCallsStorageKey, on ? "on" : "off"); } catch { /* the choice just won't be remembered */ }
}

/** The game-menu entry that switches it, named for what it does next. */
export function confirmCallsMenuItem(on: boolean, onToggle: () => void): GameMenuItem {
  return on
    ? { id: "confirm-calls", label: "Bid with one tap", title: "Make a call with a single tap, remembered in this browser", onSelect: onToggle }
    : { id: "confirm-calls", label: "Confirm each call", title: "Tap a call to see what it means, then tap again to make it", onSelect: onToggle };
}
