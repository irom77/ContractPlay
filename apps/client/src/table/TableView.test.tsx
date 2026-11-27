// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { applyAction, createDeck, createGameState, deal, legalCards, type GameAction, type GameState, type Seat } from "@contractplay/core";
import type { PublicGame } from "@contractplay/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
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
  it("shows no backs during the auction", () => {
    const { container } = renderTable(publicGame(newGame(), ["north"]), { showBottomHand: true });
    expect(container.querySelectorAll(".hidden-hand")).toHaveLength(0);
    expect(container.querySelector(".seat-east .seat-compass")?.getAttribute("aria-label")).not.toContain("cards");
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

  it("never shows backs at the bottom position, even when its hand is not sent", () => {
    const { container } = renderTable(publicGame(afterOpeningLead(), []), { bottomSeat: "south" });
    expect(container.querySelector(".pos-bottom .hidden-hand")).toBeNull();
    expect(container.querySelectorAll(".hidden-hand").length).toBe(3);
  });

  it("can show the bottom seat's public card backs for an unseated observer", () => {
    const game = afterOpeningLead();
    const { container } = renderTable(publicGame(game, []), { bottomSeat: "south", showBacksAtBottom: true });
    expect(backsAt(container, "east")).toBe(12);
    for (const seat of ["north", "south", "west"] as const) expect(backsAt(container, seat)).toBe(13);
    expect(container.querySelectorAll(".hidden-hand")).toHaveLength(4);
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

  it("lays a finished deal face-up at every seat with its high-card points, and nothing playable", () => {
    let game = playing();
    while (game.phase === "play") game = apply(game, { type: "play", seat: game.currentActor, card: legalCards(game.hands[game.currentActor], game.currentTrick[0]?.card.suit)[0]! });
    const { container, getByRole, queryAllByRole } = renderTable(publicGame(game, []), { showCalls: false, revealedHands: game.initialDeal });
    expect(container.querySelector(".table-surface")!.classList.contains("hands-revealed")).toBe(true);
    for (const seat of ["North", "East", "South", "West"]) expect(getByRole("region", { name: `${seat}'s hand` }).querySelectorAll(".table-card")).toHaveLength(13);
    expect([...container.querySelectorAll(".hcp-badge")].reduce((total, badge) => total + Number.parseInt(badge.textContent!, 10), 0)).toBe(40);
    expect(queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
    // The whole auction stays beside the hands, each seat's calls in order, so the bidding can be reviewed with the cards.
    for (const seat of ["north", "east", "south", "west"] as const) {
      const calls = getByRole("group", { name: `${seat[0]!.toUpperCase()}${seat.slice(1)} calls` }).querySelectorAll(".seat-auction-call");
      expect(calls).toHaveLength(game.auction.filter((entry) => entry.seat === seat).length);
    }
    expect(container.querySelectorAll(".seat-auction-call")).toHaveLength(game.auction.length);
    expect(container.querySelector(".hand-zone")).toBeNull();
  });

  it("ignores revealed hands while the hand is still being played", () => {
    const game = afterOpeningLead();
    const { container } = renderTable(publicGame(game, ["north"]), { revealedHands: game.initialDeal });
    expect(container.querySelector(".hands-revealed")).toBeNull();
    expect(container.querySelector(".hcp-badge")).toBeNull();
  });
});

describe("bot seat badges", () => {
  it("draws bot seats as computers and the rest as circles", () => {
    const { container } = renderTable(publicGame(newGame(), ["north"]), { botSeats: ["east", "west"] });
    expect(container.querySelector(".seat-east .seat-compass")!.classList.contains("bot-compass")).toBe(true);
    expect(container.querySelector(".seat-east .seat-compass")!.getAttribute("aria-label")).toContain("bot");
    expect(container.querySelector(".seat-west .seat-compass")!.classList.contains("bot-compass")).toBe(true);
    expect(container.querySelector(".seat-north .seat-compass")!.classList.contains("bot-compass")).toBe(false);
    expect(container.querySelector(".seat-south .seat-compass")!.classList.contains("bot-compass")).toBe(false);
  });
});

describe("hand layout", () => {
  const fanOf = (element: Element | null | undefined) => (element as HTMLElement | null | undefined)?.style.getPropertyValue("--fan-p");

  it("fans the held hand and the backs by default, but not dummy", () => {
    const { container } = renderTable(publicGame(afterOpeningLead(), ["north", "south"]));
    expect(container.querySelector(".table-panel")?.classList).toContain("hand-layout-fan");
    const held = [...container.querySelectorAll(".seat-north .fanned-hand .table-card")];
    expect(held).toHaveLength(13);
    expect(held.map(fanOf)).toEqual(["-1.0000", "-0.8333", "-0.6667", "-0.5000", "-0.3333", "-0.1667", "0.0000", "0.1667", "0.3333", "0.5000", "0.6667", "0.8333", "1.0000"]);
    expect(container.querySelector(".seat-south .dummy-table-hand")?.classList).not.toContain("fanned-hand");
    expect(fanOf(container.querySelector(".seat-south .table-card"))).toBe("");
    expect(fanOf(container.querySelector(".seat-east .card-back"))).toBe("-0.9167");
  });

  it("lays every hand in a line when asked", () => {
    const { container } = renderTable(publicGame(afterOpeningLead(), ["north", "south"]), { handLayout: "line" });
    expect(container.querySelector(".table-panel")?.classList).toContain("hand-layout-line");
    expect(container.querySelector(".fanned-hand")).toBeNull();
    expect(container.querySelectorAll("[style*='--fan-p']")).toHaveLength(0);
  });

  it("fans the hand zone", () => {
    const { container } = renderTable(publicGame(newGame(), ["north"]), { showBottomHand: true, fixedSeatHands: false });
    const cards = [...container.querySelectorAll(".hand-zone .playing-card")];
    expect(cards).toHaveLength(13);
    expect([fanOf(cards[0]), fanOf(cards[12])]).toEqual(["-1.0000", "1.0000"]);
  });
});

describe("confirming calls", () => {
  /** North opened 1♠ and East passed: South is to call. */
  const southToCall = () => apply(newGame(), { type: "bid", seat: "north", bid: "1spades" }, { type: "bid", seat: "east", bid: "pass" });
  const meaning = (bid: string) => `means ${bid}`;
  const renderAuction = (game: GameState, overrides: Partial<TableViewProps> = {}) => {
    const onBid = vi.fn();
    const view = renderTable(publicGame(game, ["south"]), { bottomSeat: "south", actingSeat: "south", showBottomHand: true, onBid, confirmCalls: { meaning }, ...overrides });
    return { onBid, ...view };
  };

  it("a first tap selects a call and shows its meaning without bidding", async () => {
    const { onBid, getByRole } = renderAuction(southToCall());
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    expect(onBid).not.toHaveBeenCalled();
    expect(getByRole("status").textContent).toContain("means 2spades");
    expect(getByRole("button", { name: "Confirm 2♠" }).textContent).toContain("Bid 2♠");
    expect(getByRole("button", { name: "2 spades" }).classList.contains("selected-bid")).toBe(true);
  });

  it("a second tap on the selected call, or the confirm button, makes it", async () => {
    const first = renderAuction(southToCall());
    await userEvent.click(first.getByRole("button", { name: "2 spades" }));
    await userEvent.click(first.getByRole("button", { name: "2 spades" }));
    expect(first.onBid).toHaveBeenCalledTimes(1);
    expect(first.onBid).toHaveBeenCalledWith("2spades");
    cleanup();
    const second = renderAuction(southToCall());
    await userEvent.click(second.getByRole("button", { name: "Pass" }));
    expect(second.getByRole("button", { name: "Confirm Pass" }).textContent).toContain("Pass");
    await userEvent.click(second.getByRole("button", { name: "Confirm Pass" }));
    expect(second.onBid).toHaveBeenCalledWith("pass");
  });

  it("tapping another call moves the selection", async () => {
    const { onBid, getByRole } = renderAuction(southToCall());
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    await userEvent.click(getByRole("button", { name: "3 spades" }));
    expect(getByRole("status").textContent).toContain("means 3spades");
    expect(onBid).not.toHaveBeenCalled();
  });

  it("Escape or a tap outside the bidding box clears the selection", async () => {
    const { getByRole, queryByRole, container } = renderAuction(southToCall());
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(queryByRole("button", { name: /^Confirm/ })).toBeNull();
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    fireEvent.click(container.querySelector(".table-surface") ?? document.body);
    expect(queryByRole("button", { name: /^Confirm/ })).toBeNull();
  });

  it("the selection is dropped when the auction moves on", async () => {
    const onBid = vi.fn();
    const props = { bottomSeat: "south" as const, actingSeat: "south" as const, showBottomHand: true, onBid, confirmCalls: { meaning } };
    const { getByRole, queryByRole, rerender, container } = renderTable(publicGame(southToCall(), ["south"]), props);
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    // The view refreshes with one more call while South is (again) the one to act, e.g. after a take-back elsewhere.
    const moved = publicGame(apply(southToCall(), { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "2hearts" }, { type: "bid", seat: "north", bid: "2spades" }, { type: "bid", seat: "east", bid: "pass" }), ["south"]);
    rerender(<TableView game={moved} displayedTrick={moved.currentTrick} showCalls={false} onToggleCalls={() => {}} lastTrickOpen={false} onToggleLastTrick={() => {}}
      fixedSeatHands statusText="" ariaLabel="Table" {...props} />);
    expect(queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(container.querySelector(".selected-bid")).toBeNull();
  });

  it("does not bring a pick back when the auction returns to the same length with other calls", async () => {
    const props = { bottomSeat: "south" as const, showBottomHand: true, onBid: vi.fn(), confirmCalls: { meaning } };
    const show = (game: GameState, actingSeat?: Seat) => {
      const shown = publicGame(game, ["south"]);
      return <TableView game={shown} displayedTrick={shown.currentTrick} showCalls={false} onToggleCalls={() => {}} lastTrickOpen={false} onToggleLastTrick={() => {}}
        fixedSeatHands statusText="" ariaLabel="Table" actingSeat={actingSeat} {...props} />;
    };
    const { getByRole, queryByRole, rerender, container } = render(show(southToCall(), "south"));
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    // East takes back the pass, then overcalls 1NT: the auction is as long as before, but it is a different auction.
    rerender(show(apply(newGame(), { type: "bid", seat: "north", bid: "1spades" })));
    rerender(show(apply(newGame(), { type: "bid", seat: "north", bid: "1spades" }, { type: "bid", seat: "east", bid: "1notrump" }), "south"));
    expect(queryByRole("button", { name: /^Confirm/ })).toBeNull();
    expect(container.querySelector(".selected-bid")).toBeNull();
  });

  it("without confirmCalls one tap bids", async () => {
    const { onBid, getByRole, queryByRole } = renderAuction(southToCall(), { confirmCalls: undefined });
    await userEvent.click(getByRole("button", { name: "2 spades" }));
    expect(onBid).toHaveBeenCalledWith("2spades");
    expect(queryByRole("status")).toBeNull();
  });

  it("can open with a call already selected", () => {
    renderAuction(southToCall(), { confirmCalls: { meaning, initial: "2spades" } });
    expect(screen.getByRole("status").textContent).toContain("means 2spades");
  });
});
