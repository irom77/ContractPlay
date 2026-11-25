import { describe, expect, it } from "vitest";
import { applyAction, createDeck, createGameState, deal, legalCards, type GameAction, type GameState } from "@contractplay/core";
import { bottomSeatFor } from "./bottomSeat.js";

function apply(game: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce((state, action) => {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  }, game);
}

/** 1NT by North, all pass: North declares, South is dummy, East leads. */
const oneNoTrump = () => apply(
  createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" }),
  { type: "bid", seat: "north", bid: "1notrump" }, { type: "bid", seat: "east", bid: "pass" },
  { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" }
);

const lead = (game: GameState) => apply(game, { type: "play", seat: "east", card: legalCards(game.hands.east, undefined)[0]! });

describe("bottomSeatFor", () => {
  it("keeps the viewer at the bottom during the auction and before the opening lead", () => {
    const auction = createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
    expect(bottomSeatFor(auction, "south", true)).toBe("south");
    expect(bottomSeatFor(oneNoTrump(), "south", true)).toBe("south");
  });

  it("turns the table so the declarer a dummy plays for sits at the bottom once dummy is down", () => {
    expect(bottomSeatFor(lead(oneNoTrump()), "south", true)).toBe("north");
  });

  it("keeps the viewer at the bottom when they do not play declarer's cards", () => {
    const played = lead(oneNoTrump());
    expect(bottomSeatFor(played, "south", false)).toBe("south");
    expect(bottomSeatFor(played, "north", true)).toBe("north");
    expect(bottomSeatFor(played, "east", true)).toBe("east");
  });
});
