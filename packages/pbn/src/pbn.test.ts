import { describe, expect, it } from "vitest";
import { applyAction, claimSeatFor, createDeck, createGameState, deal, validatePlay } from "@contractplay/core";
import { exportPbn, parsePbn, pbnBoardToHand, serializePbn } from "./pbn.js";

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
    expect(parsePbn(pbn).boards[0]?.actions).toEqual(game.history.actions);
  });

  it("keeps independent boards when one deal is malformed", () => {
    const source = `[Board "1"]\n[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:invalid"]\n\n[Board "2"]\n[Dealer "E"]\n[Vulnerable "All"]`;
    const boards = parsePbn(source).boards;
    expect(boards).toHaveLength(2);
    expect(boards[0]?.diagnostics).toContainEqual(expect.objectContaining({ severity: "error", message: "Invalid or incomplete Deal tag" }));
    expect(boards[1]).toMatchObject({ dealer: "east", vulnerability: "Both" });
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
