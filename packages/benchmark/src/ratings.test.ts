import { describe, expect, it } from "vitest";
import {
  aggregateBenchmarkScores, GLICKO_2_VERSION, INITIAL_RATING, isLeaderboardEligible, ratingPeriodUpdate,
  type BenchmarkScore, type RatingPeriodObservation, type RatingScoreTransform, type RatingState
} from "./ratings.js";

const version = GLICKO_2_VERSION;
const transform: RatingScoreTransform = { version: "test-matchpoints-v1", toFractionalScore: ({ matchpoints }) => matchpoints.points / matchpoints.top };
const rating = (value: number, deviation: number, sampleBoards = 0): RatingState => ({ rating: value, deviation, volatility: 0.06, sampleBoards });
const observation = (competitorId: string, opponentId: string, points: number, sampleBoards = 1): RatingPeriodObservation => ({
  competitorId, opponentId, sampleBoards, rawScore: { crossImps: -3.5, matchpoints: { points, top: 4 } }
});

describe("benchmark rating periods", () => {
  it("matches Glickman's published Glicko-2 example with tau 0.5", () => {
    // https://glicko.net/glicko/glicko2.pdf, pp. 4–6
    const ratings = new Map([
      ["subject", rating(1500, 200)], ["first", rating(1400, 30)],
      ["second", rating(1550, 100)], ["third", rating(1700, 300)]
    ]);
    const period = ratingPeriodUpdate(ratings, [
      observation("subject", "first", 4), observation("subject", "second", 0), observation("subject", "third", 0)
    ], version, transform);
    const subject = period.ratings.find(({ competitorId }) => competitorId === "subject")!;
    expect(subject.rating).toBeCloseTo(1464.06, 1);
    expect(subject.deviation).toBeCloseTo(151.52, 2);
    expect(subject.volatility).toBeCloseTo(0.05999, 4);
    expect(subject.sampleBoards).toBe(3);
    expect(ratings.get("subject")).toEqual(rating(1500, 200));
  });

  it("starts unrated competitors at the project baseline and compares pre-period ratings simultaneously", () => {
    expect(INITIAL_RATING).toEqual({ rating: 1500, deviation: 350, volatility: 0.06 });
    const period = ratingPeriodUpdate(new Map(), [observation("a", "b", 3, 20), observation("b", "a", 1, 8)], version, transform);
    const [first, second] = period.ratings;
    expect(first!.rating).toBeCloseTo(1581.16, 2);
    expect(second!.rating).toBeCloseTo(1418.84, 2);
    expect(first!.deviation).toBeCloseTo(second!.deviation, 8);
    expect(first!.sampleBoards).toBe(20);
    expect(second!.sampleBoards).toBe(8);
    expect(first!.eligible).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(period.ratings)).toBe(true);
  });

  it("increases RD during an idle period and can return a profile to provisional", () => {
    const state = rating(1600, 99.5, 22);
    const period = ratingPeriodUpdate(new Map([["idle", state]]), [], version, transform);
    expect(period.ratings).toEqual([{
      competitorId: "idle", rating: 1600, deviation: expect.closeTo(100.04444, 4), volatility: 0.06, sampleBoards: 22, eligible: false
    }]);
    expect(period.observations).toEqual([]);
  });

  it.each([
    { sampleBoards: 19, deviation: 99.99, eligible: false },
    { sampleBoards: 20, deviation: 100, eligible: false },
    { sampleBoards: 20, deviation: 99.99, eligible: true }
  ])("eligibility is $eligible at $sampleBoards boards and RD $deviation", ({ sampleBoards, deviation, eligible }) => {
    expect(isLeaderboardEligible({ sampleBoards, deviation })).toBe(eligible);
  });

  it("keeps raw session metrics with the fractional observation and both version identifiers", () => {
    const result = observation("a", "b", 3, 20);
    const period = ratingPeriodUpdate(new Map(), [result], version, transform);
    expect(period.algorithmVersion).toBe(version);
    expect(period.scoreTransformVersion).toBe("test-matchpoints-v1");
    expect(period.observations).toEqual([{ ...result, fractionalScore: 0.75 }]);
    expect(period.observations[0]!.rawScore).not.toBe(result.rawScore);
    expect(Object.isFrozen(period.observations[0]!.rawScore.matchpoints)).toBe(true);
  });

  it("supplies the observation's board count to a transform that normalizes by board", () => {
    const period = ratingPeriodUpdate(new Map(), [observation("a", "b", 3, 7)], version, {
      version: "test-imps-per-board-v1",
      toFractionalScore: ({ crossImps }, sampleBoards) => 1 + crossImps / sampleBoards
    });
    expect(period.observations[0]!.fractionalScore).toBe(0.5);
  });

  it("requires an explicit transform with a nonblank version and a supported algorithm version", () => {
    expect(() => ratingPeriodUpdate(new Map(), [], version, undefined as unknown as RatingScoreTransform)).toThrow(/transform/i);
    expect(() => ratingPeriodUpdate(new Map(), [], version, { ...transform, version: " " })).toThrow(/transform/i);
    expect(() => ratingPeriodUpdate(new Map(), [], "unknown" as typeof version, transform)).toThrow(/algorithm/i);
  });

  it.each([-0.01, 1.01, NaN, Infinity])("rejects invalid fractional scores such as %s", (fractionalScore) => {
    expect(() => ratingPeriodUpdate(new Map(), [observation("a", "b", 3)], version, {
      ...transform, toFractionalScore: () => fractionalScore
    })).toThrow(/fractional score/i);
  });

  it("rejects invalid pre-period ratings and sample counts", () => {
    expect(() => ratingPeriodUpdate(new Map([["a", rating(1500, 0)]]), [], version, transform)).toThrow(/rating/i);
    expect(() => ratingPeriodUpdate(new Map(), [observation("a", "b", 3, 0)], version, transform)).toThrow(/sample boards/i);
    expect(() => ratingPeriodUpdate(new Map(), [observation("a", "a", 3)], version, transform)).toThrow(/opponent/i);
  });
});

describe("benchmark score aggregation", () => {
  it("sums raw IMPs and uses total matchpoint points and top for percentage", () => {
    expect(aggregateBenchmarkScores([
      { crossImps: -3.5, matchpoints: { points: 2, top: 2 } },
      { crossImps: 1.25, matchpoints: { points: 1, top: 6 } }
    ])).toEqual({ sampleBoards: 2, crossImps: -2.25, matchpoints: { points: 3, top: 8, percentage: 37.5 } });
  });

  it("uses a null matchpoint percentage when there is no comparison top", () => {
    expect(aggregateBenchmarkScores([])).toEqual({ sampleBoards: 0, crossImps: 0, matchpoints: { points: 0, top: 0, percentage: null } });
  });

  it.each([
    { crossImps: NaN, matchpoints: { points: 0, top: 2 } },
    { crossImps: 0, matchpoints: { points: 3, top: 2 } }
  ] satisfies BenchmarkScore[])("rejects invalid raw score %j", (score) => {
    expect(() => aggregateBenchmarkScores([score])).toThrow(/raw score/i);
  });
});
