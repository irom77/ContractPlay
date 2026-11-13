import { deal } from "@contractplay/core";
import { exportPbn } from "@contractplay/pbn";
import { describe, expect, it } from "vitest";
import { boardLabel, boardSetFromPbn, isBoardSetFile } from "./boardSet.js";

const table = `[ScoreTable "PairId_NS\\2R;PairId_EW\\2R;Names_NS;Contract\\4L;Declarer\\1R;Result\\2R;Score_NS\\6R;Score_EW\\6R"]
 1  5 "Smith - Jones" 4S   N 10    420      -
 2  6 "Lee - Patel"   4S   N  9      -     50
`;
const board = (extra = "", dealer: "north" | "east" = "north") =>
  exportPbn({ dealer, vulnerability: "None", actions: [], deal: deal(), tags: [{ name: "Event", value: "Club Night" }] }) + (extra ? `\n${extra}` : "");

describe("boardSetFromPbn", () => {
  it("reads every board of a file", () => {
    const { set, skipped } = boardSetFromPbn(`${board()}\n\n${board()}`);
    expect(skipped).toBe(0);
    expect(set?.records).toHaveLength(2);
    expect(set?.position).toBe(0);
    expect(set?.name).toBe("Club Night");
  });

  it("skips boards without a deal", () => {
    const noDeal = board().split("\n").filter((line) => !line.startsWith("[Deal ")).join("\n");
    const { set, skipped } = boardSetFromPbn(`${board()}\n\n${noDeal}\n\n${board()}`);
    expect(set?.records).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it("falls back to a default name and reports nothing readable", () => {
    expect(boardSetFromPbn("junk").set).toBeUndefined();
    expect(boardSetFromPbn(exportPbn({ dealer: "north", vulnerability: "None", actions: [], deal: deal() })).set?.name).toBe("Imported boards");
  });
});

describe("isBoardSetFile", () => {
  it("is true for several boards or a traveller", () => {
    expect(isBoardSetFile(boardSetFromPbn(board()).set!)).toBe(false);
    expect(isBoardSetFile(boardSetFromPbn(board(table)).set!)).toBe(true);
    expect(isBoardSetFile(boardSetFromPbn(`${board()}\n\n${board()}`).set!)).toBe(true);
  });
});

describe("boardLabel", () => {
  it("names the board and its place in the set", () => {
    const record = boardSetFromPbn(board()).set!.records[0]!;
    expect(boardLabel({ name: "x", position: 0, records: [{ ...record, board: "7" }, record, record] })).toBe("Board 7 · 1 of 3");
    expect(boardLabel({ name: "x", position: 1, records: [record, { ...record, board: undefined as never }] }).startsWith("Board 2 · 2 of 2")).toBe(true);
  });
});
