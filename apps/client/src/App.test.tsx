// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { applyAction, cardId, createGameState, deal, trickWinner, undoAction, validatePlay } from "@contractplay/core";
import type { GameState, Solver } from "@contractplay/core";
import { exportPbn, parsePbn } from "@contractplay/pbn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSoloData, saveSoloData, type SavedHand, type SoloData } from "@contractplay/persistence";
import App from "./App.js";
import { suitSymbols } from "./table/labels.js";

function completedGame() {
  let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
  for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
    const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  while (game.phase === "play") {
    const seat = game.currentActor;
    const lead = game.currentTrick[0]?.card.suit;
    const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, lead).legal)!;
    const result = applyAction(game, { type: "play", seat, card });
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  return game;
}

function gameAfterPlays(playCount: number) {
  let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
  for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
    const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  for (let index = 0; index < playCount; index += 1) {
    const seat = game.currentActor;
    const ledSuit = game.currentTrick[0]?.card.suit;
    const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, ledSuit).legal)!;
    const result = applyAction(game, { type: "play", seat, card });
    if (!result.ok) throw new Error(result.error.message);
    game = result.state;
  }
  return game;
}

function storeCurrentGame(game: GameState, completedHands: readonly SavedHand[] = []) {
  window.localStorage.setItem("contractplay.solo", JSON.stringify({
    version: 1,
    currentHandId: "test-hand",
    currentGame: game,
    completedHands
  }));
}


function bidButtonLabel(call: string) {
  if (call === "pass") return "Pass";
  if (call === "double") return "X";
  if (call === "redouble") return "XX";
  const strain = call.slice(1);
  return `${call[0]} ${strain}`;
}

function playButtonLabel(card: { rank: string; suit: string }) {
  const rank = ({ A: "ace", K: "king", Q: "queen", J: "jack", T: "ten" } as Record<string, string>)[card.rank] ?? card.rank;
  return `Play ${rank} of ${card.suit}`;
}

describe("bridge table", () => {
  afterEach(cleanup);
  afterEach(() => vi.restoreAllMocks());
  afterEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.useRealTimers());
  beforeEach(() => window.localStorage.clear());

  it("keeps a completed trick visible for two seconds", () => {
    vi.useFakeTimers();
    const game = gameAfterPlays(3);
    const seat = game.currentActor;
    const ledSuit = game.currentTrick[0]?.card.suit;
    const finalCard = game.hands[seat].find((card) => validatePlay(game.hands[seat], card, ledSuit).legal)!;
    storeCurrentGame(game);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: playButtonLabel(finalCard) }));
    const currentTrick = screen.getByRole("region", { name: "Current trick" });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(4);

    act(() => { vi.advanceTimersByTime(1999); });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(4);
    act(() => { vi.advanceTimersByTime(1); });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(0);
  });

  it("pauses the next play until the completed trick has been visible for two seconds", () => {
    vi.useFakeTimers();
    const game = gameAfterPlays(3);
    const seat = game.currentActor;
    const ledSuit = game.currentTrick[0]?.card.suit;
    const finalCard = game.hands[seat].find((card) => validatePlay(game.hands[seat], card, ledSuit).legal)!;
    const completedResult = applyAction(game, { type: "play", seat, card: finalCard });
    if (!completedResult.ok) throw new Error(completedResult.error.message);
    const nextSeat = completedResult.state.currentActor;
    const nextCard = completedResult.state.hands[nextSeat].find((card) => validatePlay(completedResult.state.hands[nextSeat], card).legal)!;
    storeCurrentGame(game);
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: playButtonLabel(finalCard) }));
    expect(screen.getByRole("button", { name: playButtonLabel(nextCard) }).hasAttribute("disabled")).toBe(true);
    const currentTrick = screen.getByRole("region", { name: "Current trick" });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(4);

    act(() => { vi.advanceTimersByTime(1999); });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(4);
    act(() => { vi.advanceTimersByTime(1); });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: playButtonLabel(nextCard) }));
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(1);
  });

  it("shows the most recently completed trick on demand", () => {
    vi.useFakeTimers();
    storeCurrentGame(gameAfterPlays(4));
    render(<App />);
    const currentTrick = screen.getByRole("region", { name: "Current trick" });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Last trick" }));
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: "Hide last trick" }));
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(0);
  });

  it("does not replace an in-progress trick with the last trick", () => {
    vi.useFakeTimers();
    const game = gameAfterPlays(5);
    storeCurrentGame(game);
    render(<App />);
    const currentTrick = screen.getByRole("region", { name: "Current trick" });
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Last trick" }).hasAttribute("disabled")).toBe(true);
    expect(currentTrick.querySelectorAll(".trick-card")).toHaveLength(1);
  });

  it("clears the temporary trick on undo after trick completion", () => {
    vi.useFakeTimers();
    const game = gameAfterPlays(3);
    const seat = game.currentActor;
    const ledSuit = game.currentTrick[0]?.card.suit;
    const finalCard = game.hands[seat].find((card) => validatePlay(game.hands[seat], card, ledSuit).legal)!;
    storeCurrentGame(game);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: playButtonLabel(finalCard) }));
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(4);

    fireEvent.click(screen.getByRole("button", { name: "Take back" }));
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(3);
  });

  it("keeps a loaded completed hand from starting a completed trick pause", () => {
    vi.useFakeTimers();
    storeCurrentGame(completedGame());
    render(<App />);
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(0);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(0);
  });

  it("shows seat positions for played cards", () => {
    const game = gameAfterPlays(3);
    storeCurrentGame(game);
    const { container } = render(<App />);

    for (const { seat } of game.currentTrick) {
      expect(container.querySelector(`.trick-card-position-${seat}`)).toBeTruthy();
    }
  });

  it("shows partnership trick totals for the winner", () => {
    const game = gameAfterPlays(4);
    const winner = trickWinner(game.completedTricks[0]!, game.contract?.strain === "notrump" ? undefined : game.contract?.strain);
    const nsWon = winner === "north" || winner === "south";
    storeCurrentGame(game);
    render(<App />);

    expect(screen.getByRole("group", { name: `NS ${nsWon ? 1 : 0} · EW ${nsWon ? 0 : 1} tricks` })).toBeTruthy();
  });

  it("keeps the hand and its actions on the table without headings", () => {
    storeCurrentGame(gameAfterPlays(3));
    const { container } = render(<App />);
    const table = container.querySelector(".table-surface") as HTMLElement;

    expect(container.querySelector(".hand-zone .cards-row")).toBeTruthy();
    expect(within(table).getByRole("switch", { name: "Hints" })).toBeTruthy();
    expect(within(table).getByRole("button", { name: "Take back" })).toBeTruthy();
    expect(within(table).getByRole("button", { name: "Redo" })).toBeTruthy();
    expect(container.querySelector("h1, header, footer, .hand-zone h2, .hand-zone h3, .table-status h2")).toBeNull();
  });

  it("plays dummy from across the table while declarer's cards stay in view", () => {
    const game = gameAfterPlays(1);
    const dummy = game.currentActor;
    storeCurrentGame(game);
    render(<App />);

    expect(dummy).toBe("south");
    const dummyHand = screen.getByRole("region", { name: "South's dummy hand" });
    expect(within(dummyHand).getAllByRole("button", { name: /^Play / })).toHaveLength(13);
    expect(screen.getByRole("region", { name: "North's cards" }).querySelectorAll(".playing-card")).toHaveLength(13);
    fireEvent.click(within(dummyHand).getByRole("button", { name: playButtonLabel(game.hands.south.find((card) => validatePlay(game.hands.south, card, game.currentTrick[0]?.card.suit).legal)!) }));
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "South's dummy hand" })).queryByRole("button")).toBeNull();
  });

  it("toggles full screen from the table button and the F key", async () => {
    let fullscreenElement: Element | null = null;
    Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
    document.documentElement.requestFullscreen = vi.fn(() => { fullscreenElement = document.documentElement; return Promise.resolve(); });
    document.exitFullscreen = vi.fn(() => { fullscreenElement = null; return Promise.resolve(); });
    storeCurrentGame(gameAfterPlays(3));
    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(await screen.findByRole("button", { name: "Exit full screen" })).toBeTruthy();
    expect(document.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(document, { key: "f" });
    expect(await screen.findByRole("button", { name: "Full screen" })).toBeTruthy();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    delete (document as { fullscreenElement?: unknown }).fullscreenElement;
  });

  it("keeps the last trick to a small badge showing the card that won it", () => {
    const game = gameAfterPlays(5);
    storeCurrentGame(game);
    render(<App />);
    const winner = trickWinner(game.completedTricks[0]!, game.contract?.strain === "notrump" ? undefined : game.contract?.strain);
    const { card } = game.completedTricks[0]!.find(({ seat }) => seat === winner)!;
    const lastTrick = screen.getByRole("button", { name: "Last trick" });

    expect(lastTrick.querySelectorAll(".table-card")).toHaveLength(0);
    expect(lastTrick.querySelector(".last-trick-chip")!.textContent).toBe(`${card.rank === "T" ? "10" : card.rank}${suitSymbols[card.suit]}`);
  });

  it("disables redo while the completed trick pause is active", () => {
    vi.useFakeTimers();
    const afterThirdCardOfSecondTrick = undoAction(undoAction(gameAfterPlays(9)));
    storeCurrentGame(afterThirdCardOfSecondTrick);
    render(<App />);

    expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByRole("button", { name: "Redo" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(4);
  });

  it("pauses bot play for the full completed-trick display", async () => {
    vi.useFakeTimers();
    const game = gameAfterPlays(3);
    const finalSeat = game.currentActor;
    // The Beginner bot completes the trick with its first legal card in card-id order, which decides who leads next.
    const finalCard = game.hands[finalSeat].filter((card) => validatePlay(game.hands[finalSeat], card, game.currentTrick[0]?.card.suit).legal)
      .sort((a, b) => cardId(a).localeCompare(cardId(b)))[0]!;
    const completed = applyAction(game, { type: "play", seat: finalSeat, card: finalCard });
    if (!completed.ok) throw new Error(completed.error.message);
    const nextSeat = completed.state.currentActor;
    const declarerIsNs = completed.state.contract?.declarer === "north" || completed.state.contract?.declarer === "south";
    const defenders = declarerIsNs ? ["east", "west"] as const : ["north", "south"] as const;
    const userSeat = defenders.find((candidate) => candidate !== finalSeat && candidate !== nextSeat)!;
    storeCurrentGame(game);
    render(<App />);
    fireEvent.change(screen.getByLabelText("Opponents"), { target: { value: "bots" } });
    fireEvent.change(screen.getByLabelText("Your seat"), { target: { value: userSeat } });

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    const status = document.querySelector(".status-pill")!;
    expect(status.textContent).toContain(`${nextSeat[0]!.toUpperCase()}${nextSeat.slice(1)} to play`);
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(4);

    await act(async () => { await vi.advanceTimersByTimeAsync(1999); });
    expect(status.textContent).toContain(`${nextSeat[0]!.toUpperCase()}${nextSeat.slice(1)} to play`);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(status.textContent).not.toContain(`${nextSeat[0]!.toUpperCase()}${nextSeat.slice(1)} to play`);
  });

  it("resets last-trick visibility when exiting review", async () => {
    const user = userEvent.setup();
    const saved = { id: "saved-hand", name: "Bold Finesse", game: completedGame(), savedAt: "2026-10-28T00:00:00.000Z" };
    storeCurrentGame(gameAfterPlays(4), [saved]);
    render(<App />);

    await user.click(screen.getByLabelText("Table menu"));
    await user.click(screen.getByRole("button", { name: /^Review Bold Finesse, played / }));
    for (let action = 0; action < 8; action += 1) {
      await user.click(screen.getByRole("button", { name: "Next action" }));
    }
    await user.click(screen.getByRole("button", { name: "Last trick" }));
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(4);

    await user.click(screen.getByRole("button", { name: "Exit review" }));
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(0);
  });

  it("starts a hand and advances the auction through the core reducer", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    expect(screen.getByRole("region", { name: "Auction" })).toBeTruthy();
    expect(screen.getByText("North to bid")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));
    expect(screen.getAllByRole("listitem")[0]?.textContent).toBe("North1 clubs");
    expect(screen.getByText("East to bid")).toBeTruthy();
  });

  it("centers the auction and keeps setup, PBN import, and recent hands in the table menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(screen.getByRole("region", { name: "Auction" }).closest(".auction-layout")).toBeTruthy();
    const menu = screen.getByLabelText("Table menu").closest("details");
    expect(menu).toBeTruthy();
    await user.click(screen.getByLabelText("Table menu"));
    expect(within(menu!).getByLabelText("Scoring")).toBeTruthy();
    expect(within(menu!).getByRole("table", { name: "Rubber score" })).toBeTruthy();
    expect(within(menu!).getByText("Import a PBN deal")).toBeTruthy();
    expect(within(menu!).getByRole("region", { name: "Recent hands" })).toBeTruthy();
    await user.click(within(menu!).getByText("Import a PBN deal"));
    expect(within(menu!).getByRole("button", { name: "Choose PBN file" })).toBeTruthy();
    expect(within(menu!).getByRole("button", { name: "Import hand" })).toBeTruthy();
  });

  it("keeps the latest call visible in a long centered auction", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));
    const auctionList = screen.getByRole("region", { name: "Auction" }).querySelector("ol")!;
    Object.defineProperty(auctionList, "scrollHeight", { configurable: true, value: 300 });
    for (const bid of ["pass", "1diamonds", "pass", "1hearts", "pass", "1spades", "pass", "1notrump", "pass"]) {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(bid) }));
    }

    expect(auctionList.scrollTop).toBe(300);
    expect(auctionList.lastElementChild?.textContent).toContain("Pass");
  });

  it("keeps the auction centered and hides bid controls on a bot turn", () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.change(screen.getByLabelText("Opponents"), { target: { value: "bots" } });
    fireEvent.change(screen.getByLabelText("Your seat"), { target: { value: "south" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(screen.getByText("Bot · North to bid")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Auction" }).closest(".auction-layout")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Contract bids by level and strain" })).toBeNull();
  });

  it("shows the current package version in the persistent header", () => {
    render(<App />);
    expect(screen.getByText(`Version ${__CONTRACTPLAY_VERSION__}`)).toBeTruthy();
  });

  it("opens an About dialog with the app version from the table menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await user.click(screen.getByLabelText("Table menu"));
    await user.click(screen.getByRole("button", { name: "About ContractPlay" }));

    const about = screen.getByRole("dialog", { name: "ContractPlay" });
    expect(within(about).getByText(`Version ${__CONTRACTPLAY_VERSION__}`)).toBeTruthy();
    expect(screen.getByLabelText("Table menu").closest("details")!.open).toBe(false);

    await user.click(within(about).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists saved hands by name and date played, naming older saves from their id", async () => {
    const user = userEvent.setup();
    const named = { id: "named-hand", name: "Quiet Squeeze", game: completedGame(), savedAt: "2026-10-28T15:30:00.000Z" };
    const legacy = { id: "legacy-hand", game: completedGame(), savedAt: "2026-10-27T15:30:00.000Z" };
    storeCurrentGame(gameAfterPlays(0), [named, legacy]);
    render(<App />);
    await user.click(screen.getByLabelText("Table menu"));

    const recent = screen.getByRole("region", { name: "Recent hands" });
    const played = new Date(named.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    expect(within(recent).getByText("Quiet Squeeze")).toBeTruthy();
    expect(within(recent).getByText(`Played ${played}`)).toBeTruthy();
    expect(within(recent).queryByText(/^Hand \d/)).toBeNull();
    expect(within(recent).getAllByRole("button", { name: /^Review [A-Z][a-z]+ [A-Z][a-z]+, played / })).toHaveLength(2);
  });

  it("draws a faint, non-interactive felt watermark under the table", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    const watermark = document.querySelector(".table-surface > .table-watermark")!;
    expect(watermark.getAttribute("aria-hidden")).toBe("true");
    expect(watermark.textContent).toBe("♠♥♦♣");
  });

  it("lets bots finish the rest of a hand once the user hands over control", async () => {
    const user = userEvent.setup();
    storeCurrentGame(gameAfterPlays(46));
    render(<App />);
    expect(screen.getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0);

    await user.click(screen.getByLabelText("Table menu"));
    await user.click(screen.getByRole("button", { name: "Let bots finish this hand" }));

    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy(), { timeout: 4000 });
    expect(loadSoloData(window.localStorage).currentGame!.phase).toBe("complete");
  });

  it("has bots bid for every seat after a handover and returns control on request", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await user.click(screen.getByLabelText("Table menu"));
    await user.click(screen.getByRole("button", { name: "Let bots finish this hand" }));

    expect(screen.queryByRole("group", { name: "Contract bids by level and strain" })).toBeNull();
    await waitFor(() => expect(loadSoloData(window.localStorage).currentGame!.phase).not.toBe("auction"));
    const game = loadSoloData(window.localStorage).currentGame!;
    if (game.phase === "play") {
      await user.click(screen.getByLabelText("Table menu"));
      await user.click(screen.getByRole("button", { name: "Take back control" }));
      await waitFor(() => expect(screen.getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0), { timeout: 4000 });
      expect(screen.getByRole("button", { name: "Let bots finish this hand" })).toBeTruthy();
    }
  });

  it("disables bids that do not outrank the current contract", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1hearts") }));
    expect(screen.getByRole("button", { name: bidButtonLabel("1clubs") }).hasAttribute("disabled")).toBe(true);

    expect(screen.getByText("East to bid")).toBeTruthy();
  });

  it("enables Double and Redouble only for the correct partnership and aligns calls by seat", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(screen.getByRole("button", { name: "X" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "XX" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));
    expect(screen.getByRole("button", { name: "X" }).hasAttribute("disabled")).toBe(false);
    expect(screen.getByRole("button", { name: "XX" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "X" }));
    expect(screen.getByRole("button", { name: "X" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("button", { name: "XX" }).hasAttribute("disabled")).toBe(false);
    await user.click(screen.getByRole("button", { name: "XX" }));

    const seatCalls = ["north", "east", "south", "west"].map((seat) => container.querySelector(`.seat-${seat} .seat-auction-calls`)?.textContent ?? "");
    expect(seatCalls).toEqual(["1♣", "X", "XX", ""]);
  });

  it("rejects an off-suit card when the player can follow suit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    const selectCall = async (call: string) => {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    };
    await selectCall("1clubs");
    await selectCall("pass");
    await selectCall("pass");
    await selectCall("pass");
    await user.click(screen.getByRole("button", { name: "Play 4 of spades" }));
    await user.click(screen.getByRole("button", { name: "Play 4 of hearts" }));

    expect(screen.getByRole("alert").textContent).toContain("follow suit");
    expect(screen.getByText("South to play")).toBeTruthy();
  });

  it("opens the collapsed auction on demand and marks trick participation", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    for (const bid of ["1clubs", "pass", "pass", "pass"]) {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(bid) }));
    }

    const toggle = screen.getByRole("button", { name: /show auction/i });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".seat-auction-calls")).toBeNull();
    expect(container.querySelector(".play-layout")).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".seat-north .seat-auction-calls")?.textContent).toBe("1♣");
    expect(container.querySelectorAll(".seat-auction-call.call-pass")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /hide auction/i }));
    expect(container.querySelector(".seat-auction-calls")).toBeNull();
    expect(screen.getByRole("region", { name: "Auction" })).toBeTruthy();
    expect(screen.getByText("East to play")).toBeTruthy();
    expect(container.querySelector(".seat-east.active-seat")).toBeTruthy();

    await user.click(screen.getAllByRole("button", { name: /^Play / })[0]!);
    expect(container.querySelector(".seat-east.played-seat")).toBeTruthy();
    expect(container.querySelector(".seat-south.active-seat")).toBeTruthy();
  });

  it("keeps the auction visible on a passed-out hand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    for (let pass = 0; pass < 4; pass++) {
      await user.click(screen.getByRole("button", { name: bidButtonLabel("pass") }));
    }

    expect(screen.getByRole("region", { name: "Auction" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
  });

  it("renders playing cards with classic corner marks and a center suit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    const { container } = render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    for (const bid of ["1clubs", "pass", "pass", "pass"]) {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(bid) }));
    }

    const card = screen.getAllByRole("button", { name: /^Play / })[0]!;
    expect(card.querySelector(".card-corner-top")?.textContent).toBeTruthy();
    expect(card.querySelector(".card-center-suit, .card-portrait")?.textContent).toMatch(/[♠♥♦♣]/);
    expect(card.querySelector(".card-corner-bottom")).toBeTruthy();
    const numericCards = screen.getAllByRole("button", { name: /^Play / }).filter((playingCard) => {
      const rank = playingCard.querySelector(".card-corner-top span")?.textContent;
      return rank && /^[2-9]|10$/.test(rank);
    });
    expect(numericCards.length).toBeGreaterThan(0);
    for (const playingCard of numericCards) {
      const rank = Number(playingCard.querySelector(".card-corner-top span")?.textContent);
      expect(playingCard.querySelectorAll(".card-pip")).toHaveLength(rank);
    }
    expect(container.querySelector(".status-pill")?.textContent).toBe("East to play");
  });

  it("highlights one suggested card with a reason without playing it", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    const selectCall = async (call: string) => {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    };
    await selectCall("1clubs");
    await selectCall("pass");
    await selectCall("pass");
    await selectCall("pass");
    const historyBefore = JSON.parse(window.localStorage.getItem("contractplay.solo")!).currentGame.history;

    await user.click(screen.getByRole("switch", { name: "Hints" }));

    await waitFor(() => expect(document.querySelector(".hint-controls p")?.textContent).toMatch(/^Lead /));
    expect(screen.getAllByRole("button", { name: /^Play / })).toHaveLength(13);
    expect(screen.getAllByRole("button", { name: /^Play / }).filter((card) => card.classList.contains("hinted-card"))).toHaveLength(1);
    expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).currentGame.history).toEqual(historyBefore);
  });

  it("shows optional solver recommendations when a solver is provided", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const solver: Solver = { recommendPlays: vi.fn().mockResolvedValue([{ suit: "spades", rank: "Q" }]) };
    const user = userEvent.setup();
    render(<App solver={solver} />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    const selectCall = async (call: string) => {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    };
    await selectCall("1clubs");
    await selectCall("pass");
    await selectCall("pass");
    await selectCall("pass");

    await user.click(screen.getByRole("switch", { name: "Hints" }));

    expect(await screen.findByText("Recommended by the solver.")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /^Play / }).filter((card) => card.classList.contains("hinted-card"))).toHaveLength(1);
    expect(solver.recommendPlays).toHaveBeenCalled();
  });

  it("shows a message when solver recommendations fail", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const solver: Solver = { recommendPlays: vi.fn().mockRejectedValue(new Error("solver unavailable")) };
    const user = userEvent.setup();
    render(<App solver={solver} />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    for (const call of ["1clubs", "pass", "pass", "pass"]) {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    }

    await user.click(screen.getByRole("switch", { name: "Hints" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Unable to get a hint. Please try again.");
  });

  it("suggests a card of the led suit when following", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    const selectCall = async (call: string) => {
      await user.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    };
    await selectCall("1clubs");
    await selectCall("pass");
    await selectCall("pass");
    await selectCall("pass");
    await user.click(screen.getByRole("button", { name: "Play 4 of spades" }));
    const playableCards = screen.getAllByRole("button", { name: /^Play / });

    await user.click(screen.getByRole("switch", { name: "Hints" }));

    await waitFor(() => expect(document.querySelector(".hinted-card")).toBeTruthy());
    const hintedCards = screen.getAllByRole("button", { name: /^Play / }).filter((card) => card.classList.contains("hinted-card"));
    expect(hintedCards).toHaveLength(1);
    expect(hintedCards.length).toBeLessThan(playableCards.length);
    expect(hintedCards.every((card) => card.getAttribute("aria-label")?.endsWith("of spades"))).toBe(true);
  });

  it("keeps hints hidden until they are switched on, then shows points, a suggested bid and call meanings", async () => {
    let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
    for (const bid of ["1spades", "pass"] as const) {
      const result = applyAction(game, { type: "bid", seat: game.currentActor, bid });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    storeCurrentGame(game);
    const user = userEvent.setup();
    const { container, unmount } = render(<App />);
    const hints = screen.getByRole("switch", { name: "Hints" });

    expect(hints.getAttribute("aria-checked")).toBe("false");
    expect(container.querySelector(".hand-points, .hinted-bid, .call-meaning")).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain North's 1 spades" })).toBeNull();

    await user.click(hints);

    const points = game.hands.south.reduce((total, card) => total + ({ A: 4, K: 3, Q: 2, J: 1 }[card.rank as string] ?? 0), 0);
    expect(container.querySelector(".hand-points")?.textContent).toBe(`${points} HCP`);
    await waitFor(() => expect(container.querySelectorAll(".hinted-bid")).toHaveLength(1));
    expect(container.querySelector(".hint-controls p")?.textContent).toMatch(/^Suggested: /);
    expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).currentGame.auction).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Explain North's 1 spades" }));
    expect(container.querySelector(".call-meaning")?.textContent).toContain("12–21 points with at least five spades");
    await user.click(screen.getByRole("button", { name: "Explain East's Pass" }));
    expect(container.querySelectorAll(".call-meaning")).toHaveLength(1);
    expect(container.querySelector(".call-meaning")?.textContent).toContain("No overcall");
    await user.keyboard("{Escape}");
    expect(container.querySelector(".call-meaning")).toBeNull();

    unmount();
    render(<App />);
    expect(screen.getByRole("switch", { name: "Hints" }).getAttribute("aria-checked")).toBe("true");
    await user.click(screen.getByRole("switch", { name: "Hints" }));
    expect(document.querySelector(".hand-points, .hinted-bid")).toBeNull();
    expect(screen.queryByRole("button", { name: "Explain North's 1 spades" })).toBeNull();
  });

  it("does not display a pending hint after dealing a replacement hand", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Start a new hand" }));
    for (const call of ["1clubs", "pass", "pass", "pass"]) {
      fireEvent.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("switch", { name: "Hints" }));
      fireEvent.click(screen.getByRole("button", { name: "Deal a new hand" }));
    });

    expect(document.querySelector(".hinted-card")).toBeNull();
    expect(document.querySelector(".hint-controls p")?.textContent ?? "").not.toMatch(/^Lead /);
  });

  it("plays legal cards through a complete hand and shows the result", async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Start a new hand" }));
    const selectCall = (call: string) => {
      fireEvent.click(screen.getByRole("button", { name: bidButtonLabel(call) }));
    };
    selectCall("1clubs");
    selectCall("pass");
    selectCall("pass");
    selectCall("pass");

    const suitName: Record<string, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
    for (let cardCount = 0; cardCount < 52 && !screen.queryByRole("region", { name: "Hand result" }); cardCount++) {
      let cards = screen.getAllByRole("button", { name: /^Play / });
      if (cards.every((card) => card.hasAttribute("disabled"))) {
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        cards = screen.getAllByRole("button", { name: /^Play / });
      }
      const leadSymbol = screen.getByRole("region", { name: "Current trick" }).textContent?.match(/[♠♥♦♣]/)?.[0];
      const followingCard = leadSymbol
        ? cards.find((card) => card.getAttribute("aria-label")?.endsWith(`of ${suitName[leadSymbol]}`))
        : undefined;
      fireEvent.click(followingCard ?? cards[0]!);
    }

    expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy();
    const result = within(screen.getByRole("region", { name: "Hand result" }));
    expect(result.getByText(/^(Made|Down \d+)$/)).toBeTruthy();
    expect(result.getByText(/^\d+ of 7 tricks needed$/)).toBeTruthy();
    expect(result.getByText(/^(\d+ (over|under)tricks?|exactly)$/)).toBeTruthy();
    expect(result.getByRole("table", { name: "Rubber score" })).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Table menu"));
    expect(screen.getByRole("button", { name: /^Review [A-Z][a-z]+ [A-Z][a-z]+, played / })).toBeTruthy();
    expect(loadSoloData(window.localStorage).completedHands[0]!.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  }, 30000);

  it("uses the chosen dealer and vulnerability for a new deal", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    await user.selectOptions(screen.getByLabelText("Scoring"), "single");
    await user.selectOptions(screen.getByLabelText("Dealer"), "south");
    await user.selectOptions(screen.getByLabelText("Vulnerability"), "Both");
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(container.querySelector(".seat-south.dealer-seat .dealer-mark")).toBeTruthy();
    expect(container.querySelectorAll(".dealer-seat")).toHaveLength(1);
    expect(container.querySelectorAll(".vulnerable-seat")).toHaveLength(4);
    expect(screen.getByText("South to bid")).toBeTruthy();
    await user.click(screen.getByLabelText("Table menu"));
    await user.selectOptions(screen.getByLabelText("Dealer"), "west");
    await user.selectOptions(screen.getByLabelText("Vulnerability"), "NS");
    await user.click(screen.getByRole("button", { name: "Deal a new hand" }));
    expect(container.querySelector(".seat-west.dealer-seat")).toBeTruthy();
    expect([...container.querySelectorAll(".vulnerable-seat")].map((seat) => seat.classList.contains("seat-north") || seat.classList.contains("seat-south"))).toEqual([true, true]);
  });

  it("runs the three non-user seats through the auction using the selected style", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Opponents"), "bots");
    await user.selectOptions(screen.getByLabelText("Your seat"), "south");
    await user.selectOptions(screen.getByLabelText("Bot bidding style"), "2/1");
    await user.selectOptions(screen.getByLabelText("Bot skill"), "expert");
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    await waitFor(() => expect(screen.getByText("South to bid")).toBeTruthy());
    expect(screen.getByRole("region", { name: "Auction" }).querySelectorAll("li").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Auction" }).querySelectorAll("li").length).toBeLessThan(3);
    expect(screen.getByRole("group", { name: "Contract bids by level and strain" })).toBeTruthy();
  });

  it("offers Beginner through Expert bot skills when bots are enabled", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Opponents"), "bots");

    expect(screen.getByLabelText("Bot skill").textContent).toContain("Beginner");
    expect(screen.getByLabelText("Bot skill").textContent).toContain("Intermediate");
    expect(screen.getByLabelText("Bot skill").textContent).toContain("Advanced");
    expect(screen.getByLabelText("Bot skill").textContent).toContain("Expert");
  });

  it("automates bot play and lets the user play the exposed dummy hand", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.selectOptions(screen.getByLabelText("Opponents"), "bots");
    await user.selectOptions(screen.getByLabelText("Your seat"), "north");
    await user.selectOptions(screen.getByLabelText("Dealer"), "north");
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await waitFor(() => expect(screen.getByText("North to bid")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));

    for (let call = 0; call < 8; call += 1) {
      if (screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card").length > 0) break;
      if (screen.queryByText("North to bid")) {
        await user.click(screen.getByRole("button", { name: bidButtonLabel("pass") }));
        } else {
        await waitFor(() => {
          const hasHumanTurn = !!screen.queryByText("North to bid");
          const hasOpeningLead = screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card").length > 0;
          expect(hasHumanTurn || hasOpeningLead).toBe(true);
        });
      }
    }
    await waitFor(() => expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(1));
    let dummyHand: HTMLElement | null | undefined;
    await waitFor(() => {
      // Dummy is played from across the table when partner declares, or from the user's own hand when the user is dummy.
      dummyHand = screen.queryByRole("region", { name: /'s dummy hand$/ })?.querySelector("button")?.closest("section")
        ?? ["North", "South"].map((seat) => screen.queryByRole("region", { name: `${seat}'s hand` })).find((handPanel) => handPanel?.querySelector(".dummy-compass"));
      expect(dummyHand).toBeTruthy();
    });
    const symbol = screen.getByRole("region", { name: "Current trick" }).textContent?.match(/[♠♥♦♣]/)?.[0];
    const suitName: Record<string, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
    await user.click(screen.getByRole("switch", { name: "Hints" }));
    await waitFor(() => expect(document.querySelector(".hinted-card")).toBeTruthy());
    const hintedDummyCards = screen.getAllByRole("button", { name: /^Play / }).filter((button) => button.classList.contains("hinted-card"));
    expect(hintedDummyCards).toHaveLength(1);
    const dummyCards = screen.getAllByRole("button", { name: /^Play / });
    const ledSuit = symbol ? suitName[symbol] : undefined;
    const canFollowSuit = ledSuit !== undefined && dummyCards.some((button) => button.getAttribute("aria-label")?.endsWith(`of ${ledSuit}`));
    if (canFollowSuit) {
      expect(hintedDummyCards.every((button) => button.getAttribute("aria-label")?.endsWith(`of ${ledSuit}`))).toBe(true);
    }
    const dummyCard = canFollowSuit ? dummyCards.find((button) => button.getAttribute("aria-label")?.endsWith(`of ${ledSuit}`)) : dummyCards[0];
    await user.click(dummyCard!);
    await waitFor(() => expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(3));
  });

  function storeRubber(rubber: object, game: GameState | null = null) {
    window.localStorage.setItem("contractplay.solo", JSON.stringify({
      version: 1, currentHandId: game ? "test-hand" : null, currentGame: game, completedHands: [], rubber
    }));
  }

  it("scores rubber bridge by default, rotating the dealer and making a side vulnerable once it wins a game", async () => {
    const user = userEvent.setup();
    storeRubber({ hands: [{ handId: "h1", below: { NS: 120, EW: 0 }, above: { NS: 0, EW: 0 } }], lastDealer: "north" });
    const { container } = render(<App />);

    expect((screen.getByLabelText("Scoring") as HTMLSelectElement).value).toBe("rubber");
    expect(screen.queryByLabelText("Vulnerability")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(container.querySelector(".seat-east.dealer-seat")).toBeTruthy();
    expect([...container.querySelectorAll(".vulnerable-seat")].map((seat) => [...seat.classList].find((name) => name.startsWith("seat-")))).toEqual(["seat-north", "seat-south"]);
    await user.click(screen.getByLabelText("Table menu"));
    expect(screen.getByRole("table", { name: "Rubber score" }).textContent).toContain("Games NS 1 · EW 0 · NS vulnerable");
  });

  it("adds a finished rubber hand to the scoresheet and keeps it after a reload", () => {
    const finished = completedGame();
    storeRubber({ hands: [], lastDealer: "north", activeHandId: "test-hand" }, finished);
    render(<App />);

    const result = within(screen.getByRole("region", { name: "Hand result" }));
    expect(document.querySelector(".hand-points-line")?.textContent).toMatch(/the line$/);
    expect(result.getByRole("table", { name: "Rubber score" })).toBeTruthy();
    expect(loadSoloData(window.localStorage).rubber?.hands.map((hand) => hand.handId)).toEqual(["test-hand"]);
  });

  it("offers a new rubber once a side has won two games and starts it unvulnerable", async () => {
    const user = userEvent.setup();
    const finished = completedGame();
    storeRubber({ hands: [
      { handId: "h1", below: { NS: 0, EW: 120 }, above: { NS: 0, EW: 0 } },
      { handId: "h2", below: { NS: 0, EW: 100 }, above: { NS: 0, EW: 0 } }
    ], lastDealer: "north", activeHandId: "test-hand" }, finished);
    const { container } = render(<App />);

    // The stored rubber was already over, so this hand's score is ignored and the panel offers a fresh rubber.
    expect(within(screen.getByRole("region", { name: "Hand result" })).getByRole("table", { name: "Rubber score" }).textContent).toContain("EW win the rubber 2–0 (+700 bonus)");
    await user.click(screen.getByRole("button", { name: "Deal a new rubber" }));

    expect(container.querySelectorAll(".vulnerable-seat")).toHaveLength(0);
    expect(container.querySelector(".seat-north.dealer-seat")).toBeTruthy();
    expect(loadSoloData(window.localStorage).rubber?.hands).toEqual([]);
  });

  it("switches hints on from the deal settings before a hand starts", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("checkbox", { name: "Show hints while bidding and playing" }));
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(screen.getByRole("switch", { name: "Hints" }).getAttribute("aria-checked")).toBe("true");
  });

  function gameWithContract(calls: readonly string[]) {
    let game = createGameState({ deal: deal(), dealer: "north", vulnerability: "None" });
    for (const bid of calls) {
      const result = applyAction(game, { type: "bid", seat: game.currentActor, bid: bid as never });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    return game;
  }

  async function playAsSouthAgainstBots() {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByLabelText("Table menu"));
    await user.selectOptions(screen.getByLabelText("Opponents"), "bots");
    await user.selectOptions(screen.getByLabelText("Your seat"), "south");
    return user;
  }

  it("lets the human declarer play both their own hand and the bot dummy's hand", async () => {
    // South declares 1NT; West (bot) leads, then North is dummy.
    storeCurrentGame(gameWithContract(["pass", "pass", "1notrump", "pass", "pass", "pass"]));
    const user = await playAsSouthAgainstBots();

    await waitFor(() => expect(screen.getByText("North to play")).toBeTruthy());
    const dummyButtons = within(screen.getByRole("region", { name: "North's dummy hand" })).getAllByRole("button", { name: /^Play / });
    const ledSuit = Object.entries({ "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" })
      .find(([symbol]) => screen.getByRole("region", { name: "Current trick" }).textContent?.includes(symbol))?.[1];
    await user.click(dummyButtons.find((button) => button.getAttribute("aria-label")?.endsWith(`of ${ledSuit}`)) ?? dummyButtons[0]!);

    await waitFor(() => expect(screen.getByText("South to play")).toBeTruthy());
    expect(within(screen.getByRole("region", { name: "South's hand" })).getAllByRole("button", { name: /^Play / }).length).toBe(13);
  });

  it("lets the human play their own cards when the bot partner declares", async () => {
    // North (bot partner) declares 1NT, so South is dummy; East (bot) leads.
    storeCurrentGame(gameWithContract(["1notrump", "pass", "pass", "pass"]));
    await playAsSouthAgainstBots();

    await waitFor(() => expect(screen.getByText("South to play")).toBeTruthy());
    expect(within(screen.getByRole("region", { name: "South's hand" })).getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0);
  });

  it("lets the human dummy control the bot declarer's hand", async () => {
    // North (bot) declares 1NT. East leads, then South and West play, leaving North to act.
    let game = gameWithContract(["1notrump", "pass", "pass", "pass"]);
    for (let count = 0; count < 3; count += 1) {
      const seat = game.currentActor;
      const ledSuit = game.currentTrick[0]?.card.suit;
      const card = game.hands[seat].find((candidate) => validatePlay(game.hands[seat], candidate, ledSuit).legal)!;
      const result = applyAction(game, { type: "play", seat, card });
      if (!result.ok) throw new Error(result.error.message);
      game = result.state;
    }
    storeCurrentGame(game);
    const user = await playAsSouthAgainstBots();

    expect(screen.getByText("North to play")).toBeTruthy();
    const declarerHand = within(screen.getByRole("region", { name: "North's hand" }));
    const declarerCards = declarerHand.getAllByRole("button", { name: /^Play / });
    expect(declarerCards.length).toBeGreaterThan(0);
    const legalCard = game.hands.north.find((card) => validatePlay(game.hands.north, card, game.currentTrick[0]?.card.suit).legal)!;
    const cardLabel = playButtonLabel(legalCard);
    await user.click(declarerHand.getByRole("button", { name: cardLabel }));

    await waitFor(() => expect(screen.queryByRole("button", { name: cardLabel! })).toBeNull());
  });

  it("discards a queued bot decision when the user deals a replacement hand", async () => {
    vi.useFakeTimers();
    render(<App />);
    fireEvent.change(screen.getByLabelText("Scoring"), { target: { value: "single" } });
    fireEvent.change(screen.getByLabelText("Opponents"), { target: { value: "bots" } });
    fireEvent.change(screen.getByLabelText("Your seat"), { target: { value: "south" } });
    fireEvent.click(screen.getByRole("button", { name: "Start a new hand" }));
    fireEvent.click(screen.getByLabelText("Table menu"));
    fireEvent.change(screen.getByLabelText("Dealer"), { target: { value: "west" } });
    fireEvent.click(screen.getByRole("button", { name: "Deal a new hand" }));

    await act(async () => { await vi.runAllTimersAsync(); });
    const saved = JSON.parse(window.localStorage.getItem("contractplay.solo")!);
    expect(saved.currentGame.dealer).toBe("west");
    expect(saved.currentGame.auction[0].seat).toBe("west");
  });

  it("imports the first PBN board with its deal settings", async () => {
    const user = userEvent.setup();
    let imported = createGameState({ deal: deal(), dealer: "west", vulnerability: "EW" });
    for (const bid of ["1clubs", "pass", "pass", "pass"] as const) {
      const result = applyAction(imported, { type: "bid", seat: imported.currentActor, bid });
      if (!result.ok) throw new Error(result.error.message);
      imported = result.state;
    }
    const pbn = exportPbn({
      dealer: "west", vulnerability: "EW", actions: imported.history.actions, deal: imported.initialDeal,
      tags: [{ name: "Event", value: "Club Night" }], comments: ["Imported note"]
    });
    render(<App />);
    await user.click(screen.getByText("Import a PBN deal"));
    fireEvent.change(screen.getByLabelText("PBN deal"), { target: { value: pbn } });
    await user.click(screen.getByRole("button", { name: "Import hand" }));

    expect(screen.getByText("North to play")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show auction/i }));
    expect(screen.getAllByRole("listitem")).toHaveLength(4);
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).currentPbnMetadata).toEqual({
      tags: expect.arrayContaining([expect.objectContaining({ name: "Event", value: "Club Night" })]),
      comments: ["Imported note"]
    }));
  });

  it("imports a PBN file selected from the browser file picker", async () => {
    const user = userEvent.setup();
    const pbn = exportPbn({ dealer: "north", vulnerability: "None", actions: [], deal: deal() });
    render(<App />);
    await user.click(screen.getByText("Import a PBN deal"));
    await user.click(screen.getByRole("button", { name: "Choose PBN file" }));
    const file = new File([pbn], "board.pbn", { type: "text/plain" });
    Object.defineProperty(file, "text", { value: () => Promise.resolve(pbn) });
    fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });

    expect(await screen.findByText("North to bid")).toBeTruthy();
    expect(screen.getByRole("region", { name: "North's hand" }).querySelectorAll(".playing-card")).toHaveLength(13);
    expect(screen.queryByRole("button", { name: /^Play / })).toBeNull();
  });

  it("exports a saved hand as PBN with its metadata", async () => {
    const user = userEvent.setup();
    const game = completedGame();
    saveSoloData(window.localStorage, {
      version: 1,
      currentHandId: "active-1",
      currentGame: createGameState({ deal: deal(), dealer: "north", vulnerability: "None" }),
      completedHands: [{
        id: "pbn-export-1", game, savedAt: "2026-10-25T12:00:00.000Z",
        pbnMetadata: { tags: [{ name: "Event", value: "Club Night" }, { name: "Site", value: "Table 4" }], comments: ["Imported board note"] }
      }]
    });
    expect(loadSoloData(window.localStorage).completedHands).toHaveLength(1);
    const createObjectURL = vi.fn().mockReturnValue("blob:contractplay-test");
    const revokeObjectURL = vi.fn();
    class CapturedBlob {
      readonly contents: string;
      readonly type: string | undefined;
      constructor(parts: readonly unknown[], options?: BlobPropertyBag) {
        this.contents = parts.map(String).join("");
        this.type = options?.type;
      }
    }
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.stubGlobal("Blob", CapturedBlob);
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    render(<App />);

    await user.click(screen.getByLabelText("Table menu"));
    await user.click(screen.getByRole("button", { name: /^Export PBN of / }));

    const download = createObjectURL.mock.calls[0]?.[0] as CapturedBlob | undefined;
    expect(download).toBeInstanceOf(CapturedBlob);
    expect(download?.type).toBe("text/plain;charset=utf-8");
    const exportedPbn = download?.contents ?? "";
    const board = parsePbn(exportedPbn).boards[0]!;
    expect(board.tags).toContainEqual(expect.objectContaining({ name: "Event", value: "Club Night" }));
    expect(board.tags).toContainEqual(expect.objectContaining({ name: "Site", value: "Table 4" }));
    expect(board.comments).toContain("Imported board note");
    expect(board.actions).toEqual(game.history.actions);
  });

  it("autosaves an accepted call and resumes it after the app reloads", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));

    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).currentGame.auction).toHaveLength(1));
    firstRender.unmount();
    render(<App />);

    expect(screen.getByText("East to bid")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[0]?.textContent).toBe("North1 clubs");
  });

  it("can take back and redo the most recent action", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));
    await user.click(screen.getByRole("button", { name: "Take back" }));
    expect(screen.getByText("North to bid")).toBeTruthy();
    expect(screen.queryByText("North1 clubs")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Redo" }));
    expect(screen.getByText("East to bid")).toBeTruthy();
    expect(screen.getAllByRole("listitem")[0]?.textContent).toBe("North1 clubs");
  });

  it("steps through a saved hand without changing the active hand", async () => {
    const user = userEvent.setup();
    const finished = completedGame();
    const active = createGameState({ deal: deal(), dealer: "east", vulnerability: "EW" });
    const data: SoloData = {
      version: 1,
      currentHandId: "active-1",
      currentGame: active,
      completedHands: [{ id: "finished-1", game: finished, savedAt: "2026-10-25T12:00:00.000Z" }]
    };
    saveSoloData(window.localStorage, data);
    render(<App />);

    await user.click(screen.getByLabelText("Table menu"));
    await user.click(screen.getByRole("button", { name: /^Review / }));
    expect(screen.getByText("Reviewing action 0 of 56")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next action" }));
    expect(screen.getByText("Reviewing action 1 of 56")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Exit review" }));

    expect(screen.getByText("East to bid")).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).currentGame.currentActor).toBe("east");
  });
});

describe("Play online entry", () => {
  beforeEach(() => { window.localStorage.clear(); });
  afterEach(() => { cleanup(); location.hash = ""; });

  it("offers Play online on the start screen and routes to the lobby", async () => {
    render(<App />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Play online" }));
    expect(location.hash).toBe("#/online");
  });
});
