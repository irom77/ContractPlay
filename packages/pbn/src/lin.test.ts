import { describe, expect, it } from "vitest";
import { parseLin } from "./lin.js";

describe("parseLin", () => {
  it("reads a BBO board number, deal, dealer, vulnerability and auction", () => {
    const source = "qx|o2,BOARD 2|md|4SAJ42H92DT74CKQ96,ST98HQ87543DQ92C3,SKQ7HAKT6DA6CAT82,|sv|o|ah|Board 2|mb|1N|mb|p|mb|p|mb|p|pg||pc|SA|";
    const parsed = parseLin(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.boards).toHaveLength(1);
    expect(parsed.boards[0]).toMatchObject({ dealer: "east", vulnerability: "None" });
    expect(parsed.boards[0]!.tags).toContainEqual(expect.objectContaining({ name: "Board", value: "2" }));
    expect(parsed.boards[0]!.deal).toBeDefined();
    expect(parsed.boards[0]!.actions).toHaveLength(5);
  });

  it("keeps multiple deals and their metadata in file order", () => {
    const hands = "SAJ42H92DT74CKQ96,ST98HQ87543DQ92C3,SKQ7HAKT6DA6CAT82";
    const first = `qx|o1|md|4${hands}|sv|n|`;
    const second = `qx|o2|md|2${hands}|sv|b|`;
    const parsed = parseLin(`${first}${second}`);

    expect(parsed.boards.map((board) => [board.tags.find((tag) => tag.name === "Board")?.value, board.dealer, board.vulnerability])).toEqual([
      ["1", "east", "NS"],
      ["2", "west", "Both"]
    ]);
  });
});
