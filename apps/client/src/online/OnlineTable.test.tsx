// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { applyAction, claimSeatFor, createDeck, createGameState, deal, legalCards, type GameAction, type GameState, type Seat } from "@contractplay/core";
import { loadSoloData, type StorageLike } from "@contractplay/persistence";
import type { ClientMessage, PublicGame, RefusalReason, SeatInfo, TableView } from "@contractplay/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionStatus, connectTable } from "./connection.js";
import { cardLabel } from "../table/labels.js";
import { saveIdentity } from "./identity.js";
import { OnlineTable } from "./OnlineTable.js";

function memoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

type ConnectInput = Parameters<typeof connectTable>[0];

/** A stand-in for `connectTable`: the test pushes views, refusals, and status, and reads what was sent. */
function fakeService() {
  const sent: ClientMessage[] = [];
  const close = vi.fn();
  let input: ConnectInput | undefined;
  const connect = vi.fn((given: ConnectInput) => {
    input = given;
    return { send: (message: Exclude<ClientMessage, { type: "hello" }>) => void sent.push(message), close };
  });
  const handlers = () => {
    if (!input) throw new Error("not connected");
    return input;
  };
  return {
    connect: connect as unknown as typeof connectTable, connectMock: connect, sent, close,
    push: (view: TableView) => act(() => handlers().onView(view)),
    refuse: (reason: RefusalReason, view: TableView) => act(() => { handlers().onRefused(reason); handlers().onView(view); }),
    status: (status: ConnectionStatus) => act(() => handlers().onStatus(status))
  };
}

const empty: SeatInfo = { kind: "empty" };
const bot: SeatInfo = { kind: "bot", skill: "advanced" };
const human = (name: string, extra: { away?: boolean; standIn?: "intermediate" } = {}): SeatInfo => ({ kind: "human", name, away: extra.away ?? false, ...(extra.standIn ? { standIn: extra.standIn } : {}) });

function tableView(overrides: Partial<TableView> = {}): TableView {
  return {
    id: "ABC234", name: "Friday club", style: "SAYC", scoring: "duplicate", listed: true, revision: 3, handNumber: 0,
    totals: { ns: 0, ew: 0 }, canDeal: false, handInProgress: false,
    seats: { north: empty, east: empty, south: empty, west: empty },
    ...overrides
  };
}

/** The game as `viewer` would receive it: every hand but the visible ones is an empty array. */
function publicGame(game: GameState, visible: readonly Seat[]): PublicGame {
  const hands = { north: [], east: [], south: [], west: [], ...Object.fromEntries(visible.map((seat) => [seat, game.hands[seat]])) };
  return {
    phase: game.phase, dealer: game.dealer, vulnerability: game.vulnerability, currentActor: game.currentActor, auction: game.auction,
    ...(game.contract ? { contract: game.contract } : {}), hands, currentTrick: game.currentTrick, completedTricks: game.completedTricks,
    ...(game.score ? { score: game.score } : {}), ...(game.claim ? { claim: game.claim } : {}), trickLeader: game.trickLeader
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
/** 1NT by North, all pass: North declares and South is dummy; East is on lead. */
const oneNoTrump = () => apply(newGame(), { type: "bid", seat: "north", bid: "1notrump" }, { type: "bid", seat: "east", bid: "pass" }, { type: "bid", seat: "south", bid: "pass" }, { type: "bid", seat: "west", bid: "pass" });
function playOne(game: GameState): GameState {
  const seat = game.currentActor;
  const card = legalCards(game.hands[seat], game.currentTrick[0]?.card.suit)[0]!;
  return apply(game, { type: "play", seat, card });
}
function playCards(game: GameState, count: number): GameState {
  let state = game;
  for (let i = 0; i < count; i += 1) state = playOne(state);
  return state;
}

const seatedNorth = { north: human("Bob"), east: bot, south: bot, west: bot };

/** What the screen showed at one commit, read in the commit itself, before passive effects run. */
type Frame = { trickCards: number; enabledCards: number; result: boolean; table: boolean };
function frameNow(): Frame {
  return {
    trickCards: document.querySelectorAll('[aria-label="Current trick"] [role="img"]').length,
    enabledCards: [...document.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label")?.startsWith("Play ") && !b.disabled).length,
    result: document.querySelector('[aria-label="Hand result"]') !== null,
    table: document.querySelector('[aria-label^="Bridge table"]') !== null
  };
}

function setup(options: { named?: boolean; storage?: StorageLike } = {}) {
  const storage = options.storage ?? memoryStorage();
  if (options.named !== false) saveIdentity(storage, "Bob");
  const service = fakeService();
  const onLeave = vi.fn();
  const frames: Frame[] = [];
  const utils = render(<Profiler id="table" onRender={() => frames.push(frameNow())}>
    <OnlineTable baseUrl="https://x.test" tableId="ABC234" storage={storage} onLeave={onLeave} connect={service.connect} />
  </Profiler>);
  if (options.named !== false) service.status("open");
  return { ...service, storage, onLeave, frames, unmount: utils.unmount };
}

/** Plays from `game` until just before the fourth card of a trick that North or South wins, so declarer leads next. */
function beforeTrickWonByNorthSouth(game: GameState): GameState {
  let state = game;
  for (;;) {
    while (state.currentTrick.length < 3) state = playOne(state);
    const next = playOne(state);
    if (next.currentActor === "north" || next.currentActor === "south") return state;
    state = next;
  }
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("OnlineTable seating", () => {
  it("shows four Sit here buttons to an unseated viewer and sends sit", async () => {
    const user = userEvent.setup();
    const service = setup();
    service.push(tableView());
    expect(screen.getAllByRole("button", { name: "Sit here" })).toHaveLength(4);
    await user.click(within(screen.getByRole("group", { name: "East seat" })).getByRole("button", { name: "Sit here" }));
    expect(service.sent).toEqual([{ type: "sit", seat: "east" }]);
  });

  it("lets a seated viewer add a bot with the chosen skill", async () => {
    const user = userEvent.setup();
    const service = setup();
    service.push(tableView({ yourSeat: "north", host: "north", seats: { north: human("Bob"), east: empty, south: empty, west: empty } }));
    expect(screen.queryAllByRole("button", { name: "Sit here" })).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: "Add bot" })).toHaveLength(3);
    const west = within(screen.getByRole("group", { name: "West seat" }));
    await user.selectOptions(west.getByLabelText("Bot skill"), "expert");
    await user.click(west.getByRole("button", { name: "Add bot" }));
    expect(service.sent).toEqual([{ type: "setBot", seat: "west", skill: "expert" }]);
  });

  it("offers Remove bot, a skill change, Leave seat, and Free seat as allowed", async () => {
    const user = userEvent.setup();
    const service = setup();
    service.push(tableView({ yourSeat: "north", seats: { north: human("Bob"), east: bot, south: human("Ann", { away: true }), west: human("Cy") } }));
    const east = within(screen.getByRole("group", { name: "East seat" }));
    await user.click(east.getByRole("button", { name: "Remove bot" }));
    await user.selectOptions(east.getByLabelText("Bot skill"), "beginner");
    await user.click(within(screen.getByRole("group", { name: "South seat" })).getByRole("button", { name: "Free seat" }));
    expect(within(screen.getByRole("group", { name: "West seat" })).queryByRole("button", { name: "Free seat" })).toBeNull();
    await user.click(within(screen.getByRole("group", { name: "North seat" })).getByRole("button", { name: "Leave seat" }));
    expect(service.sent).toEqual([
      { type: "clearSeat", seat: "east" }, { type: "setBot", seat: "east", skill: "beginner" },
      { type: "clearSeat", seat: "south" }, { type: "leave" }
    ]);
  });

  it("lets the host free a present player's seat", () => {
    const service = setup();
    service.push(tableView({ yourSeat: "north", host: "north", seats: { north: human("Bob"), east: human("Ann"), south: empty, west: empty } }));
    expect(within(screen.getByRole("group", { name: "East seat" })).getByRole("button", { name: "Free seat" })).toBeTruthy();
  });

  it("enables Deal only when the view allows it and sends deal", async () => {
    const user = userEvent.setup();
    const service = setup();
    service.push(tableView({ yourSeat: "north", seats: seatedNorth }));
    expect((screen.getByRole("button", { name: "Deal" }) as HTMLButtonElement).disabled).toBe(true);
    service.push(tableView({ yourSeat: "north", seats: seatedNorth, canDeal: true }));
    await user.click(screen.getByRole("button", { name: "Deal" }));
    expect(service.sent).toEqual([{ type: "deal" }]);
  });

  it("always shows the running totals", () => {
    const service = setup();
    service.push(tableView({ totals: { ns: 420, ew: 50 } }));
    expect(screen.getByText("NS 420 · EW 50")).toBeTruthy();
  });

  it("groups the running score with the contract and trick count in the top-left status corner during a hand", () => {
    const service = setup();
    service.push(tableView({ yourSeat: "north", seats: seatedNorth, handNumber: 1, handInProgress: true, totals: { ns: 420, ew: 50 }, game: publicGame(oneNoTrump(), ["north", "south"]) }));
    const score = screen.getByRole("group", { name: "Score NS 420 · EW 50" });
    expect(score.textContent).toBe("42050");
    expect(score.closest(".table-status")!.querySelector(".trick-count")).toBeTruthy();
    expect(score.closest(".table-tools")).toBeNull();
    expect(screen.getByRole("group", { name: "NS 0 · EW 0 tricks" })).toBeTruthy();
    expect(document.querySelector(".table-status")!.textContent).not.toMatch(/score/i);
  });

  it("copies the table link", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const service = setup();
    service.push(tableView());
    await user.click(screen.getByRole("button", { name: "Copy table link" }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}${location.pathname}#/table/ABC234`);
    expect(await screen.findByText("Link copied.")).toBeTruthy();
  });

  it("shows the waiting text, seats, and totals to an unseated viewer during a hand, and no cards", () => {
    const service = setup();
    service.push(tableView({ handInProgress: true, handNumber: 1, totals: { ns: 0, ew: 110 }, seats: { north: human("Ann"), east: bot, south: bot, west: bot } }));
    expect(screen.getByText("A hand is in progress. You can take a seat when it ends.")).toBeTruthy();
    expect(screen.getByRole("group", { name: "North seat" }).textContent).toContain("Ann");
    expect(screen.getByText("NS 0 · EW 110")).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: "Sit here" })).toHaveLength(0);
    expect(screen.queryByRole("region", { name: "Current trick" })).toBeNull();
    expect(screen.queryAllByRole("img", { name: / of (spades|hearts|diamonds|clubs)$/ })).toHaveLength(0);
  });

  it("keeps online hints off by default and shows points, a suggested call, and call meanings when enabled", async () => {
    const user = userEvent.setup();
    const service = setup();
    const game = newGame();
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat: "north", seats: seatedNorth, game: publicGame(game, ["north"]) }));

    const toggle = screen.getByRole("switch", { name: "Hints" });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(document.querySelector(".hinted-bid, .hand-points, .call-meaning")).toBeNull();
    await user.click(toggle);

    await screen.findByText(/Suggested:/);
    expect(document.querySelectorAll(".hinted-bid")).toHaveLength(1);
    expect(screen.getByLabelText(/high-card points/)).toBeTruthy();
    const afterCall = apply(game, { type: "bid", seat: "north", bid: "1clubs" });
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 13, yourSeat: "north", seats: seatedNorth, game: publicGame(afterCall, ["north"]) }));
    const explainedCall = screen.getByRole("button", { name: "Explain North's 1 clubs" });
    await user.click(explainedCall);
    expect(document.querySelector(".call-meaning")?.textContent).toContain("Opening bid");
    expect(service.storage.getItem("contractplay.hints")).toBe("on");
    service.unmount();
    const reloaded = setup({ storage: service.storage });
    reloaded.push(tableView({ handInProgress: true, handNumber: 1, revision: 13, yourSeat: "north", seats: seatedNorth, game: publicGame(afterCall, ["north"]) }));
    expect(screen.getByRole("switch", { name: "Hints" }).getAttribute("aria-checked")).toBe("true");
    reloaded.unmount();
  });

  it("highlights a suggested legal card on the seated player's lead", async () => {
    const user = userEvent.setup();
    const service = setup();
    const game = apply(createGameState({ deal: deal(createDeck()), dealer: "west", vulnerability: "None" }),
      { type: "bid", seat: "west", bid: "1notrump" },
      { type: "bid", seat: "north", bid: "pass" },
      { type: "bid", seat: "east", bid: "pass" },
      { type: "bid", seat: "south", bid: "pass" });
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat: "north", seats: seatedNorth, game: publicGame(game, ["north"]) }));
    await user.click(screen.getByRole("switch", { name: "Hints" }));

    await waitFor(() => expect(document.querySelectorAll(".hinted-card")).toHaveLength(1));
    const suggested = document.querySelector(".hinted-card");
    expect(suggested?.getAttribute("aria-label")).toMatch(/^Play /);
    expect(document.querySelector(".hint-controls [role=status]")?.textContent).toBeTruthy();
  });
});

describe("OnlineTable play", () => {
  const inHand = (game: GameState, visible: readonly Seat[], overrides: Partial<TableView> = {}) =>
    tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat: "north", seats: seatedNorth, game: publicGame(game, visible), ...overrides });

  it("sends a call with the view's hand number and revision and disables the picker until the next view", async () => {
    const user = userEvent.setup();
    const service = setup();
    const view = inHand(newGame(), ["north"]);
    service.push(view);
    await user.click(screen.getByRole("button", { name: "1 spades" }));
    expect(service.sent).toEqual([{ type: "act", handNumber: 1, revision: 12, action: { type: "bid", seat: "north", bid: "1spades" } }]);
    expect((screen.getByRole("button", { name: "1 spades" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "1 spades" }));
    expect(service.sent).toHaveLength(1);
    // A view with the same revision (a presence change) still ends the wait.
    service.push(view);
    expect((screen.getByRole("button", { name: "1 spades" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("re-enables input after a refusal", async () => {
    const user = userEvent.setup();
    const service = setup();
    const view = inHand(newGame(), ["north"]);
    service.push(view);
    await user.click(screen.getByRole("button", { name: "Pass" }));
    service.refuse("stale", view);
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers no call when it is not the viewer's turn", () => {
    const service = setup();
    const game = apply(newGame(), { type: "bid", seat: "north", bid: "1clubs" });
    service.push(inHand(game, ["north"]));
    expect(screen.queryByRole("button", { name: "1 spades" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    // The viewer's hand is shown at their seat, grouped by suit as in the play, with nothing to play from it.
    const hand = screen.getByRole("region", { name: "North's hand" });
    expect(hand.querySelectorAll(".dummy-suit-row").length).toBe(new Set(game.hands.north.map((card) => card.suit)).size);
    expect(within(hand).getAllByRole("img")).toHaveLength(13);
    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
  });

  it("lets declarer play a dummy card for dummy's seat", async () => {
    const user = userEvent.setup();
    const service = setup();
    const game = playCards(oneNoTrump(), 1);
    expect(game.currentActor).toBe("south");
    service.push(inHand(game, ["north", "south"]));
    expect(within(screen.getByRole("region", { name: "North's hand" })).getAllByRole("img")).toHaveLength(13);
    const dummy = within(screen.getByRole("region", { name: "South's dummy hand" }));
    const card = legalCards(game.hands.south, game.currentTrick[0]!.card.suit)[0]!;
    const buttons = dummy.getAllByRole("button", { name: /^Play / });
    expect(buttons).toHaveLength(13);
    await user.click(dummy.getByRole("button", { name: `Play ${cardLabel(card)}` }));
    expect(service.sent).toEqual([{ type: "act", handNumber: 1, revision: 12, action: { type: "play", seat: "south", card } }]);
  });

  it("shows the suggested dummy card to declarer without exposing another hand", async () => {
    const user = userEvent.setup();
    const service = setup();
    const game = playCards(oneNoTrump(), 1);
    service.push(inHand(game, ["north", "south"]));
    await user.click(screen.getByRole("switch", { name: "Hints" }));

    await waitFor(() => expect(document.querySelectorAll(".hinted-card")).toHaveLength(1));
    const dummy = within(screen.getByRole("region", { name: "South's dummy hand" }));
    expect(dummy.getAllByRole("button", { name: /^Play / }).find((button) => button.classList.contains("hinted-card"))?.getAttribute("aria-label")).toMatch(/^Play /);
    expect(screen.queryByRole("region", { name: "East's hand" })).toBeNull();
    expect(screen.queryByRole("region", { name: "West's hand" })).toBeNull();
  });

  it.each([["east", "left"], ["west", "right"]] as const)("keeps %s's hand clear of a dummy on the %s", (yourSeat, side) => {
    const service = setup();
    const game = playCards(oneNoTrump(), 1);
    const seats = { north: bot, east: bot, south: bot, west: bot, [yourSeat]: human("Bob") };
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat, seats, game: publicGame(game, [yourSeat, "south"]) }));
    const surface = document.querySelector(".table-surface") as HTMLElement;
    const longestSuit = Math.max(...(["clubs", "diamonds", "hearts", "spades"] as const).map((suit) => game.hands.south.filter((card) => card.suit === suit).length));
    expect(surface.classList.contains(`dummy-on-${side}`)).toBe(true);
    expect(surface.style.getPropertyValue("--dummy-span")).toBe(String(longestSuit));
  });

  it("marks a hand spread along the top so it clears the status corner", () => {
    const service = setup();
    const game = playCards(oneNoTrump(), 1);
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat: "south", seats: { north: bot, east: bot, south: human("Bob"), west: bot }, game: publicGame(game, ["north", "south"]) }));
    expect(document.querySelector(".table-surface")!.classList.contains("hand-on-top")).toBe(true);
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 13, yourSeat: "east", seats: { north: bot, east: human("Bob"), south: bot, west: bot }, game: publicGame(game, ["east", "south"]) }));
    expect(document.querySelector(".table-surface")!.classList.contains("hand-on-top")).toBe(false);
  });

  it("marks dummy by its seat badge shape, with no DUMMY text, and keeps names in one head row beside a hand along the edge", () => {
    const service = setup();
    const game = playCards(oneNoTrump(), 1);
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat: "south", seats: { north: bot, east: bot, south: human("Bob"), west: bot }, game: publicGame(game, ["north", "south"]) }));
    for (const position of ["top", "bottom"]) {
      const head = document.querySelector(`.pos-${position}.has-fixed-hand > .seat-head`)!;
      expect(head.querySelector(".seat-compass")).toBeTruthy();
      expect(head.querySelector(".online-seat-label")).toBeTruthy();
    }
    expect(screen.queryByText("DUMMY")).toBeNull();
    expect(screen.getByRole("img", { name: "South, dummy" }).classList.contains("dummy-compass")).toBe(true);
    expect(document.querySelectorAll(".dummy-compass")).toHaveLength(1);

    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 13, yourSeat: "east", seats: { north: bot, east: human("Bob"), south: bot, west: bot }, game: publicGame(game, ["east", "south"]) }));
    expect(document.querySelector(".pos-left .seat-compass")!.classList.contains("dummy-compass")).toBe(true);
  });

  it("lets a human dummy play both hands when the bot partner declares", async () => {
    const user = userEvent.setup();
    const service = setup();
    const seats = { north: bot, east: bot, south: human("Bob"), west: bot };
    const dummyTurn = playCards(oneNoTrump(), 1);
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 12, yourSeat: "south", seats, game: publicGame(dummyTurn, ["north", "south"]) }));
    expect(screen.getByRole("img", { name: "South, dummy" })).toBeTruthy();
    // Every hand sits at its seat on the felt, so no empty bottom strip shrinks the table.
    expect(document.querySelector(".hand-zone")).toBeNull();
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll('[role="img"]')).toHaveLength(1);
    const dummyCard = within(screen.getByRole("region", { name: "South's dummy hand" })).getAllByRole("button", { name: /^Play / })[0]!;
    await user.click(dummyCard);
    expect(service.sent.at(-1)).toMatchObject({ type: "act", action: { type: "play", seat: "south" } });

    const declarerTurn = playCards(oneNoTrump(), 3);
    service.push(tableView({ handInProgress: true, handNumber: 1, revision: 13, yourSeat: "south", seats, game: publicGame(declarerTurn, ["north", "south"]) }));
    expect(screen.getByRole("img", { name: "South, dummy" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll('[role="img"]')).toHaveLength(3);
    const declarerHand = within(screen.getByRole("region", { name: "North's hand" }));
    const declarerCard = declarerHand.getAllByRole("button", { name: /^Play / })[0]!;
    expect((declarerCard as HTMLButtonElement).disabled).toBe(false);
    await user.click(declarerCard);
    expect(service.sent.at(-1)).toMatchObject({ type: "act", action: { type: "play", seat: "north" } });
  });

  it("shows names, Bot, away, and stand-ins beside the seats", () => {
    const service = setup();
    service.push(inHand(newGame(), ["north"], { seats: { north: human("Bob"), east: human("Ann", { away: true }), south: human("Cy", { standIn: "intermediate" }), west: bot } }));
    expect(screen.getByText("Bob")).toBeTruthy();
    expect(screen.getByText("Ann")).toBeTruthy();
    expect(screen.getByText("away")).toBeTruthy();
    expect(screen.getByText("bot playing for Cy")).toBeTruthy();
    expect(screen.getByText("Bot")).toBeTruthy();
  });

  it("holds a completed trick for two seconds", () => {
    vi.useFakeTimers();
    const service = setup();
    const three = playCards(oneNoTrump(), 3);
    service.push(inHand(three, ["north", "south"]));
    const trick = () => within(screen.getByRole("region", { name: "Current trick" })).queryAllByRole("img");
    expect(trick()).toHaveLength(3);
    service.push(inHand(playOne(three), ["north", "south"], { revision: 13 }));
    expect(trick()).toHaveLength(4);
    act(() => { vi.advanceTimersByTime(1999); });
    expect(trick()).toHaveLength(4);
    act(() => { vi.advanceTimersByTime(1); });
    expect(trick()).toHaveLength(0);
  });

  it("draws the held trick, with input disabled, in the very first render of the completing view", () => {
    vi.useFakeTimers();
    const service = setup();
    const three = beforeTrickWonByNorthSouth(playCards(oneNoTrump(), 0));
    service.push(inHand(three, ["north", "south"]));
    const start = service.frames.length;
    service.push(inHand(playOne(three), ["north", "south"], { revision: 13 }));
    const after = service.frames.slice(start);
    expect(after.length).toBeGreaterThan(0);
    for (const frame of after) expect(frame).toMatchObject({ trickCards: 4, enabledCards: 0 });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(service.frames.at(-1)).toMatchObject({ trickCards: 0 });
    expect(service.frames.at(-1)!.enabledCards).toBeGreaterThan(0);
  });

  it("holds the last trick of the hand on the table, then shows the result", () => {
    vi.useFakeTimers();
    const service = setup();
    const last = playCards(oneNoTrump(), 51);
    service.push(inHand(last, ["north", "south"], { revision: 69 }));
    const finished = playOne(last);
    expect(finished.phase).toBe("complete");
    const start = service.frames.length;
    service.push(tableView({ handNumber: 1, revision: 70, yourSeat: "north", seats: seatedNorth, canDeal: true, game: publicGame(finished, []), revealed: finished.initialDeal }));
    const held = service.frames.slice(start);
    expect(held.length).toBeGreaterThan(0);
    for (const frame of held) expect(frame).toMatchObject({ table: true, result: false, trickCards: 4 });
    act(() => { vi.advanceTimersByTime(1999); });
    expect(screen.queryByRole("region", { name: "Hand result" })).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy();
    // The result stays on the table: the whole deal face-up, nothing playable.
    expect(screen.getByRole("region", { name: /^Bridge table .*hand result$/ })).toBeTruthy();
    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
  });

  it("does not carry a held trick into a new hand", () => {
    vi.useFakeTimers();
    const service = setup();
    const three = playCards(oneNoTrump(), 3);
    service.push(inHand(three, ["north", "south"]));
    service.push(inHand(playOne(three), ["north", "south"], { revision: 13 }));
    expect(within(screen.getByRole("region", { name: "Current trick" })).queryAllByRole("img")).toHaveLength(4);
    service.push(inHand(newGame(), ["north"], { handNumber: 2, revision: 20 }));
    expect(within(screen.getByRole("region", { name: "Current trick" })).queryAllByRole("img")).toHaveLength(0);
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("unlocks an action lost across a reconnect when the view after the reconnect arrives", async () => {
    const user = userEvent.setup();
    const service = setup();
    const view = inHand(newGame(), ["north"]);
    service.push(view);
    await user.click(screen.getByRole("button", { name: "Pass" }));
    service.status("reconnecting");
    service.status("open");
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(true);
    service.push(view);
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("hands an away player to a bot", () => {
    const service = setup();
    service.push(inHand(newGame(), ["north"], { seats: { north: human("Bob"), east: human("Ann", { away: true }), south: bot, west: bot } }));
    fireEvent.click(screen.getByRole("button", { name: /^Hand to a bot/ }));
    expect(service.sent).toEqual([{ type: "handToBot", seat: "east" }]);
  });

  it("offers the host Hand to a bot for a present player after two minutes on turn", () => {
    vi.useFakeTimers();
    const service = setup();
    const game = apply(newGame(), { type: "bid", seat: "north", bid: "1clubs" });
    const view = inHand(game, ["north"], { host: "north", seats: { north: human("Bob"), east: human("Ann"), south: bot, west: bot } });
    service.push(view);
    expect(screen.queryByRole("button", { name: /^Hand to a bot/ })).toBeNull();
    act(() => { vi.advanceTimersByTime(60_000); });
    service.push(view);
    act(() => { vi.advanceTimersByTime(59_999); });
    expect(screen.queryByRole("button", { name: /^Hand to a bot/ })).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.click(screen.getByRole("button", { name: /^Hand to a bot/ }));
    expect(service.sent).toEqual([{ type: "handToBot", seat: "east" }]);
  });

  it("disables calls while the connection is down", () => {
    const service = setup();
    service.push(inHand(newGame(), ["north"]));
    service.status("reconnecting");
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(true);
    service.status("open");
    expect((screen.getByRole("button", { name: "Pass" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not offer a non-host Hand to a bot for a present player", () => {
    vi.useFakeTimers();
    const service = setup();
    const game = apply(newGame(), { type: "bid", seat: "north", bid: "1clubs" });
    service.push(inHand(game, ["north"], { host: "east", seats: { north: human("Bob"), east: human("Ann"), south: bot, west: bot } }));
    act(() => { vi.advanceTimersByTime(300_000); });
    expect(screen.queryByRole("button", { name: /^Hand to a bot/ })).toBeNull();
  });

  it("lets a player with a stand-in take the seat back and not act meanwhile", async () => {
    const user = userEvent.setup();
    const service = setup();
    service.push(inHand(newGame(), ["north"], { seats: { ...seatedNorth, north: human("Bob", { standIn: "intermediate" }) } }));
    expect(screen.queryByRole("button", { name: "Pass" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Take my seat back" }));
    expect(service.sent).toEqual([{ type: "resume" }]);
  });

  describe("claims", () => {
    const menuItem = (name: string) => within(screen.getByRole("group", { name: "Game menu", hidden: true })).queryByRole("button", { name, hidden: true }) as HTMLButtonElement | null;
    const humanDefenders = { north: human("Bob"), east: human("Ann"), south: bot, west: human("Cy") };

    it("offers Claim on the viewer's turn and sends a claim for all remaining tricks", async () => {
      const user = userEvent.setup();
      const service = setup();
      service.push(inHand(oneNoTrump(), ["north"]));
      expect(menuItem("Claim")).toBeNull();

      const game = playCards(oneNoTrump(), 1);
      service.push(inHand(game, ["north", "south"], { revision: 13 }));
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      await user.click(menuItem("Claim")!);
      await user.click(screen.getByRole("button", { name: "Claim all 13" }));
      expect(service.sent).toEqual([{ type: "claim", tricks: 13 }]);
      expect(screen.queryByRole("button", { name: "Claim all 13" })).toBeNull();
    });

    it("sends a smaller claim chosen with the stepper", async () => {
      const user = userEvent.setup();
      const service = setup();
      service.push(inHand(playCards(oneNoTrump(), 1), ["north", "south"], { revision: 13 }));
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      await user.click(menuItem("Claim")!);
      await user.click(screen.getByRole("button", { name: "Fewer tricks" }));
      await user.click(screen.getByRole("button", { name: "Claim" }));
      expect(service.sent).toEqual([{ type: "claim", tricks: 12 }]);
    });

    it("shows the claimer Waiting for the opponents with Withdraw, and no Claim or playable cards meanwhile", async () => {
      const user = userEvent.setup();
      const service = setup();
      const game = playCards(oneNoTrump(), 1);
      service.push(inHand(game, ["north", "south"], { revision: 14, seats: humanDefenders, claim: { seat: "north", tricks: 13, waitingOn: ["east", "west"], madeAt: 14 } }));
      expect(screen.getByText(/Waiting for East, West/)).toBeTruthy();
      expect(menuItem("Claim")).toBeNull();
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      const cards = screen.getAllByRole("button", { name: /^Play / }) as HTMLButtonElement[];
      expect(cards.every((button) => button.disabled)).toBe(true);
      await user.click(screen.getByRole("button", { name: "Withdraw" }));
      expect(service.sent).toEqual([{ type: "withdrawClaim" }]);
    });

    it("asks a responder to accept or reject, naming the claim, and shows the claimer's cards face-up", async () => {
      const user = userEvent.setup();
      const service = setup();
      // East (a defender) claims on the opening lead, before dummy is down, so only the claim shows East's cards.
      const game = oneNoTrump();
      const view = inHand(game, ["north", "east"], { revision: 9, seats: humanDefenders, claim: { seat: "east", tricks: 2, waitingOn: ["north"], madeAt: 9 } });
      service.push(view);
      expect(screen.getByText("East claims 2 of the remaining 13 tricks")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
      expect(within(screen.getByRole("region", { name: "East's hand" })).getAllByRole("img")).toHaveLength(13);

      await user.click(screen.getByRole("button", { name: "Accept" }));
      expect(service.sent).toEqual([{ type: "answerClaim", accept: true, claimId: 9 }]);
      service.push(view);
      await user.click(screen.getByRole("button", { name: "Reject" }));
      expect(service.sent.at(-1)).toEqual({ type: "answerClaim", accept: false, claimId: 9 });
    });

    it("shows the claimer's partner the pending claim without answers or Withdraw", () => {
      const service = setup();
      const game = playCards(oneNoTrump(), 1);
      service.push(inHand(game, ["west", "south"], { yourSeat: "west", revision: 14, seats: humanDefenders, claim: { seat: "east", tricks: 13, waitingOn: ["north"], madeAt: 14 } }));
      expect(screen.getByText(/East claims 13 of the remaining 13 tricks.*Waiting for North/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    });

    it("shows who rejected a claim", () => {
      const service = setup();
      service.push(inHand(playCards(oneNoTrump(), 1), ["north", "south"], { revision: 15, claimRejected: { seat: "north", tricks: 13, by: "east" } }));
      expect(screen.getByText("East rejected the claim of 13 tricks")).toBeTruthy();
      // The service allows one claim per side per trick, so Claim waits for the next card.
      expect(menuItem("Claim")).toBeNull();
      service.push(inHand(playCards(oneNoTrump(), 1), ["north", "south"], { revision: 16, claimRejected: { seat: "east", tricks: 13, by: "north" } }));
      expect(menuItem("Claim")).toBeTruthy();
    });

    it("sends no forced card while a claim is pending", () => {
      vi.useFakeTimers();
      const service = setup();
      let game = playCards(oneNoTrump(), 48);
      while (game.currentActor !== "north" && game.currentActor !== "south") game = playOne(game);
      service.push(inHand(game, ["north", "south"], { revision: 20, seats: humanDefenders, claim: { seat: "north", tricks: 1, waitingOn: ["east", "west"], madeAt: 20 } }));
      act(() => { vi.advanceTimersByTime(2000); });
      expect(service.sent).toEqual([]);
    });

    it("names the claim in the hand result", () => {
      const service = setup();
      const played = playCards(oneNoTrump(), 4);
      const finished = apply(played, { type: "claim", seat: claimSeatFor(played)!, tricks: 5 });
      service.push(tableView({ handNumber: 1, revision: 30, yourSeat: "north", seats: seatedNorth, canDeal: true, game: publicGame(finished, []), revealed: finished.initialDeal }));
      const declarer = claimSeatFor(played) === "north" ? "North (declarer)" : { east: "East", west: "West" }[claimSeatFor(played) as "east" | "west"];
      expect(within(screen.getByRole("region", { name: "Hand result" })).getByText(`Claimed by ${declarer}: 5 of the remaining 12 tricks`)).toBeTruthy();
    });

    it("holds a forced card while the viewer has the claim picker open", () => {
      vi.useFakeTimers();
      const service = setup();
      let game = playCards(oneNoTrump(), 48);
      while (game.currentActor !== "north" && game.currentActor !== "south") game = playOne(game);
      service.push(inHand(game, ["north", "south"], { revision: 20 }));
      fireEvent.click(menuItem("Claim")!);
      act(() => { vi.advanceTimersByTime(2000); });
      expect(service.sent).toEqual([]);
      fireEvent.click(screen.getByRole("button", { name: "Claim all 1" }));
      expect(service.sent).toEqual([{ type: "claim", tricks: 1 }]);
    });
  });

  it("saves a finished hand to history once, even when the view repeats", () => {
    const service = setup();
    const finished = playCards(oneNoTrump(), 52);
    expect(finished.phase).toBe("complete");
    const view = tableView({ handNumber: 1, revision: 70, yourSeat: "north", seats: seatedNorth, canDeal: true, totals: { ns: 0, ew: 50 }, game: publicGame(finished, []), revealed: finished.initialDeal });
    service.push(view);
    service.push(view);
    const hands = loadSoloData(service.storage).completedHands;
    expect(hands).toHaveLength(1);
    expect(hands[0]!.id).toBe("online-ABC234-1");
    expect(hands[0]!.name).toBeTruthy();
    expect(hands[0]!.game.completedTricks).toEqual(finished.completedTricks);
    const result = screen.getByRole("region", { name: "Hand result" });
    expect(result.textContent).toContain("by North");
    expect(result.textContent).toContain(`${finished.score!.tricksTaken} of ${finished.score!.tricksRequired} tricks needed`);
    expect(result.textContent).toContain(finished.score!.undertricks > 0 ? `Down ${finished.score!.undertricks}` : "Made");
    expect(result.textContent).toContain("Table score: NS 0 · EW 50");
    expect((within(result).getByRole("button", { name: "Deal" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("lays the whole deal face-up at the seats around the result, with each hand's high-card points", async () => {
    const user = userEvent.setup();
    const service = setup();
    const finished = playCards(oneNoTrump(), 52);
    service.push(tableView({ handNumber: 1, revision: 70, yourSeat: "north", seats: seatedNorth, canDeal: true, game: publicGame(finished, []), revealed: finished.initialDeal }));
    const points = { A: 4, K: 3, Q: 2, J: 1 } as Record<string, number>;
    for (const seat of ["north", "east", "south", "west"] as const) {
      const hand = screen.getByRole("region", { name: `${seat[0]!.toUpperCase()}${seat.slice(1)}'s hand` });
      expect(within(hand).getAllByRole("img")).toHaveLength(13);
      const hcp = finished.initialDeal[seat].reduce((total, card) => total + (points[card.rank] ?? 0), 0);
      expect(hand.closest(".seat")!.querySelector(".hcp-badge")!.textContent).toBe(`${hcp} HCP`);
    }
    expect(document.querySelector(".hand-zone")).toBeNull();

    await user.click(within(screen.getByRole("region", { name: "Hand result" })).getByRole("button", { name: "Deal" }));
    expect(service.sent.at(-1)).toEqual({ type: "deal" });

    // Seating swaps the table for the seat controls; Show the hands brings the result back.
    await user.click(within(screen.getByRole("region", { name: "Hand result" })).getByRole("button", { name: "Seating" }));
    expect(screen.getByRole("group", { name: "West seat" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Last hand" }).textContent).toContain("by North");
    expect(screen.queryByRole("region", { name: "North's hand" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Show the hands" }));
    expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy();
  });
});

describe("OnlineTable connection", () => {
  it("asks for a name first, then connects", async () => {
    const user = userEvent.setup();
    const service = setup({ named: false });
    expect(service.connectMock).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText("Your name"), "Carol");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(service.connectMock).toHaveBeenCalledTimes(1);
    expect(service.connectMock.mock.calls[0]![0]).toMatchObject({ baseUrl: "https://x.test", tableId: "ABC234", identity: { name: "Carol" } });
  });

  it("closes the connection on unmount", () => {
    const service = setup();
    service.unmount();
    expect(service.close).toHaveBeenCalledTimes(1);
  });

  it("shows Reconnecting… while the connection is down", () => {
    const service = setup();
    service.push(tableView());
    service.status("reconnecting");
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
    service.status("open");
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });

  it("asks for a reload when the app was updated", () => {
    const service = setup();
    service.status("reload");
    expect(screen.getByText("ContractPlay was updated. Reload to keep playing.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
  });

  it("explains a table that no longer exists and goes back to the lobby", async () => {
    const user = userEvent.setup();
    const service = setup();
    service.push(tableView());
    service.status("gone");
    expect(screen.getByText("This table no longer exists.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Back to lobby" }));
    expect(service.onLeave).toHaveBeenCalled();
  });

  it("clears a refusal message after five seconds", () => {
    vi.useFakeTimers();
    const service = setup();
    const view = tableView();
    service.push(view);
    service.refuse("seat-taken", view);
    act(() => { vi.advanceTimersByTime(4999); });
    expect(screen.getByRole("alert")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a refusal message when the hand number changes", () => {
    const service = setup();
    const view = tableView({ yourSeat: "north", seats: seatedNorth, canDeal: true });
    service.push(view);
    service.refuse("hand-in-progress", view);
    expect(screen.getByRole("alert")).toBeTruthy();
    service.push(tableView({ yourSeat: "north", seats: seatedNorth, handNumber: 1, handInProgress: true, game: publicGame(newGame(), ["north"]) }));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows nothing for a stale refusal and a message for others", () => {
    const service = setup();
    const view = tableView();
    service.push(view);
    service.refuse("stale", view);
    expect(screen.queryByRole("alert")).toBeNull();
    service.refuse("seat-taken", view);
    expect(screen.getByRole("alert").textContent).toBe("That seat was just taken.");
    service.refuse("not-your-turn", view);
    expect(screen.getByRole("alert").textContent).toBe("It isn't your turn.");
    service.refuse("hand-in-progress", view);
    expect(screen.getByRole("alert").textContent).toBe("That isn't possible right now.");
  });

  describe("game menu", () => {
    const live = (game: GameState, overrides: Partial<TableView> = {}) => tableView({
      yourSeat: "north", seats: seatedNorth, host: "north", handNumber: 1, handInProgress: true, game: publicGame(game, ["north"]), ...overrides
    });
    const menu = () => screen.getByRole("group", { name: "Game menu", hidden: true });
    const item = (name: string) => within(menu()).getByRole("button", { name, hidden: true }) as HTMLButtonElement;

    it("is collapsed by default and opens from its toggle", async () => {
      const user = userEvent.setup();
      const service = setup();
      service.push(live(newGame()));
      const details = menu().closest("details")!;
      expect(details.open).toBe(false);
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      expect(details.open).toBe(true);
      await user.click(item("Back to lobby"));
      expect(service.onLeave).toHaveBeenCalled();
      expect(details.open).toBe(false);
    });

    it("offers Take back only after the viewer's own call with only bots since, and sends it", async () => {
      const user = userEvent.setup();
      const service = setup();
      service.push(live(newGame()));
      expect(item("Take back").disabled).toBe(true);
      const afterBots = apply(newGame(), { type: "bid", seat: "north", bid: "1clubs" }, { type: "bid", seat: "east", bid: "pass" }, { type: "bid", seat: "south", bid: "pass" });
      service.push(live(afterBots, { revision: 4 }));
      expect(item("Take back").disabled).toBe(false);
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      await user.click(item("Take back"));
      expect(service.sent.at(-1)).toEqual({ type: "takeBack" });
      expect(item("Take back").disabled).toBe(true);
      const humanEast = { ...seatedNorth, east: human("Ann") };
      service.push(live(afterBots, { revision: 5, seats: humanEast }));
      expect(item("Take back").disabled).toBe(true);
    });

    it("offers the host Cancel this hand, and leaves only once the service frees the seat", async () => {
      const user = userEvent.setup();
      const service = setup();
      service.push(live(newGame()));
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      await user.click(item("Cancel this hand"));
      expect(service.sent.at(-1)).toEqual({ type: "cancelHand" });
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      await user.click(item("Leave the table"));
      expect(service.sent.at(-1)).toEqual({ type: "leave" });
      expect(service.onLeave).not.toHaveBeenCalled();
      service.push(tableView({ seats: { ...seatedNorth, north: { kind: "bot", skill: "intermediate" } }, handNumber: 1, handInProgress: true }));
      expect(service.onLeave).toHaveBeenCalled();
    });

    /** The last trick, with North (declaring for a bot dummy) to play a single remaining card. */
    const forcedForNorth = () => {
      let game = playCards(oneNoTrump(), 48);
      while (game.currentActor !== "north" && game.currentActor !== "south") game = playOne(game);
      return game;
    };

    it("plays a forced card for the viewer after a short pause", () => {
      vi.useFakeTimers();
      const service = setup();
      const game = forcedForNorth();
      service.push(live(game, { revision: 20, game: publicGame(game, ["north", "south"]) }));
      act(() => { vi.advanceTimersByTime(499); });
      expect(service.sent).toEqual([]);
      act(() => { vi.advanceTimersByTime(1); });
      expect(service.sent).toEqual([{ type: "act", handNumber: 1, revision: 20, action: { type: "play", seat: game.currentActor, card: game.hands[game.currentActor][0] } }]);
    });

    it("leaves a forced card the viewer just took back to the viewer", () => {
      vi.useFakeTimers();
      const service = setup();
      const game = forcedForNorth();
      service.push(live(game, { revision: 21, game: publicGame(game, ["north", "south"]) }));
      fireEvent.click(item("Take back"));
      expect(service.sent).toEqual([{ type: "takeBack" }]);
      service.push(live(game, { revision: 22, game: publicGame(game, ["north", "south"]) }));
      act(() => { vi.advanceTimersByTime(2000); });
      expect(service.sent).toEqual([{ type: "takeBack" }]);
    });

    describe("queueing the next card", () => {
      /** Forced cards are left to the player, so only the queue can send a card. */
      const setupQueue = () => {
        const storage = memoryStorage();
        storage.setItem("contractplay.forcedPlay", "off");
        return setup({ storage });
      };

      it("plays declarer's queued card on declarer's turn, not on dummy's", () => {
        vi.useFakeTimers();
        const service = setupQueue();
        const start = oneNoTrump(); // North declares, East leads, South is a bot dummy North plays for.
        const southToPlay = playOne(start);
        const northToPlay = playCards(southToPlay, 2);
        expect(northToPlay.currentActor).toBe("north");
        const card = legalCards(northToPlay.hands.north, northToPlay.currentTrick[0]!.card.suit)[0]!;

        service.push(live(start, { revision: 10 }));
        fireEvent.click(screen.getByRole("button", { name: `Queue ${cardLabel(card)}` }));
        expect(screen.getByText(`Queued: ${cardLabel(card)}`)).toBeTruthy();

        service.push(live(southToPlay, { revision: 11, game: publicGame(southToPlay, ["north", "south"]) }));
        act(() => { vi.advanceTimersByTime(2000); });
        expect(service.sent).toEqual([]);

        service.push(live(northToPlay, { revision: 13, game: publicGame(northToPlay, ["north", "south"]) }));
        act(() => { vi.advanceTimersByTime(499); });
        expect(service.sent).toEqual([]);
        act(() => { vi.advanceTimersByTime(1); });
        expect(service.sent).toEqual([{ type: "act", handNumber: 1, revision: 13, action: { type: "play", seat: "north", card } }]);
      });

      it("sends a queued card that is also the forced card only once", () => {
        vi.useFakeTimers();
        const service = setup(); // Forced play stays on.
        // The last trick with West to play and North (the viewer, holding one card) next.
        let westToPlay: GameState | undefined;
        while (!westToPlay) {
          let game = playCards(oneNoTrump(), 48);
          while (game.currentActor !== "west" && game.currentTrick.length < 4 && game.hands.north.length === 1) game = playOne(game);
          if (game.currentActor === "west" && game.hands.north.length === 1) westToPlay = game;
        }
        const northToPlay = playOne(westToPlay);
        expect(northToPlay.currentActor).toBe("north");
        const card = northToPlay.hands.north[0]!;

        service.push(live(westToPlay, { revision: 30, game: publicGame(westToPlay, ["north", "south"]) }));
        fireEvent.click(screen.getByRole("button", { name: `Queue ${cardLabel(card)}` }));
        service.push(live(northToPlay, { revision: 31, game: publicGame(northToPlay, ["north", "south"]) }));
        const acts = () => service.sent.filter((message) => message.type === "act");
        act(() => { vi.advanceTimersByTime(500); });
        expect(acts()).toEqual([{ type: "act", handNumber: 1, revision: 31, action: { type: "play", seat: "north", card } }]);
        act(() => { vi.advanceTimersByTime(2000); });
        expect(acts()).toHaveLength(1);
      });

      it("lets a human dummy queue for both declaring hands when the bot partner declares", () => {
        const service = setupQueue();
        const seats = { north: bot, east: bot, south: human("Bob"), west: bot };
        const westToPlay = playCards(oneNoTrump(), 2); // East led and South (dummy) played; West is to play.
        service.push(tableView({ handInProgress: true, handNumber: 1, revision: 14, yourSeat: "south", seats, game: publicGame(westToPlay, ["north", "south"]) }));
        expect(within(screen.getByRole("region", { name: "North's hand" })).getAllByRole("button", { name: /^Queue / })).toHaveLength(13);
        expect(within(screen.getByRole("region", { name: "South's dummy hand" })).getAllByRole("button", { name: /^Queue / })).toHaveLength(12);
      });

      it("drops the queue when another player takes an action back", () => {
        vi.useFakeTimers();
        const service = setupQueue();
        const start = oneNoTrump();
        const southToPlay = playOne(start);
        const northToPlay = playCards(southToPlay, 2);
        const card = legalCards(northToPlay.hands.north, northToPlay.currentTrick[0]!.card.suit)[0]!;
        service.push(live(southToPlay, { revision: 11, game: publicGame(southToPlay, ["north", "south"]) }));
        const westToPlay = playOne(southToPlay);
        service.push(live(westToPlay, { revision: 12, game: publicGame(westToPlay, ["north", "south"]) }));
        fireEvent.click(screen.getByRole("button", { name: `Queue ${cardLabel(card)}` }));
        expect(screen.getByText(`Queued: ${cardLabel(card)}`)).toBeTruthy();

        // East takes back the opening lead: fewer cards played in the same hand.
        service.push(live(start, { revision: 13 }));
        expect(screen.queryByText(/^Queued:/)).toBeNull();
        service.push(live(northToPlay, { revision: 14, game: publicGame(northToPlay, ["north", "south"]) }));
        expect(screen.queryAllByRole("button", { name: /^Unqueue / })).toHaveLength(0);
        act(() => { vi.advanceTimersByTime(2000); });
        expect(service.sent).toEqual([]);
      });

      it("drops the queue when the connection breaks", () => {
        const service = setupQueue();
        const westToPlay = playCards(oneNoTrump(), 2);
        service.push(live(westToPlay, { revision: 15, game: publicGame(westToPlay, ["north", "south"]) }));
        fireEvent.click(screen.getAllByRole("button", { name: /^Queue / })[0]!);
        expect(screen.getAllByRole("button", { name: /^Unqueue / })).toHaveLength(1);
        service.status("reconnecting");
        service.status("open");
        service.push(live(westToPlay, { revision: 15, game: publicGame(westToPlay, ["north", "south"]) }));
        expect(screen.queryAllByRole("button", { name: /^Unqueue / })).toHaveLength(0);
        expect(screen.getAllByRole("button", { name: /^Queue / }).length).toBeGreaterThan(0);
      });

      it("offers no queue while a bot plays for the viewer", () => {
        const service = setupQueue();
        const autoNorth: SeatInfo = { kind: "human", name: "Bob", away: false, standIn: "intermediate", autoPlay: true };
        service.push(live(oneNoTrump(), { revision: 10 }));
        expect(screen.getAllByRole("button", { name: /^Queue / }).length).toBeGreaterThan(0);
        service.push(live(oneNoTrump(), { revision: 11, seats: { ...seatedNorth, north: autoNorth } }));
        expect(screen.queryAllByRole("button", { name: /^Queue / })).toHaveLength(0);
      });

      it("drops the queue when the viewer takes a card back", () => {
        const service = setupQueue();
        const westToPlay = playCards(oneNoTrump(), 2); // East led, North played dummy's card; West is to play.
        service.push(live(westToPlay, { revision: 15, game: publicGame(westToPlay, ["north", "south"]) }));
        fireEvent.click(screen.getAllByRole("button", { name: /^Queue / })[0]!);
        expect(screen.getAllByRole("button", { name: /^Unqueue / })).toHaveLength(1);
        fireEvent.click(screen.getByLabelText("Game menu", { selector: "summary" }));
        fireEvent.click(item("Take back"));
        expect(screen.queryAllByRole("button", { name: /^Unqueue / })).toHaveLength(0);
      });
    });

    it("offers Auto play in the auction and card play, and shows it until the viewer stops it", async () => {
      const user = userEvent.setup();
      const service = setup();
      service.push(live(newGame()));
      expect(within(menu()).queryByRole("button", { name: "Auto play this hand", hidden: true })).toBeTruthy();
      service.push(live(oneNoTrump(), { revision: 4 }));
      await user.click(screen.getByLabelText("Game menu", { selector: "summary" }));
      await user.click(item("Auto play this hand"));
      expect(service.sent.at(-1)).toEqual({ type: "autoPlay" });

      const autoNorth: SeatInfo = { kind: "human", name: "Bob", away: false, standIn: "intermediate", autoPlay: true };
      service.push(live(oneNoTrump(), { revision: 5, seats: { ...seatedNorth, north: autoNorth } }));
      expect(within(menu()).queryByRole("button", { name: "Auto play this hand", hidden: true })).toBeNull();
      expect(screen.getByText("auto play")).toBeTruthy();
      await user.click(within(screen.getByRole("group", { name: "Auto play is on" })).getByRole("button", { name: "Stop auto play" }));
      expect(service.sent.at(-1)).toEqual({ type: "resume" });
    });

    it("does not offer a non-host Cancel this hand", () => {
      const service = setup();
      service.push(live(newGame(), { host: "east", seats: { ...seatedNorth, east: human("Ann") } }));
      expect(within(menu()).queryByRole("button", { name: "Cancel this hand", hidden: true })).toBeNull();
    });
  });
});
