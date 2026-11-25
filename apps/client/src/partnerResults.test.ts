import { TRAIT_PRESETS, type GameState } from "@contractplay/core";
import type { OwnCharacter } from "@contractplay/persistence";
import { describe, expect, it } from "vitest";
import { castMemberName, editedSince, loadPartnerResults, MAX_PARTNER_RESULTS, onlineCast, opponentStats, opponentSummary, partnerResultOf, partnerStats, partnerSummary, recordPartnerResult, type PartnerResult } from "./partnerResults.js";

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

  it("counts only finished hands with at least one named bot", () => {
    expect(partnerResultOf("h1", finished("north", 420), "south", { ...cast, partner: "custom" })).toMatchObject({ partner: "custom", left: "cora" });
    expect(partnerResultOf("h1", finished("north", 420), "south", { partner: "custom", left: "custom", right: "custom" })).toBeUndefined();
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
    expect(partnerStats([result("a", "custom", 100)])).toEqual([]);
  });

  it("sums each named opponent's record, most-met first", () => {
    const against = (handId: string, left: string, right: string, score: number): PartnerResult => ({ ...result(handId, "custom", score), left, right });
    const stats = opponentStats([against("a", "cora", "wes", 420), against("b", "cora", "custom", -100), against("c", "dex", "dex", -50)]);
    expect(stats).toEqual([{ opponent: "cora", hands: 2, average: 160 }, { opponent: "wes", hands: 1, average: 420 }, { opponent: "dex", hands: 1, average: -50 }]);
    expect(opponentSummary(stats[0])).toBe("2 hands against, +160 a hand");
    expect(opponentSummary(stats[2])).toBe("1 hand against, -50 a hand");
    expect(opponentSummary(undefined)).toBe("No hands against yet");
  });
});

describe("online cast", () => {
  it("names the bots around the player's seat, with other bots as custom and people as human", () => {
    const seats = { north: { kind: "human", name: "Ann", away: false }, east: { kind: "bot", skill: "advanced", character: "bea" },
      south: { kind: "bot", skill: "expert" }, west: { kind: "bot", skill: "intermediate", character: "cora" } } as const;
    expect(onlineCast(seats, "north")).toEqual({ left: "bea", partner: "custom", right: "cora" });
    expect(onlineCast(seats, "west")).toEqual({ left: "human", partner: "bea", right: "custom" });
  });

  const gina: OwnCharacter = { id: "own-abc123", name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced",
    traits: { ...TRAIT_PRESETS.normal, doubles: "cautious" }, updatedAt: 5 };

  it("records a hand with an own character and its name", () => {
    const withGina = { partner: gina.id, left: "custom", right: "custom" };
    expect(partnerResultOf("h1", finished("north", 420), "south", withGina, {}, [gina]))
      .toEqual({ handId: "h1", partner: gina.id, left: "custom", right: "custom", score: 420, declared: true, made: true, names: { [gina.id]: "Gentle Gina" } });
    // A character this device no longer holds is a custom bot.
    expect(partnerResultOf("h1", finished("north", 420), "south", withGina, {}, [])).toBeUndefined();
    expect(partnerResultOf("h2", finished("north", 420), "south", { ...cast, right: gina.id }, {}, [gina])?.names).toEqual({ [gina.id]: "Gentle Gina" });
  });

  it("counts own characters as partners and opponents", () => {
    const results = [result("h1", gina.id, 100), { ...result("h2", "bea", -50), left: gina.id, right: gina.id }];
    expect(partnerStats(results).map((stats) => stats.partner)).toEqual([gina.id, "bea"]);
    expect(opponentStats(results)).toEqual([{ opponent: gina.id, hands: 1, average: -50 }]);
  });

  it("names a deleted character from its results", () => {
    const results = [{ ...result("h1", gina.id, 100), names: { [gina.id]: "Gina" } }, { ...result("h2", gina.id, 100), names: { [gina.id]: "Gentle Gina" } }];
    expect(castMemberName(gina.id, [gina], results)).toBe("Gentle Gina");
    expect(castMemberName("tess", [], results)).toBe("Timid Tess");
    expect(castMemberName(gina.id, [{ ...gina, deleted: true }], results)).toBe("Gentle Gina (deleted)");
    expect(castMemberName(gina.id, [], [result("h3", gina.id, 0)])).toBe("Your character (deleted)");
  });

  it("notes play edits since older hands", () => {
    const results = [{ ...result("h1", gina.id, 100), at: 1 }, { ...result("h2", "bea", 0), left: gina.id, at: 10 }];
    expect(editedSince(gina.id, [{ ...gina, playEditedAt: 5 }], results)).toBe(true);
    expect(editedSince(gina.id, [{ ...gina, playEditedAt: 0 }], results)).toBe(false);
    expect(editedSince(gina.id, [gina], results)).toBe(false);
    expect(editedSince(gina.id, [{ ...gina, playEditedAt: 5 }], [result("h3", gina.id, 0)])).toBe(true);
  });
});
