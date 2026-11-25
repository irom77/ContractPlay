import { BOT_CHARACTERS, SEATS } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { createBenchmarkProfile } from "./profiles.js";
import { createRotation, rotationCycleLength } from "./rotation.js";

const profiles = BOT_CHARACTERS.map(({ skill, aggression }) => createBenchmarkProfile({
  skill, aggression, biddingStyle: "SAYC", version: "1", engineVersion: "test-engine"
}));

describe("benchmark rotation", () => {
  it("reconstructs the same bounded round from the seed and profile versions", () => {
    const round = createRotation(profiles, 42, 17, 3);
    expect(round).toHaveLength(3);
    expect(round).toEqual(createRotation([...profiles].reverse(), 42, 17, 3));
    expect(round).not.toEqual(createRotation(profiles, 43, 17, 3));
    expect(round).toEqual(createRotation(profiles, 42, 17 + rotationCycleLength(12, 3), 3));
    for (const seats of round) {
      expect(Object.keys(seats)).toEqual(SEATS);
      expect(new Set(Object.values(seats)).size).toBe(4);
    }
    expect(new Set(round.flatMap((seats) => Object.values(seats))).size).toBe(12);
  });

  it.each([
    { profileCount: 4, maxTables: 2, rounds: 12, tables: 1, seatCount: 3, partnerCount: 4 },
    { profileCount: 9, maxTables: 2, rounds: 36, tables: 2, seatCount: 8, partnerCount: 4 },
    { profileCount: 10, maxTables: 2, rounds: 180, tables: 2, seatCount: 36, partnerCount: 16 },
    { profileCount: 12, maxTables: 2, rounds: 132, tables: 2, seatCount: 22, partnerCount: 8 },
    { profileCount: 12, maxTables: 3, rounds: 44, tables: 3, seatCount: 11, partnerCount: 4 }
  ])("balances seats and partners for $profileCount profiles with a $maxTables-table cap", (fixture) => {
    const cohort = profiles.slice(0, fixture.profileCount);
    const seats = new Map<string, number>();
    const partners = new Map<string, number>();
    const count = (counts: Map<string, number>, key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
    const partnerKey = (a: string, b: string) => [a, b].sort().join("/");
    expect(rotationCycleLength(cohort.length, fixture.maxTables)).toBe(fixture.rounds);

    for (let index = 0; index < fixture.rounds; index++) {
      const round = createRotation(cohort, 43, index, fixture.maxTables);
      expect(round).toHaveLength(fixture.tables);
      expect(new Set(round.flatMap((table) => Object.values(table))).size).toBe(fixture.tables * 4);
      for (const table of round) {
        for (const seat of SEATS) count(seats, `${table[seat].profileId}/${seat}`);
        count(partners, partnerKey(table.north.profileId, table.south.profileId));
        count(partners, partnerKey(table.east.profileId, table.west.profileId));
      }
    }

    expect(seats.size).toBe(cohort.length * 4);
    expect(new Set(seats.values())).toEqual(new Set([fixture.seatCount]));
    expect(partners.size).toBe(cohort.length * (cohort.length - 1) / 2);
    expect(new Set(partners.values())).toEqual(new Set([fixture.partnerCount]));
  });

  it("rejects duplicate competitors and incomplete tables", () => {
    expect(() => createRotation(profiles.slice(0, 3), 7, 0, 2)).toThrow(/four profiles/i);
    expect(() => createRotation([...profiles, { ...profiles[0]! }], 7, 0, 3)).toThrow(/duplicate/i);
  });

  it.each([1, 9, 2.5])("rejects a table cap of %s", (cap) => {
    expect(() => createRotation(profiles, 7, 0, cap)).toThrow(/table cap/i);
  });

  it("rejects invalid seeds and round indexes", () => {
    expect(() => createRotation(profiles, -1, 0, 3)).toThrow(/seed/i);
    expect(() => createRotation(profiles, 7, -1, 3)).toThrow(/round index/i);
  });
});
