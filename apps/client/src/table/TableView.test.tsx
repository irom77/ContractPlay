// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { applyAction, createDeck, createGameState, deal, legalCards, type GameAction, type GameState, type Seat } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { TableView, type TableViewProps } from "./TableView.js";
import { cardsHeld } from "./labels.js";

afterEach(cleanup);

/** The game as a viewer would receive it: every hand but the visible ones is an empty array. */
function publicGame(game: GameState, visible: readonly Seat[]): PublicGame {
  const hands = { north: [], east: [], south: [], west: [], ...Object.fromEntries(visible.map((seat) => [seat, game.hands[seat]])) };
  return {
    phase: game.phase, dealer: game.dealer, vulnerability: game.vulnerability, currentActor: game.currentActor, auction: game.auction,
    ...(game.contract ? { contract: game.contract } : {}), hands, currentTrick: game.currentTrick, completedTricks: game.completedTricks,
    ...(game.score ? { score: game.score } : {}), trickLeader: game.trickLeader
  };
}

function apply(game: GameState, ...actions: GameAction[]): GameState {
  return actions.reduce((state, action) => {
    const result = applyAction(state, action);
    if (!result.ok) throw new Error(result.error.message);
    return result.state;
  }, game);
}

const newGame = () => createGameState({ deal: deal(createDeck()), dealer: "north", vulnerability: "None" });
/** 1NT by North, all pass: South is dummy and East is on lead. */
const playing = () => apply(newGame(), { type: "bid", seat: "north", bid: "1notrump" }, { type: "bid", seat: "east", bid: "pass" }, { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" });
const afterOpeningLead = () => {
  const game = playing();
  return apply(game, { type: "play", seat: "east", card: legalCards(game.hands.east)[0]! });
};

function renderTable(game: PublicGame, overrides: Partial<TableViewProps> = {}) {
  return render(<TableView game={game} bottomSeat="north" displayedTrick={game.currentTrick} showCalls={false} onToggleCalls={() => {}} lastTrickOpen={false} onToggleLastTrick={() => {}}
    showBottomHand={false} fixedSeatHands statusText="" ariaLabel="Table" {...overrides} />);
}
const backsAt = (container: HTMLElement, seat: Seat) => container.querySelectorAll(`.seat-${seat} .hidden-hand .card-back`).length;

describe("card backs at hidden seats", () => {
  it("shows 13 backs at each hidden seat during the auction", () => {
    const { container } = renderTable(publicGame(newGame(), ["north"]), { showBottomHand: true });
    for (const seat of ["east", "south", "west"] as const) expect(backsAt(container, seat)).toBe(13);
    expect(backsAt(container, "north")).toBe(0);
    expect(container.querySelector(".seat-east .seat-compass")?.getAttribute("aria-label")).toContain(", 13 cards");
  });

  it("shows one fewer back after a seat plays", () => {
    const game = afterOpeningLead();
    expect(cardsHeld(publicGame(game, []), "east")).toBe(12);
    const { container } = renderTable(publicGame(game, ["north"]));
    expect(backsAt(container, "east")).toBe(12);
    expect(backsAt(container, "west")).toBe(13);
  });

  it("shows dummy and an exposed seat face-up, not as backs", () => {
    const game = afterOpeningLead();
    const { container } = renderTable(publicGame(game, ["north", "south", "west"]), { exposedSeat: "west" });
    expect(backsAt(container, "south")).toBe(0);
    expect(backsAt(container, "west")).toBe(0);
    expect(backsAt(container, "east")).toBe(12);
  });

  it("keeps backs at an exposed seat whose hand is not sent", () => {
    const { container } = renderTable(publicGame(afterOpeningLead(), ["north"]), { exposedSeat: "west" });
    expect(backsAt(container, "west")).toBe(13);
  });

  it("shows no backs on a completed hand", () => {
    const game = { ...publicGame(afterOpeningLead(), ["north"]), phase: "complete" as const };
    const { container } = renderTable(game);
    expect(container.querySelector(".hidden-hand")).toBeNull();
  });

  it("never puts card names in hidden seats", () => {
    const { container } = renderTable(publicGame(afterOpeningLead(), ["north"]));
    expect(container.querySelectorAll(".hidden-hand").length).toBe(3);
    for (const element of container.querySelectorAll(".hidden-hand, .hidden-hand *")) expect(element.getAttribute("aria-label") ?? "").not.toContain(" of ");
  });
});
