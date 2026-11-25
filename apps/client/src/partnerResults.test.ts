import type { GameState } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { loadPartnerResults, MAX_PARTNER_RESULTS, partnerResultOf, partnerStats, partnerSummary, recordPartnerResult, type PartnerResult } from "./partnerResults.js";

const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
};
const result = (handId: string, partner: string, score: number, declared = false, made = false): PartnerResult =>
  ({ handId, partner, left: "custom", right: "custom", score, declared, made });

/** A finished hand with this NS score, declared by `declarer`. */
function finished(declarer: "north" | "east", nsScore: number, undertricks = 0): GameState {
  return { phase: "complete", contract: { level: 4, strain: "spades", doubled: 0, declarer } as GameState["contract"],
    score: { score: nsScore, tricksRequired: 10, tricksTaken: 10 - undertricks, overtricks: 0, undertricks, vulnerable: false } } as GameState;
}
const cast = { partner: "bea", left: "cora", right: "custom" };

describe("partner results", () => {
  it("scores a finished hand from the player's side", () => {
    expect(partnerResultOf("h1", finished("north", 420), "south", cast)).toEqual({ handId: "h1", partner: "bea", left: "cora", right: "custom", score: 420, declared: true, made: true });
    expect(partnerResultOf("h2", finished("north", 420), "west", cast)).toMatchObject({ score: -420, declared: false, made: false });
    expect(partnerResultOf("h3", finished("east", 100, 2), "west", cast)).toMatchObject({ score: -100, declared: true, made: false });
  });

  it("counts only finished hands with a named partner", () => {
    expect(partnerResultOf("h1", finished("north", 420), "south", { ...cast, partner: "custom" })).toBeUndefined();
    expect(partnerResultOf("h1", { phase: "play" } as GameState, "south", cast)).toBeUndefined();
  });

  it("replaces a hand finished again and keeps the newest entries", () => {
    const storage = memory();
    recordPartnerResult(storage, result("h1", "bea", 420));
    recordPartnerResult(storage, result("h1", "bea", -50));
    expect(loadPartnerResults(storage)).toEqual([result("h1", "bea", -50)]);
    storage.setItem("contractplay.partnerResults", JSON.stringify(Array.from({ length: MAX_PARTNER_RESULTS }, (_, i) => result(`x${i}`, "kim", 0))));
    const kept = recordPartnerResult(storage, result("new", "bea", 10));
    expect(kept).toHaveLength(MAX_PARTNER_RESULTS);
    expect(kept[0]!.handId).toBe("x1");
    expect(kept.at(-1)!.handId).toBe("new");
  });

  it("ignores unreadable or malformed stored results", () => {
    const storage = memory();
    storage.setItem("contractplay.partnerResults", "{nope");
    expect(loadPartnerResults(storage)).toEqual([]);
    storage.setItem("contractplay.partnerResults", JSON.stringify([result("ok", "bea", 1), { handId: "bad" }, null]));
    expect(loadPartnerResults(storage)).toEqual([result("ok", "bea", 1)]);
  });

  it("sums each partner's record, most-played first", () => {
    const stats = partnerStats([result("a", "bea", 420, true, true), result("b", "bea", -50, true, false), result("c", "bea", 100), result("d", "kim", 620, true, true)]);
    expect(stats).toEqual([{ partner: "bea", hands: 3, average: 157, declared: 2, made: 1 }, { partner: "kim", hands: 1, average: 620, declared: 1, made: 1 }]);
    expect(partnerSummary(stats[0])).toBe("3 hands together, +157 a hand");
    expect(partnerSummary({ partner: "ray", hands: 1, average: -50, declared: 0, made: 0 })).toBe("1 hand together, -50 a hand");
    expect(partnerSummary(undefined)).toBe("No hands together yet");
  });
});
