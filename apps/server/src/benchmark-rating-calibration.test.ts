import { describe, expect, it } from "vitest";
import { botCharacter, impsFor } from "@contractplay/core";
import { benchmarkProfileVersionId, createBenchmarkProfile } from "@contractplay/benchmark";
import sessions from "./fixtures/benchmark-calibration.json";
import { BENCHMARK_SCORE_TRANSFORM, scoreSession } from "./benchmark-scoring.js";

function fraction(crossImps: number, boards: number) {
  return BENCHMARK_SCORE_TRANSFORM.toFractionalScore({ crossImps, matchpoints: { points: 0, top: 0 } }, boards);
}

function margins(sample: string) {
  return sessions.filter(s => s.sample === sample).map(s => {
    const total = s.scores.reduce((sum, scores) => sum + impsFor(scores[0]! - scores[1]!), 0);
    return Math.abs(total / s.scores.length);
  }).sort((a, b) => a - b);
}

describe("cross-IMP calibration on seeded mirrored bot sessions", () => {
  it("covers all twelve competitors, every seat and each partner within a quartet for both bidding styles", () => {
    for (const sample of ["fit", "check"]) {
      for (const style of ["SAYC", "2/1"]) {
        const rounds = sessions.filter(s => s.style === style && s.sample === sample);
        expect(rounds).toHaveLength(36);
        const players = new Set(rounds.flatMap(s => s.seats));
        expect(players.size).toBe(12);
        for (const p of players) {
          const partners = new Map<string, number>();
          const seats = [0, 0, 0, 0];
          for (const s of rounds.filter(s => s.seats.includes(p))) {
            expect(s.scores).toHaveLength(8);
            const seat = s.seats.indexOf(p);
            const partner = s.seats[(seat + 2) % 4]!;
            partners.set(partner, (partners.get(partner) ?? 0) + 1);
            seats[seat] = seats[seat]! + 1;
          }
          expect(seats).toEqual([3, 3, 3, 3]);
          expect([...partners.values()]).toEqual([4, 4, 4]);
        }
      }
    }
  });

  it("derives the released scale from the fitting sample and checks its spread on held-out deals", () => {
    const fit = margins("fit"), check = margins("check");
    const upperQuartile = (sorted: number[]) => sorted[Math.ceil(sorted.length * 0.75) - 1]!;
    expect([fit.length, check.length]).toEqual([72, 72]);
    expect([upperQuartile(fit), upperQuartile(check)]).toEqual([5, 5.25]);
    const scale = Math.round(upperQuartile(fit) / Math.log10(3) * 2) / 2;
    expect(scale).toBe(10.5);
    expect(BENCHMARK_SCORE_TRANSFORM.version).toBe("cross-imp-per-board-10.5-v1");
    expect(fraction(5 * 8, 8)).toBeCloseTo(1 / (1 + 10 ** (-5 / scale)), 12);
    expect(fraction(5.25 * 8, 8)).toBeCloseTo(0.760, 3);
  });

  it("attributes the simulated margins to both members of a mirrored partnership once per distinct board", () => {
    for (const session of sessions) {
      const style = session.style === "SAYC" ? "SAYC" : "2/1";
      const [n, e, s, w] = session.seats.map(id => {
        const { aggression, skill } = botCharacter(id)!;
        return createBenchmarkProfile({ aggression, skill, biddingStyle: style, version: "v1", engineVersion: "contractplay-bots-v1" });
      });
      const assignments = [{ north: n!, east: e!, south: s!, west: w! }, { north: e!, east: s!, south: w!, west: n! }];
      const results = session.scores.flatMap((scores, boardIndex) => scores.map((nsScore, tableIndex) => ({ boardIndex, tableIndex, nsScore })));
      const expected = session.scores.reduce((total, pair) => total + impsFor(pair[0]! - pair[1]!), 0);
      const scoring = scoreSession("imps", assignments, results, session.scores.length);
      for (const profile of scoring.profiles) {
        const isNS = [n!, s!].some(p => benchmarkProfileVersionId(p) === profile.competitorId);
        expect(profile.sampleBoards).toBe(8);
        expect(profile.crossImps).toBe(isNS ? expected : -expected);
      }
    }
  });

  it("gives tied tables half a point and complementary scores when the two partnerships switch directions", () => {
    expect(fraction(0, 8)).toBe(0.5);
    for (const session of sessions) {
      const net = session.scores.reduce((sum, pair) => sum + impsFor(pair[0]! - pair[1]!), 0);
      const boards = session.scores.length;
      expect(fraction(net, boards) + fraction(-net, boards)).toBeCloseTo(1, 12);
      expect(fraction(net * 2, boards * 2)).toBe(fraction(net, boards));
    }
  });
});
