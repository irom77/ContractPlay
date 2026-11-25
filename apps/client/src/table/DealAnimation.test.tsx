// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEAL_ANIMATION_MS, DealAnimation, useDealAnimation } from "./DealAnimation.js";

describe("useDealAnimation", () => {
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("plays for a newly dealt hand, not for the hand already on the table", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ hand }: { hand: string | undefined }) => useDealAnimation(hand), { initialProps: { hand: "h1" as string | undefined } });
    expect(result.current).toBe(false);
    rerender({ hand: undefined });
    expect(result.current).toBe(false);
    rerender({ hand: "h2" });
    expect(result.current).toBe(true);
    act(() => { vi.advanceTimersByTime(DEAL_ANIMATION_MS); });
    expect(result.current).toBe(false);
  });

  it("waits until the table is known, so joining or reconnecting mid-hand does not reshuffle", () => {
    const { result, rerender } = renderHook(({ hand, known }: { hand: string | undefined; known: boolean }) => useDealAnimation(hand, known), { initialProps: { hand: undefined as string | undefined, known: false } });
    rerender({ hand: "t:3", known: true });
    expect(result.current).toBe(false);
    rerender({ hand: "t:4", known: true });
    expect(result.current).toBe(true);
  });

  it("deals at once for players who ask for reduced motion", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
    const { result, rerender } = renderHook(({ hand }: { hand: string }) => useDealAnimation(hand), { initialProps: { hand: "h1" } });
    rerender({ hand: "h2" });
    expect(result.current).toBe(false);
  });
});

describe("DealAnimation", () => {
  it("riffles a deck and pitches two cards to each seat, hidden from assistive technology", () => {
    const { container } = render(<DealAnimation />);
    const root = container.querySelector(".deal-animation")!;
    expect(root.getAttribute("aria-hidden")).toBe("true");
    expect(root.querySelectorAll(".shuffle-card.riffle-left")).toHaveLength(7);
    expect(root.querySelectorAll(".shuffle-card.riffle-right")).toHaveLength(7);
    for (const seat of ["bottom", "left", "top", "right"]) expect(root.querySelectorAll(`.deal-to-${seat}`)).toHaveLength(2);
  });
});
