import type { CSSProperties } from "react";

/**
 * How a held hand is spread on the table. "fan" arcs the cards around a point behind the seat, as a hand is held at a
 * real table; "line" lays them flat in a row (top and bottom) or column (sides). The table carries the choice as a
 * `hand-layout-*` class, so every line rule in styles.css stays as it is and the fan rules are scoped beside it.
 */
export type HandLayout = "fan" | "line";

export const handLayouts: readonly HandLayout[] = ["fan", "line"];
export const defaultHandLayout: HandLayout = "fan";

/** Half a full 13-card hand: the outermost card of a full hand sits at ±1, so every hand bends with the same curve. */
const fullHandHalf = 6;

/**
 * A card's place in the fan, from -1 (first card of a full hand) through 0 (the middle) to 1 (last card), as the
 * `--fan-p` custom property. Styles turn it into the card's tilt and its drop along the arc; a short hand keeps the
 * same curve and simply spans less of it.
 */
export function fanPosition(index: number, count: number): number {
  if (count <= 1) return 0;
  return (index - (count - 1) / 2) / fullHandHalf;
}

/** The inline style that places one card in a fanned hand, or nothing when the hand is laid out in a line. */
export function fanCardStyle(layout: HandLayout, index: number, count: number): CSSProperties | undefined {
  if (layout !== "fan") return undefined;
  return { "--fan-p": fanPosition(index, count).toFixed(4) } as CSSProperties;
}

/** Shared by solo and online play, and remembered in this browser: "line" lays hands flat, anything else fans them. */
export const handLayoutStorageKey = "contractplay.handLayout";

export function loadHandLayout(storage: Pick<Storage, "getItem"> | undefined): HandLayout {
  try { return storage?.getItem(handLayoutStorageKey) === "line" ? "line" : defaultHandLayout; } catch { return defaultHandLayout; }
}

export function saveHandLayout(storage: Pick<Storage, "setItem"> | undefined, layout: HandLayout): void {
  try { storage?.setItem(handLayoutStorageKey, layout); } catch { /* the choice just won't be remembered */ }
}

/** The browser's storage when it can be reached (pages without a storage of their own, such as a replay). */
export function browserStorage(): Storage | undefined {
  try { return window.localStorage; } catch { return undefined; }
}

/** The game-menu entry that switches layouts, named for what it does next. */
export function handLayoutMenuLabel(layout: HandLayout): string {
  return layout === "fan" ? "Lay cards in a line" : "Hold cards in a fan";
}
