// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Card, Rank, Suit } from "@contractplay/core";
import { cardFace, handSuitOrder, isRedSuit, sortHand, suitGapShare } from "./labels.js";

afterEach(cleanup);

/** Cards from "spades.hearts.diamonds.clubs" rank strings, e.g. "AK.Q..32". */
const hand = (text: string): Card[] => {
  const suits: Suit[] = ["spades", "hearts", "diamonds", "clubs"];
  return text.split(".").flatMap((ranks, index) => [...ranks].map((rank) => ({ suit: suits[index]!, rank: rank as Rank })));
};

describe("hand suit order", () => {
  it("alternates colours, spades first, when all four suits are held", () => {
    expect(handSuitOrder(hand("AK.QJ.T9.87"))).toEqual(["spades", "hearts", "clubs", "diamonds"]);
  });

  it.each([
    ["clubs void", "AK.QJ.T9.", ["hearts", "spades", "diamonds"]],
    ["diamonds void", "AK.QJ..87", ["spades", "hearts", "clubs"]],
    ["hearts void", "AK..T9.87", ["spades", "diamonds", "clubs"]],
    ["spades void", ".QJ.T9.87", ["hearts", "clubs", "diamonds"]],
    ["only black suits", "AK...87", ["spades", "clubs"]],
    ["only red suits", ".QJ.T9.", ["hearts", "diamonds"]]
  ] as const)("keeps same-coloured suits apart whenever it can (%s)", (_, text, order) => {
    expect(handSuitOrder(hand(text))).toEqual(order);
  });

  it("never puts two suits of one colour side by side when the other colour can sit between them", () => {
    for (const text of ["AK.QJ.T9.87", "AK.QJ.T9.", "AK.QJ..87", "AK..T9.87", ".QJ.T9.87"]) {
      const order = handSuitOrder(hand(text));
      expect(order.slice(1).every((suit, index) => isRedSuit(suit) !== isRedSuit(order[index]!))).toBe(true);
    }
  });

  it("sorts cards by that order and high to low within a suit", () => {
    expect(sortHand(hand("2A.K.3Q.T")).map(({ suit, rank }) => `${rank}${suit[0]}`)).toEqual(["As", "2s", "Kh", "Tc", "Qd", "3d"]);
  });
});

describe("suit gap share", () => {
  it("spreads the boundary gaps over the in-suit steps so the hand keeps its width", () => {
    // 13 cards in four suits: 3 boundaries paid for by 9 in-suit steps.
    expect(suitGapShare(sortHand(hand("AKQ.JT9.876.5432")))).toBeCloseTo(3 / 9);
  });

  it("is zero when no step lies inside a suit", () => {
    expect(suitGapShare(sortHand(hand("A.K.Q.J")))).toBe(0);
    expect(suitGapShare([])).toBe(0);
  });
});

describe("card faces", () => {
  it("draws every suit as a shape of its own rather than a font symbol", () => {
    const shapes = (["spades", "hearts", "diamonds", "clubs"] as const).map((suit) => {
      const { container } = render(<span>{cardFace({ suit, rank: "A" })}</span>);
      const glyph = container.querySelector(`.card-center-suit svg.suit-glyph-${suit}`);
      expect(glyph).toBeTruthy();
      expect(container.textContent).not.toMatch(/[♠♥♦♣]/);
      return glyph!.innerHTML;
    });
    expect(new Set(shapes).size).toBe(4);
  });
});
