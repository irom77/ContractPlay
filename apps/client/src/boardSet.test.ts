import { deal } from "@contractplay/core";
import { exportPbn } from "@contractplay/pbn";
import { describe, expect, it } from "vitest";
import { boardLabel, boardSetFromPbn, isBoardSetFile } from "./boardSet.js";
import bridgewebsPbn from "./fixtures/bridgewebs-regis.pbn?raw";

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

  it("imports the 32-board BridgeWebs test-system PBN archive", () => {
    // Public sample from https://www.bridgewebs.com/test/regis.pbn
    const { set, skipped } = boardSetFromPbn(bridgewebsPbn);
    expect(skipped).toBe(0);
    expect(set?.records).toHaveLength(32);
    expect(set?.records[0]).toMatchObject({ board: "1", event: "Regis_2016_12_13", dealer: "north", vulnerability: "None", doubleDummyPar: 90 });
  });

  it("skips boards without a deal", () => {
    const noDeal = board().split("\n").filter((line) => !line.startsWith("[Deal ")).join("\n");
    const { set, skipped } = boardSetFromPbn(`${board()}\n\n${noDeal}\n\n${board()}`);
    expect(set?.records).toHaveLength(2);
    expect(skipped).toBe(1);
  });

  it("uses the fullest traveller as the expected count for uneven boards", () => {
    const { set } = boardSetFromPbn(`${board(table)}\n\n${board("", "east")}`);
    expect(set?.records).toHaveLength(2);
    expect(set?.records[0]?.expectedFieldCount).toBe(2);
    expect(set?.records[1]?.expectedFieldCount).toBe(2);
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

  it("joins a board listed once per table into one board whose field is each table's result", () => {
    const shared = deal();
    const game = (tableTags: string) => `[Event "Platinum Pairs"]\n[Board "1"]\n` +
      exportPbn({ dealer: "north", vulnerability: "None", actions: [], deal: shared }).replace(/^\[Board "1"\]\n/m, "") + `\n${tableTags}`;
    const other = exportPbn({ dealer: "east", vulnerability: "NS", actions: [], deal: deal(), tags: [{ name: "Event", value: "Platinum Pairs" }, { name: "Board", value: "2" }] });
    const text = [
      game('[Contract "3NT"]\n[Declarer "N"]\n[Result "10"]\n[Score "NS 430"]\n[Table "1"]'),
      game('[Contract "3NT"]\n[Declarer "N"]\n[Result "11"]\n[Score "NS 460"]\n[Table "2"]'),
      game('[Contract ""]\n[Declarer ""]\n[Result ""]\n[Table "3"]'),
      other
    ].join("\n\n");
    const { set, skipped } = boardSetFromPbn(text);
    expect(skipped).toBe(0);
    expect(set!.records.map((record) => record.board)).toEqual(["1", "2"]);
    expect(set!.records[0]!.field.map((row) => row.nsScore)).toEqual([430, 460]);
    expect(set!.records[1]!.field).toEqual([]);
    expect(isBoardSetFile(set!)).toBe(true);
  });
});
