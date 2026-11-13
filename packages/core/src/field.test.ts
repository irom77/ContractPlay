import { describe, expect, it } from "vitest";
import { createDeck, deal } from "./cards.js";
import { compareWithField, fieldMethod, fieldScores, impsFor, replayOriginal, type HandRecord, type TravellerRow } from "./field.js";
import type { GameAction } from "./history.js";

const row = (nsScore?: number, extra: Partial<TravellerRow> = {}): TravellerRow => ({ ...(nsScore === undefined ? {} : { nsScore }), multiplicity: 1, artificial: false, ...extra });
const field = [row(420), row(-50), row(430), row(0), row(420), row(420, { artificial: true }), row(undefined)];

const record = (original?: readonly GameAction[]): HandRecord => ({
  dealer: "north",
  vulnerability: "None",
  deal: deal(createDeck()),
  ...(original ? { original } : {}),
  field: []
});

describe("field scoring", () => {
  it("converts point differences with the Law 78B scale", () => {
    expect([0, 10, 20, 40, 50, 180, 430, 490, 500, 3990, 4000, 7600].map(impsFor)).toEqual([0, 0, 1, 1, 2, 5, 10, 10, 11, 23, 24, 24]);
    expect(impsFor(-180)).toBe(-5);
  });
  it("keeps only real scores, repeated by multiplicity", () => {
    expect(fieldScores([...field, row(100, { multiplicity: 3 })])).toEqual([420, -50, 430, 0, 420, 100, 100, 100]);
  });
  it("weights a multiplicity row like that many separate rows", () => {
    const triple = [...field, row(100, { multiplicity: 3 })];
    const spread = [...field, row(100), row(100), row(100)];
    for (const method of ["matchpoints", "butler", "cross"] as const) {
      for (const side of ["NS", "EW"] as const) expect(compareWithField(triple, 130, side, method)).toEqual(compareWithField(spread, 130, side, method));
    }
  });
  it("handles a huge multiplicity without building arrays", () => {
    expect(compareWithField([row(100, { multiplicity: 1_000_000_000 })], 100, "NS", "matchpoints")!.count).toBe(1_000_000_000);
  });
  it("matchpoints a new score as an extra table", () => {
    expect(compareWithField(field, 420, "NS", "matchpoints")!.matchpoints).toEqual({ points: 6, top: 10, percentage: 60 });
  });
  it("IMPs against the rounded average datum and across the field", () => {
    const result = compareWithField(field, 420, "NS", "butler")!;
    expect(result.butler).toEqual({ datum: 240, imps: 5 }); // average 244 -> 240; 180 -> 5 IMPs
    expect(result.cross).toEqual({ total: 19, perComparison: 3.8 });
  });
  it("scores from East-West's side when the player sat East-West", () => {
    const result = compareWithField(field, -50, "EW", "matchpoints")!; // EW +50: beats four tables, ties one
    expect(result.matchpoints).toEqual({ points: 9, top: 10, percentage: 90 });
    expect(result.butler.datum).toBe(-240);
  });
  it("has no comparison without real scores", () => {
    expect(compareWithField([row(undefined), row(420, { artificial: true })], 420, "NS", "matchpoints")).toBeUndefined();
  });
  it("reads the method from the PBN Scoring tag", () => {
    expect([undefined, "MP", "MatchPoints", "IMP", "IMP;Butler", "IMP;Cross", "Cross1"].map(fieldMethod))
      .toEqual(["matchpoints", "matchpoints", "matchpoints", "butler", "butler", "cross", "cross"]);
  });
});

describe("replayOriginal", () => {
  it("replays the original auction into the play phase", () => {
    const state = replayOriginal(record([
      { type: "bid", seat: "north", bid: "1clubs" },
      { type: "bid", seat: "east", bid: "pass" },
      { type: "bid", seat: "south", bid: "pass" },
      { type: "bid", seat: "west", bid: "pass" }
    ]));
    expect(state?.phase).toBe("play");
  });
  it("refuses an action by the wrong seat", () => {
    expect(replayOriginal(record([{ type: "bid", seat: "east", bid: "1clubs" }]))).toBeUndefined();
  });
  it("has nothing to replay without original actions", () => {
    expect(replayOriginal(record())).toBeUndefined();
    expect(replayOriginal(record([]))).toBeUndefined();
  });
});
