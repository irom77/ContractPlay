import { describe, expect, it } from "vitest";
import { diagnosticOutcome, parseBaseline } from "./benchmark-double-dummy.js";

describe("double-dummy table diagnostics", () => {
  const input = { source: "bridge-dds-1.4.0" as const, parNS: -620,
    tricks: [[0, 0, 0, 0], [8, 10, 8, 9], [4, 4, 5, 4], [3, 4, 6, 4], [2, 6, 8, 7]] };
  it("scores the auction at optimum for the actual declarer, doubling and vulnerability", () => {
    const contract = { declarer: "east", strain: "hearts", doubled: 0, level: 4 } as const;
    expect(diagnosticOutcome(input, contract, 8, "EW")).toEqual({ auctionGap: 0, declarerShortfall: 2, defenseTricksPrevented: 2 });
    expect(diagnosticOutcome(input, contract, 11, "None")).toEqual({ auctionGap: 200, declarerShortfall: -1, defenseTricksPrevented: -1 });
    expect(diagnosticOutcome(input, { ...contract, doubled: 1 }, 10, "Both")).toEqual({ auctionGap: 170, declarerShortfall: 0, defenseTricksPrevented: 0 });
    expect(diagnosticOutcome(input, null, null, "Both")).toEqual({ auctionGap: 620, declarerShortfall: null, defenseTricksPrevented: null });
  });

  it("accepts only complete numeric results for the supported solver", () => {
    expect(parseBaseline(input)).toEqual(input);
    for (const patch of [{ parNS: 0.1 }, { parNS: 8000 }, { source: "unknown" }, { tricks: [] },
      { tricks: input.tricks.map(() => [3, "4", 6, 4]) }, { tricks: input.tricks.map(() => [14, 4, 6, 4]) }]) {
      expect(parseBaseline({ ...input, ...patch })).toBeNull();
    }
  });
});
