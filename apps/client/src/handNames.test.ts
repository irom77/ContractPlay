import type { Card, Hand } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createHandName, handName } from "./handNames.js";

const suitOf = { S: "spades", H: "hearts", D: "diamonds", C: "clubs" } as const;
/** Cards from short text such as "S9 SK HQ" (in any order). */
const hand = (text: string): Hand => text.split(" ").map((card) => ({ suit: suitOf[card[0] as keyof typeof suitOf], rank: card.slice(1) }) as Card);

describe("hand names", () => {
  it("writes each suit's letter then its ranks from the ace down, suits in S H C D order joined by underscores", () => {
    expect(handName(hand("D3 S9 HK C2 SK HJ D5 ST HQ H3 CA D4 H2"))).toBe("SKT9_HKQJ32_CA2_D543");
  });

  it("writes a void as its suit letter alone", () => {
    expect(handName(hand("SA SK SQ SJ ST S9 S8 S7 S6 S5 C4 C3 D2"))).toBe("SAKQJT98765_H_C43_D2");
  });

  it("adds a number when the history already has a hand of that name", () => {
    const cards = hand("D3 S9 HK C2 SK HJ D5 ST HQ H3 CA D4 H2");
    expect(createHandName(cards)).toBe("SKT9_HKQJ32_CA2_D543");
    expect(createHandName(cards, new Set(["SKT9_HKQJ32_CA2_D543"]))).toBe("SKT9_HKQJ32_CA2_D543_2");
    expect(createHandName(cards, new Set(["SKT9_HKQJ32_CA2_D543", "SKT9_HKQJ32_CA2_D543_2"]))).toBe("SKT9_HKQJ32_CA2_D543_3");
  });
});
