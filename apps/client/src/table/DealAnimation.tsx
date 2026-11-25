import { useEffect, useRef, useState, type CSSProperties } from "react";

/** How long a new hand's shuffle and deal plays before the table shows the hands. Keep in step with styles.css. */
export const DEAL_ANIMATION_MS = 2100;

const SHUFFLE_CARDS = 14;
// Two rounds of the deal, one card to each seat clockwise from the bottom's left, as a dealer pitches them.
const DEAL_TARGETS = ["left", "top", "right", "bottom", "left", "top", "right", "bottom"] as const;

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * True while a newly dealt hand's shuffle plays. `handKey` names the hand on the table (undefined while there is none);
 * the hand already there when the table is first known is not animated, so a reload or reconnect does not reshuffle.
 * `known` is false until the table's state has arrived. Skipped for people who ask for reduced motion.
 */
export function useDealAnimation(handKey: string | undefined, known = true): boolean {
  // null: nothing known yet; otherwise the last hand seen (undefined when none has been).
  const last = useRef<string | undefined | null>(known ? handKey : null);
  const [dealing, setDealing] = useState<string>();
  useEffect(() => {
    if (!known) return;
    if (last.current === null) {
      last.current = handKey;
      return;
    }
    if (handKey === undefined || handKey === last.current) return;
    last.current = handKey;
    if (prefersReducedMotion()) return;
    setDealing(handKey);
    const timer = window.setTimeout(() => setDealing(undefined), DEAL_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [handKey, known]);
  return dealing !== undefined && dealing === handKey;
}

/** A deck riffled twice in the middle of the table, then dealt out to the four seats. Decorative only. */
export function DealAnimation(): React.JSX.Element {
  return (
    <div className="deal-animation" aria-hidden="true">
      <div className="deal-deck">
        {Array.from({ length: SHUFFLE_CARDS }, (_, index) => (
          <span key={`shuffle-${index}`} className={`shuffle-card ${index % 2 ? "riffle-right" : "riffle-left"}`}
            style={{ "--i": index, "--layer": Math.floor(index / 2) } as CSSProperties} />
        ))}
        {DEAL_TARGETS.map((target, index) => (
          <span key={`deal-${index}`} className={`deal-card deal-to-${target}`} style={{ "--k": index } as CSSProperties} />
        ))}
      </div>
    </div>
  );
}
