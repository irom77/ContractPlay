import { describe, expect, it } from "vitest";
import { applyAction, claimSeatFor, createDeck, createGameState, deal, validatePlay } from "@contractplay/core";
import { exportPbn, parsePbn, pbnBoardToHand, pbnBoardToRecord, serializePbn, tableResult } from "./pbn.js";
import type { GameAction, GameState, Seat } from "@contractplay/core";

const normalizedDeal = (value: ReturnType<typeof deal>) => Object.fromEntries(
  Object.entries(value).map(([seat, hand]) => [seat, hand.map(({ suit, rank }) => `${suit}:${rank}`).sort()])
);

describe("PBN import and export", () => {
  it.each([
    ["N", "north"], ["E", "east"], ["S", "south"], ["W", "west"]
  ] as const)("maps dealer %s to %s", (encoded, dealer) => {
    expect(parsePbn(`[Dealer "${encoded}"]\n[Vulnerable "None"]`).boards[0]?.dealer).toBe(dealer);
  });

  it.each([
    ["None", "None"], ["NS", "NS"], ["EW", "EW"], ["All", "Both"]
  ] as const)("maps vulnerability %s to %s", (encoded, vulnerability) => {
    expect(parsePbn(`[Dealer "N"]\n[Vulnerable "${encoded}"]`).boards[0]?.vulnerability).toBe(vulnerability);
  });

  it("round-trips a deal, auction, play, unknown tag, and comments", () => {
    const source = exportPbn({
      dealer: "north",
      vulnerability: "EW",
      deal: deal(createDeck()),
      actions: [
        { type: "bid", seat: "north", bid: "1clubs" },
        { type: "bid", seat: "east", bid: "pass" },
        { type: "play", seat: "east", card: { suit: "spades", rank: "2" } }
      ],
      tags: [{ name: "Event", value: "Practice" }, { name: "Annotator", value: "ContractPlay" }],
      comments: ["review this hand"]
    });
    const board = parsePbn(source).boards[0]!;
    expect(normalizedDeal(board.deal!)).toEqual(normalizedDeal(deal(createDeck())));
    expect(board.actions).toEqual([
      { type: "bid", seat: "north", bid: "1clubs" },
      { type: "bid", seat: "east", bid: "pass" },
      { type: "play", seat: "east", card: { suit: "spades", rank: "2" } }
    ]);
    expect(board.tags.map(({ name }) => name)).toContain("Annotator");
    expect(board.comments).toContain("review this hand");
    expect(normalizedDeal(parsePbn(serializePbn({ boards: [board] })).boards[0]!.deal!)).toEqual(normalizedDeal(board.deal!));
  });

  it("round-trips player seats through a complete played hand", () => {
    let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
    for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
      const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    while (game.phase === "play") {
      const seat = game.currentActor;
      const ledSuit = game.currentTrick[0]?.card.suit;
      const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, ledSuit).legal)!;
      const result = applyAction(game, { type: "play", seat, card });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }

    const pbn = exportPbn({ dealer: game.dealer, vulnerability: game.vulnerability, deal: game.initialDeal, actions: game.history.actions });
    expect(pbn).not.toContain("\n\n");
    const playLines = pbn.split('[Play "')[1]!.split("\n").slice(1);
    expect(playLines).toHaveLength(13);
    expect(playLines.every((line) => line.split(/\s+/).length === 4)).toBe(true);
    expect(parsePbn(pbn).boards[0]?.actions).toEqual(game.history.actions);
  });

  it("keeps independent boards when one deal is malformed", () => {
    const source = `[Board "1"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:invalid"]\n\n[Board "2"]\n[Dealer "E"]\n[Vulnerable "All"]`;
    const boards = parsePbn(source).boards;
    expect(boards).toHaveLength(2);
    expect(boards[0]?.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: "Invalid or incomplete Deal tag" }));
    expect(boards[1]).toMatchObject({ dealer: "east", vulnerability: "Both" });
  });

  it("keeps a valid deal when its recorded play is illegal so the board remains playable", () => {
    const source = exportPbn({ dealer: "north", vulnerability: "None", actions: [], deal: deal(createDeck()) });
    const board = parsePbn(`${source}\n[Auction "N"]\n1C P P P\n[Play "E"]\nSA`).boards[0]!;
    expect(board.deal).toBeDefined();
    expect(board.diagnostics).toContainEqual(expect.objectContaining({ severity: "warning", message: expect.stringContaining("Invalid play") }));
    expect(pbnBoardToRecord(board)).toMatchObject({ dealer: "north", deal: board.deal });
    expect(pbnBoardToRecord(board)?.original).toBeUndefined();
  });

  it("reports missing required metadata when converting a board to a hand", () => {
    const board = parsePbn(`[Event "Practice"]`).boards[0]!;
    expect(board.diagnostics).toEqual([
      expect.objectContaining({ severity: "warning", message: "Missing Dealer tag", line: 1 }),
      expect.objectContaining({ severity: "warning", message: "Missing Vulnerable tag", line: 1 })
    ]);
    expect(() => pbnBoardToHand(board)).toThrow("missing a valid Dealer tag");
  });

  it("reports unknown auction calls and keeps parsing the rest of an incomplete record", () => {
    const board = parsePbn(`[Dealer "N"]\n[Vulnerable "None"]\n[Auction "N"]\n1C mystery Pass`).boards[0]!;
    expect(board.actions).toEqual([
      { type: "bid", seat: "north", bid: "1clubs" },
      { type: "bid", seat: "east", bid: "pass" }
    ]);
    expect(board.diagnostics).toContainEqual(expect.objectContaining({
      severity: "warning", message: "Unrecognized auction call: mystery", line: 4
    }));
  });

  describe("claims", () => {
    function claimed(tricks: number) {
      let game = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
      for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
        const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
        if (!result.ok) throw new Error(result.error.message);
        game = result.state;
      }
      for (let played = 0; played < 8; played++) {
        const seat = game.currentActor;
        const ledSuit = game.currentTrick[0]?.card.suit;
        const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, ledSuit).legal)!;
        const result = applyAction(game, { type: "play", seat, card });
        if (!result.ok) throw new Error(result.error.message);
        game = result.state;
      }
      const result = applyAction(game, { type: "claim", seat: claimSeatFor(game)!, tricks });
      if (!result.ok) throw new Error(result.error.message);
      return result.state;
    }

    it("writes a claim as * with a Result tag and parses it back", () => {
      const game = claimed(3);
      const pbn = exportPbn({ dealer: game.dealer, vulnerability: game.vulnerability, deal: game.initialDeal, actions: game.history.actions });
      expect(pbn).toMatch(new RegExp(`\\[Result "${game.score!.tricksTaken}"\\]`));
      expect(pbn.trimEnd().endsWith(" *")).toBe(true);
      const board = parsePbn(pbn).boards[0]!;
      expect(board.diagnostics).toEqual([]);
      expect(board.actions).toEqual(game.history.actions);
    });

    it("round-trips a defender's claim", () => {
      let game = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
      for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
        const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
        if (!result.ok) throw new Error(result.error.message);
        game = result.state;
      }
      const seat = game.currentActor;
      const result = applyAction(game, { type: "claim", seat, tricks: 1 });
      if (!result.ok) throw new Error(result.error.message);
      const pbn = exportPbn({ dealer: "north", vulnerability: "None", deal: game.initialDeal, actions: result.state.history.actions });
      expect(parsePbn(pbn).boards[0]!.actions).toEqual(result.state.history.actions);
    });

    it("keeps the plays and warns when the Result cannot be a claim", () => {
      const game = claimed(3);
      const pbn = exportPbn({ dealer: game.dealer, vulnerability: game.vulnerability, deal: game.initialDeal, actions: game.history.actions })
        .replace(/\[Result "\d+"\]/, '[Result "13"]');
      const board = parsePbn(pbn).boards[0]!;
      expect(board.actions.some((action) => action.type === "claim")).toBe(false);
      expect(board.diagnostics.some((entry) => entry.severity === "warning" && entry.message.includes("Result"))).toBe(true);
    });
  });
});

describe("PBN tables, inheritance, and hand records", () => {
  const fixedDeal = deal(createDeck());
  const header = exportPbn({
    dealer: "north",
    vulnerability: "None",
    actions: [],
    deal: fixedDeal,
    tags: [{ name: "Event", value: "Club Pairs" }, { name: "Board", value: "1" }, { name: "Scoring", value: "MP" }]
  });
  const scoreTable = `[ScoreTable "PairId_NS\\2R;PairId_EW\\2R;Names_NS;Contract\\4L;Declarer\\1R;Result\\2R;Score_NS\\6R;Score_EW\\6R"]
 1  5 "Smith - Jones" 4S   N 10    420      -
 2  6 "Lee - Patel"   4S   N  9      -     50
 3  7 "Ng - Ruiz"     3NT  S 10    430      -
 4  8 "Ito - Berg"    Pass -  -      0      0
 9 10 "Ali - Moss"    4S   N 10   ^420      -
11 12 "Fox - Kerr"    ?    ?  ?      ?      ?`;
  const fixture = `${header}\n\n${scoreTable}\n`;
  const minimal = (table: string) => `[Dealer "N"]\n[Vulnerable "None"]\n${table}`;

  it("reads a ScoreTable into traveller rows without names", () => {
    const [board] = parsePbn(fixture).boards;
    expect(board!.diagnostics).toEqual([]);
    expect(board!.field).toEqual([
      { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: false },
      { nsScore: -50, contract: "4S", declarer: "north", tricks: 9, multiplicity: 1, artificial: false },
      { nsScore: 430, contract: "3NT", declarer: "south", tricks: 10, multiplicity: 1, artificial: false },
      { nsScore: 0, contract: "Pass", multiplicity: 1, artificial: false },
      { nsScore: 420, contract: "4S", declarer: "north", tricks: 10, multiplicity: 1, artificial: true },
      { multiplicity: 1, artificial: false }
    ]);
    expect(JSON.stringify(board!.field)).not.toContain("Smith");
  });

  it("reads columns in any order, and EW-only scores as negated NS scores", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Score_EW;Contract;Declarer"]\n50 4S N')).boards;
    expect(board!.field).toEqual([{ nsScore: -50, contract: "4S", declarer: "north", multiplicity: 1, artificial: false }]);
  });

  it("reads a positive integer Multiplicity and warns about an invalid one", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Score_NS;Multiplicity"]\n420 3\n100 0\n50 1.5')).boards;
    expect(board!.field!.map((row) => row.multiplicity)).toEqual([3, 1, 1]);
    expect(board!.diagnostics.filter((entry) => entry.severity === "warning" && entry.message.includes("Multiplicity"))).toHaveLength(2);
  });

  it("bounds Multiplicity to 1..1000 and warns otherwise", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Score_NS;Multiplicity"]\n420 1000\n100 1001\n50 10000000000')).boards;
    expect(board!.field!.map((row) => row.multiplicity)).toEqual([1000, 1, 1]);
    expect(board!.diagnostics.filter((entry) => entry.severity === "warning" && entry.message.includes("Multiplicity"))).toHaveLength(2);
  });

  it("warns about a row with the wrong number of values and skips it", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Score_NS;Contract"]\n420 4S\n130 3NT extra\n50 2H')).boards;
    expect(board!.field).toHaveLength(2);
    expect(board!.diagnostics).toHaveLength(1);
    expect(board!.diagnostics[0]).toMatchObject({ severity: "warning" });
    expect(board!.diagnostics[0]!.message).toContain("130 3NT extra");
  });

  it("resolves # and ## tag inheritance across boards", () => {
    const { boards } = parsePbn([
      '[Event "##Spring Pairs"]', '[Site "Club"]', '[Board "1"]', '[Dealer "N"]', '[Vulnerable "None"]', "",
      '[Board "2"]', '[Site "#"]', '[Dealer "E"]', '[Vulnerable "NS"]'
    ].join("\n"));
    expect(boards).toHaveLength(2);
    const second = boards[1]!;
    expect(second.diagnostics).toEqual([]);
    expect(second.tags.find((tag) => tag.name === "Event")?.value).toBe("Spring Pairs");
    expect(second.tags.find((tag) => tag.name === "Site")?.value).toBe("Club");
    expect(boards[0]!.tags.find((tag) => tag.name === "Event")?.value).toBe("Spring Pairs");
  });

  it("warns and drops a # with no previous value", () => {
    const [board] = parsePbn('[Site "#"]\n[Dealer "N"]\n[Vulnerable "None"]').boards;
    expect(board!.tags.some((tag) => tag.name === "Site")).toBe(false);
    expect(board!.diagnostics.some((entry) => entry.severity === "warning" && entry.message.includes("Site"))).toBe(true);
  });

  it("refuses inheritance for Deal-defining tags", () => {
    const [board] = parsePbn('[Dealer "#"]\n[Vulnerable "None"]').boards;
    expect(board!.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: "Tag Dealer cannot inherit a value" }));
  });

  it("refuses inheritance for Auction and Play", () => {
    for (const name of ["Auction", "Play"]) {
      const [board] = parsePbn(`[Dealer "N"]\n[Vulnerable "None"]\n[${name} "#"]`).boards;
      expect(board!.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: `Tag ${name} cannot inherit a value` }));
    }
  });

  it("reads a column suffix without a justification letter", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Contract\\4;Score_NS\\6"]\n4S 420')).boards;
    expect(board!.field).toEqual([{ nsScore: 420, contract: "4S", multiplicity: 1, artificial: false }]);
  });

  it("keeps other tables' rows without warnings and writes them back", () => {
    const text = minimal('[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]\nN C  7\nN D  8');
    const [board] = parsePbn(text).boards;
    expect(board!.diagnostics.filter((entry) => !entry.message.startsWith("Missing"))).toEqual([]);
    expect(board!.tables).toEqual({ OptimumResultTable: "N C  7\nN D  8\n" });
    expect(serializePbn(parsePbn(text))).toContain('[OptimumResultTable "Declarer;Denomination\\2R;Result\\2R"]\nN C  7\nN D  8');
  });

  it("keeps ScoreTable diagnostic line numbers through blank lines", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Score_NS;Contract"]\n\n10 4S\n\n30 3NT extra')).boards;
    expect(board!.diagnostics).toContainEqual(expect.objectContaining({ message: expect.stringContaining("skipped: 30 3NT extra"), line: 7 }));
  });

  it("ignores brace comment lines inside ScoreTable instead of treating them as traveller rows", () => {
    const [board] = parsePbn(minimal('[ScoreTable "Score_NS;Contract"]\n420 4S\n{director note}\n- 3NT')).boards;
    expect(board!.field).toEqual([
      { nsScore: 420, contract: "4S", multiplicity: 1, artificial: false },
      { contract: "3NT", multiplicity: 1, artificial: false }
    ]);
    expect(board!.diagnostics.filter((entry) => entry.message.includes("ScoreTable row"))).toEqual([]);
  });

  it("keeps table row indentation, ignores PBN comment lines, and avoids duplicate inheritance errors", () => {
    const text = '[Dealer "#"]\n[Vulnerable "None"]\n[OptimumResultTable "X"]\n  row one\n{comment}\n  row two';
    const [board] = parsePbn(text).boards;
    expect(board!.diagnostics.filter((entry) => entry.severity === "error")).toHaveLength(1);
    expect(board!.tables!.OptimumResultTable).toBe("  row one\n\n  row two\n");
    expect(serializePbn(parsePbn(text))).toContain('[OptimumResultTable "X"]\n  row one\n  row two');
  });

  it("round-trips a ScoreTable", () => {
    const board = parsePbn(fixture).boards[0]!;
    const serialized = serializePbn({ boards: [board] });
    expect(serialized).not.toContain("\n\n");
    expect(serializePbn({ boards: [board, board] }).match(/\n\n/g)).toHaveLength(1);
    const again = parsePbn(serialized);
    expect(again.boards[0]!.field).toEqual(parsePbn(fixture).boards[0]!.field);
  });

  it("maps a board to a hand record", () => {
    expect(pbnBoardToRecord(parsePbn(fixture).boards[0]!)).toMatchObject({ board: "1", event: "Club Pairs", scoring: "MP", dealer: "north", vulnerability: "None", field: expect.any(Array) });
  });

  it("maps PBN OptimumScore to a North-South double-dummy par score", () => {
    const standard = pbnBoardToRecord(parsePbn(`${header}\n[OptimumScore "EW -420"]`).boards[0]!);
    const compact = pbnBoardToRecord(parsePbn(`${header}\n[OptimumScore "NS 1N,NS 2D; 90"]`).boards[0]!);
    const invalid = pbnBoardToRecord(parsePbn(`${header}\n[OptimumScore "unknown"]`).boards[0]!);
    expect(standard?.doubleDummyPar).toBe(420);
    expect(compact?.doubleDummyPar).toBe(90);
    expect(invalid?.doubleDummyPar).toBeUndefined();
  });

  it("returns no record for a board without a deal or with an error", () => {
    expect(pbnBoardToRecord(parsePbn('[Dealer "N"]\n[Vulnerable "None"]').boards[0]!)).toBeUndefined();
    const broken = parsePbn(header.replace('[Vulnerable "None"]', '[Vulnerable "Sideways"]')).boards[0]!;
    expect(broken.deal).toBeDefined();
    expect(broken.dealer).toBe("north");
    expect(broken.diagnostics.some((entry) => entry.severity === "error")).toBe(true);
    expect(pbnBoardToRecord(broken)).toBeUndefined();
  });

});

/** A complete hand played with legal first cards, where some trick is led from a seat other than the opening leader. */
function playedHand(): GameState {
  for (;;) {
    let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
    for (const bid of ["1spades", "pass", "pass", "pass"] as const) {
      const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    while (game.phase === "play") {
      const seat = game.currentActor;
      const ledSuit = game.currentTrick[0]?.card.suit;
      const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, ledSuit).legal)!;
      const result = applyAction(game, { type: "play", seat, card });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    const leader = game.completedTricks[0]![0]!.seat;
    if (game.completedTricks.some((trick) => trick[0]!.seat !== leader)) return game;
  }
}

const letter: Record<Seat, string> = { north: "N", east: "E", south: "S", west: "W" };
const token = (action: GameAction) => action.type === "play" ? `${action.card.suit[0]!.toUpperCase()}${action.card.rank}` : "";

/** The hand written as PBN 2.1 lays a Play section out: one trick a line, each card in its seat's column. */
function columnPbn(game: GameState, tricks = 13, extra: (line: string, index: number) => string = (line) => line): string {
  const leader = game.completedTricks[0]![0]!.seat;
  const order: Seat[] = ["north", "east", "south", "west"];
  const columns = [0, 1, 2, 3].map((offset) => order[(order.indexOf(leader) + offset) % 4]!);
  const lines = game.completedTricks.slice(0, tricks).map((trick, index) =>
    extra(columns.map((seat) => token({ type: "play", seat, card: trick.find((entry) => entry.seat === seat)!.card })).join(" "), index));
  const exported = exportPbn({ dealer: game.dealer, vulnerability: game.vulnerability, deal: game.initialDeal, actions: game.history.actions.filter((action) => action.type === "bid") });
  return `${exported}\n[Play "${letter[leader]}"]\n${lines.join("\n")}${tricks < 13 ? "\n*" : ""}`;
}

describe("PBN 2.1 files from other programs", () => {
  it("reads a Play section in seat columns, each trick from its own leader", () => {
    const game = playedHand();
    const board = parsePbn(columnPbn(game)).boards[0]!;
    expect(board.diagnostics).toEqual([]);
    expect(board.actions).toEqual(game.history.actions);
  });

  it("still reads a Play section written in play order, as earlier exports were", () => {
    const game = playedHand();
    const board = parsePbn(exportPbn({ dealer: game.dealer, vulnerability: game.vulnerability, deal: game.initialDeal, actions: game.history.actions })).boards[0]!;
    expect(board.diagnostics).toEqual([]);
    expect(board.actions).toEqual(game.history.actions);
  });

  it("skips note references and stops at a dash or star in a column Play section", () => {
    const game = playedHand();
    const text = columnPbn(game, 3, (line, index) => index === 0 ? `${line} =1=` : line);
    const board = parsePbn(text.replace(/\n\*$/, "\n- - - -\n*")).boards[0]!;
    expect(board.diagnostics).toEqual([]);
    expect(board.actions.filter((action) => action.type === "play")).toHaveLength(12);
  });

  it("ignores % escape lines, auction notes, and a dash for no one vulnerable", () => {
    const text = `% PBN 2.1\n% Content-type: text/x-pbn; charset=UTF-8\n${exportPbn({ dealer: "north", vulnerability: "None", actions: [], deal: deal() })
      .replace('[Vulnerable "None"]', '[Vulnerable "-"]')}\n% RBDATA 14,0,1\n[Auction "N"]\n1C =1= Pass $3 Pass Pass`;
    const board = parsePbn(text).boards[0]!;
    expect(board.diagnostics).toEqual([]);
    expect(board.vulnerability).toBe("None");
    expect(board.actions.map((action) => action.type === "bid" ? action.bid : "")).toEqual(["1clubs", "pass", "pass", "pass"]);
  });

  it("reads a table's own result from its Contract, Declarer, Result, and Score tags", () => {
    const tags = (contract: string, declarer: string, result: string, score?: string) => parsePbn(
      `${exportPbn({ dealer: "north", vulnerability: "NS", actions: [], deal: deal() })}\n[Contract "${contract}"]\n[Declarer "${declarer}"]\n[Result "${result}"]${score ? `\n[Score "${score}"]` : ""}`
    ).boards[0]!;
    expect(tableResult(tags("3NT", "N", "10", "NS 430"))).toEqual({ nsScore: 430, contract: "3NT", declarer: "north", tricks: 10, multiplicity: 1, artificial: false });
    expect(tableResult(tags("5S", "S", "10", "NS -100"))!.nsScore).toBe(-100);
    expect(tableResult(tags("4HX", "E", "8", "EW -300"))!.nsScore).toBe(300);
    // Without a Score tag the score comes from the contract: 4♠ by North, vulnerable, made with an overtrick.
    expect(tableResult(tags("4S", "N", "11"))!.nsScore).toBe(650);
    expect(tableResult(tags("Pass", "", "")) ).toEqual({ nsScore: 0, contract: "Pass", multiplicity: 1, artificial: false });
    expect(tableResult(tags("", "", ""))).toBeUndefined();
  });
});

