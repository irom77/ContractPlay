// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { applyAction, cardId, createGameState, deal, RANKS, trickWinner, undoAction, validatePlay } from "@contractplay/core";
import type { GameState, Solver } from "@contractplay/core";
import { exportPbn, parsePbn } from "@contractplay/pbn";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSoloData, saveSoloData, type SavedHand, type SoloData } from "@contractplay/persistence";
import { handName } from "./handNames.js";
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


const menuToggle = () => screen.getByLabelText("Game menu", { selector: "summary" });
/** Items currently offered in the game menu, open or not. */
const menuItem = (name: string) => within(screen.getByRole("group", { name: "Game menu", hidden: true })).queryByRole("button", { name, hidden: true }) as HTMLButtonElement | null;

/** Opens the game menu's entry `name` (Settings, Scores, Recent hands, About ContractPlay, ...). */
function chooseMenu(name: string) {
  fireEvent.click(menuToggle());
  fireEvent.click(within(screen.getByRole("group", { name: "Game menu", hidden: true })).getByRole("button", { name, hidden: true }));
}

/** Changes a deal setting: on the start screen directly, at the table through the game menu's Settings dialog. */
function setSetting(label: string, value: string) {
  const direct = screen.queryByLabelText(label);
  if (direct) { fireEvent.change(direct, { target: { value } }); return; }
  chooseMenu("Settings");
  fireEvent.change(within(screen.getByRole("dialog", { name: "Settings" })).getByLabelText(label), { target: { value } });
  fireEvent.click(within(screen.getByRole("dialog", { name: "Settings" })).getByRole("button", { name: "Close" }));
}

function bidButtonLabel(call: string) {
  if (call === "pass") return "Pass";
  if (call === "double") return "X";
  if (call === "redouble") return "XX";
  const strain = call.slice(1);
  return `${call[0]} ${strain}`;
}

/** The suit of the card leading the trick on the table, read from its label since cards draw their suits as shapes. */
function currentLedSuit(): string | undefined {
  return screen.getByRole("region", { name: "Current trick" }).querySelector(".trick-card")?.getAttribute("aria-label")?.match(/ of (\w+)$/)?.[1];
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
    // As at an online table, Take back lives in the game menu, and there is no Redo.
    expect(menuItem("Take back")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Redo/, hidden: true })).toBeNull();
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
    setSetting("Opponents", "bots");
    setSetting("Your seat", userSeat);

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

    chooseMenu("Recent hands");
    await user.click(screen.getByRole("button", { name: /^Review Bold Finesse, played / }));
    for (let action = 0; action < 8; action += 1) {
      await user.click(screen.getByRole("button", { name: "Next action" }));
    }
    await user.click(screen.getByRole("button", { name: "Last trick" }));
    expect(screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card")).toHaveLength(4);

    chooseMenu("Exit review");
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

  it("centers the auction and offers the same game menu as online, with settings, rubber, and hands in dialogs", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(screen.getByRole("region", { name: "Auction" }).closest(".auction-layout")).toBeTruthy();
    const menu = screen.getByRole("group", { name: "Game menu", hidden: true });
    expect(menu.closest("details")!.classList.contains("game-menu")).toBe(true);
    // The hand's actions first, then this device's settings and hands, and dealing again apart at the end.
    expect(within(menu).getAllByRole("button", { hidden: true }).map((button) => button.textContent))
      .toEqual(["Online tables", "Take back", "Auto play this hand", "Settings", "Scores", "Recent hands", "About ContractPlay", "Deal a new hand"]);
    expect(menuItem("Take back")!.disabled).toBe(true);
    expect(menuItem("Deal a new hand")!.classList.contains("menu-danger")).toBe(true);

    chooseMenu("Settings");
    expect(within(screen.getByRole("dialog", { name: "Settings" })).getByLabelText("Scoring")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    chooseMenu("Scores");
    expect(within(screen.getByRole("dialog", { name: "Scores" })).getByRole("region", { name: "Scorecard" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close" }));
    chooseMenu("Recent hands");
    const hands = screen.getByRole("dialog", { name: "Recent hands" });
    expect(within(hands).getByRole("region", { name: "Recent hands" })).toBeTruthy();
    await user.click(within(hands).getByText("Import a PBN deal"));
    expect(within(hands).getByRole("button", { name: "Choose PBN file" })).toBeTruthy();
    expect(within(hands).getByRole("button", { name: "Import hand" })).toBeTruthy();
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
    setSetting("Opponents", "bots");
    setSetting("Your seat", "south");
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
    await user.click(menuToggle());
    await user.click(screen.getByRole("button", { name: "About ContractPlay" }));

    const about = screen.getByRole("dialog", { name: "ContractPlay" });
    expect(within(about).getByText(`Version ${__CONTRACTPLAY_VERSION__}`)).toBeTruthy();
    expect(menuToggle().closest("details")!.open).toBe(false);

    await user.click(within(about).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("lists saved hands by name and date played, naming older saves after South's dealt cards", async () => {
    const user = userEvent.setup();
    const named = { id: "named-hand", name: "Quiet Squeeze", game: completedGame(), savedAt: "2026-10-28T15:30:00.000Z" };
    const legacy = { id: "legacy-hand", game: completedGame(), savedAt: "2026-10-27T15:30:00.000Z" };
    storeCurrentGame(gameAfterPlays(0), [named, legacy]);
    render(<App />);
    chooseMenu("Recent hands");
    await user.click(screen.getByText("Import a PBN deal"));

    const recent = screen.getByRole("region", { name: "Recent hands" });
    const played = new Date(named.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    expect(within(recent).getByText("Quiet Squeeze")).toBeTruthy();
    expect(within(recent).getByText(`Played ${played}`)).toBeTruthy();
    expect(within(recent).queryByText(/^Hand \d/)).toBeNull();
    expect(within(recent).getByRole("button", { name: /^Review Quiet Squeeze, played / })).toBeTruthy();
    expect(within(recent).getByRole("button", { name: `Review ${handName(legacy.game.initialDeal.south)}, played ${new Date(legacy.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` })).toBeTruthy();
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
    storeCurrentGame(gameAfterPlays(46));
    render(<App />);
    expect(screen.getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0);

    chooseMenu("Auto play this hand");

    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
    await waitFor(() => expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy(), { timeout: 8000 });
    expect(loadSoloData(window.localStorage).currentGame!.phase).toBe("complete");
  }, 10_000);

  it("plays a forced card automatically after a short pause", async () => {
    vi.useFakeTimers();
    storeCurrentGame(gameAfterPlays(48));
    render(<App />);
    const trickCards = () => screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card").length;

    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(trickCards()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(trickCards()).toBe(1);
    expect(loadSoloData(window.localStorage).currentGame!.currentTrick).toHaveLength(1);
  });

  it("leaves forced cards to the player when that setting is off", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("contractplay.forcedPlay", "off");
    storeCurrentGame(gameAfterPlays(48));
    render(<App />);

    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(loadSoloData(window.localStorage).currentGame!.currentTrick).toHaveLength(0);
    chooseMenu("Settings");
    const setting = screen.getByRole("checkbox", { name: "Play forced cards automatically" }) as HTMLInputElement;
    expect(setting.checked).toBe(false);
    fireEvent.click(setting);
    expect(window.localStorage.getItem("contractplay.forcedPlay")).toBe("on");
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(loadSoloData(window.localStorage).currentGame!.currentTrick).toHaveLength(1);
  });

  it("does not replay a forced card the player took back", async () => {
    vi.useFakeTimers();
    storeCurrentGame(gameAfterPlays(48));
    render(<App />);
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(loadSoloData(window.localStorage).currentGame!.currentTrick).toHaveLength(1);

    chooseMenu("Take back");
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(loadSoloData(window.localStorage).currentGame!.currentTrick).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0);
  });

  it("auto plays the rest of the deal on request and hands the next deal back", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("contractplay.forcedPlay", "off");
    storeCurrentGame(gameAfterPlays(44));
    render(<App />);

    chooseMenu("Auto play this hand");
    // As online: a draggable banner says Auto play is on and offers Stop auto play; the menu no longer offers it.
    const banner = screen.getByRole("group", { name: "Auto play is on" });
    expect(within(banner).getByRole("button", { name: "Stop auto play" })).toBeTruthy();
    expect(within(banner).getByRole("button", { name: "Move this banner" })).toBeTruthy();
    expect(menuItem("Auto play this hand")).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
    expect(document.querySelector(".status-pill")!.textContent).toContain("Bot ·");

    await waitFor(() => expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy(), { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: "Next deal" }));
    expect(screen.getByRole("group", { name: "Contract bids by level and strain" })).toBeTruthy();
    expect(document.querySelector(".status-pill")!.textContent).not.toContain("Bot ·");
  });

  it("lets bots bid for every seat after Auto play in the auction", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    chooseMenu("Auto play this hand");

    expect(screen.queryByRole("group", { name: "Contract bids by level and strain" })).toBeNull();
    expect(screen.getByRole("group", { name: "Auto play is on" })).toBeTruthy();
    await waitFor(() => expect(loadSoloData(window.localStorage).currentGame!.phase).not.toBe("auction"));
  });

  it("offers Auto play in card play too, and Stop auto play returns control", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem("contractplay.forcedPlay", "off");

    storeCurrentGame(gameAfterPlays(4));
    render(<App />);
    chooseMenu("Auto play this hand");
    expect(screen.queryAllByRole("button", { name: /^Play / })).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Stop auto play" }));
    expect(screen.queryByRole("group", { name: "Auto play is on" })).toBeNull();
    await waitFor(() => expect(screen.getAllByRole("button", { name: /^Play / }).length).toBeGreaterThan(0), { timeout: 4000 });
    expect(menuItem("Auto play this hand")).toBeTruthy();
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
    expect(card.querySelector(".card-center-suit svg.suit-glyph, .card-portrait svg.suit-glyph")).toBeTruthy();
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

    for (let cardCount = 0; cardCount < 52 && !screen.queryByRole("region", { name: "Hand result" }); cardCount++) {
      let cards = screen.getAllByRole("button", { name: /^Play / });
      if (cards.every((card) => card.hasAttribute("disabled"))) {
        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
        cards = screen.getAllByRole("button", { name: /^Play / });
      }
      const ledSuit = currentLedSuit();
      const followingCard = ledSuit
        ? cards.find((card) => card.getAttribute("aria-label")?.endsWith(`of ${ledSuit}`))
        : undefined;
      fireEvent.click(followingCard ?? cards[0]!);
    }

    expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy();
    const result = within(screen.getByRole("region", { name: "Hand result" }));
    expect(result.getByText(/^(Made|Down \d+)$/)).toBeTruthy();
    expect(result.getByText(/^\d+ of 7 tricks needed$/)).toBeTruthy();
    expect(result.getByText(/^(\d+ (over|under)tricks?|exactly)$/)).toBeTruthy();
    expect(result.getByRole("region", { name: "Scorecard" })).toBeTruthy();
    // Once the last trick clears, the whole deal lies face-up at the seats, each with its high-card points.
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    for (const seat of ["North", "East", "South", "West"]) expect(within(screen.getByRole("region", { name: `${seat}'s hand` })).getAllByRole("img")).toHaveLength(13);
    expect(document.querySelectorAll(".hcp-badge")).toHaveLength(4);
    chooseMenu("Recent hands");
    // Without bots at the table, a hand is named after South's dealt cards.
    const saved = loadSoloData(window.localStorage).completedHands[0]!;
    expect(saved.name).toBe(handName(saved.game.initialDeal.south));
    expect(saved.name).toMatch(/^S[AKQJT2-9]*_H[AKQJT2-9]*_C[AKQJT2-9]*_D[AKQJT2-9]*$/);
    expect(screen.getByRole("button", { name: new RegExp(`^Review ${saved.name}, played `) })).toBeTruthy();
  }, 30000);

  it("uses the chosen dealer and vulnerability for a new deal", async () => {
    const user = userEvent.setup();
    const { container } = render(<App />);

    setSetting("Scoring", "single");
    setSetting("Dealer", "south");
    setSetting("Vulnerability", "Both");
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    expect(container.querySelector(".seat-south.dealer-seat .dealer-mark")).toBeTruthy();
    expect(container.querySelectorAll(".dealer-seat")).toHaveLength(1);
    expect(container.querySelectorAll(".vulnerable-seat")).toHaveLength(4);
    expect(screen.getByText("South to bid")).toBeTruthy();
    await user.click(menuToggle());
    setSetting("Dealer", "west");
    setSetting("Vulnerability", "NS");
    await user.click(screen.getByRole("button", { name: "Deal a new hand" }));
    expect(container.querySelector(".seat-west.dealer-seat")).toBeTruthy();
    expect([...container.querySelectorAll(".vulnerable-seat")].map((seat) => seat.classList.contains("seat-north") || seat.classList.contains("seat-south"))).toEqual([true, true]);
  });

  it("runs the three non-user seats through the auction using the selected style", async () => {
    const user = userEvent.setup();
    render(<App />);
    setSetting("Opponents", "bots");
    setSetting("Your seat", "south");
    setSetting("Bot bidding style", "2/1");
    setSetting("Bot skill", "expert");
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));

    // Against bots your own turn reads as it does online.
    await waitFor(() => expect(screen.getByText("Your call")).toBeTruthy());
    expect(screen.getByRole("region", { name: "Auction" }).querySelectorAll("li").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", { name: "Auction" }).querySelectorAll("li").length).toBeLessThan(3);
    expect(screen.getByRole("group", { name: "Contract bids by level and strain" })).toBeTruthy();
  });

  it("names a hand finished against bots after the player's own dealt cards", async () => {
    const game = gameAfterPlays(51);
    storeCurrentGame(game);
    render(<App />);
    setSetting("Opponents", "bots");
    setSetting("Your seat", "east");
    // The last card is forced, so it plays itself whoever holds it.
    await waitFor(() => expect(loadSoloData(window.localStorage).completedHands).toHaveLength(1), { timeout: 5000 });
    expect(loadSoloData(window.localStorage).completedHands[0]!.name).toBe(handName(game.initialDeal.east));
  });

  it("offers Beginner through Expert bot skills when bots are enabled", async () => {
    render(<App />);
    setSetting("Opponents", "bots");

    expect(screen.getByLabelText("Bot skill").textContent).toContain("Beginner");
    expect(screen.getByLabelText("Bot skill").textContent).toContain("Intermediate");
    expect(screen.getByLabelText("Bot skill").textContent).toContain("Advanced");
    expect(screen.getByLabelText("Bot skill").textContent).toContain("Expert");
  });

  it("automates bot play and lets the user play the exposed dummy hand", async () => {
    const user = userEvent.setup();
    render(<App />);
    setSetting("Opponents", "bots");
    setSetting("Your seat", "north");
    setSetting("Dealer", "north");
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    await waitFor(() => expect(screen.getByText("Your call")).toBeTruthy());
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));

    for (let call = 0; call < 8; call += 1) {
      if (screen.getByRole("region", { name: "Current trick" }).querySelectorAll(".trick-card").length > 0) break;
      if (screen.queryByText("Your call")) {
        await user.click(screen.getByRole("button", { name: bidButtonLabel("pass") }));
        } else {
        await waitFor(() => {
          const hasHumanTurn = !!screen.queryByText("Your call");
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
    const ledSuit = currentLedSuit();
    await user.click(screen.getByRole("switch", { name: "Hints" }));
    await waitFor(() => expect(document.querySelector(".hinted-card")).toBeTruthy());
    const hintedDummyCards = screen.getAllByRole("button", { name: /^Play / }).filter((button) => button.classList.contains("hinted-card"));
    expect(hintedDummyCards).toHaveLength(1);
    const dummyCards = screen.getAllByRole("button", { name: /^Play / });
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
    chooseMenu("Scores");
    const card = within(screen.getByRole("dialog", { name: "Scores" })).getByRole("region", { name: "Scorecard" });
    expect(card.textContent).toContain("Games: N–S 1, E–W 0 · N–S vulnerable");
    // A hand stored before breakdowns were kept is still explained by its points above and below the line.
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/N–S: \+120 below the line[\s\S]*N–S win game 1/);
  });

  it("adds a finished rubber hand to the scoresheet and keeps it after a reload", () => {
    const finished = completedGame();
    storeRubber({ hands: [], lastDealer: "north", activeHandId: "test-hand" }, finished);
    render(<App />);

    const result = within(screen.getByRole("region", { name: "Hand result" }));
    const breakdown = result.getByRole("region", { name: "Last hand's points" });
    expect(breakdown.textContent).toMatch(/Last hand: /);
    expect(breakdown.querySelectorAll("li").length).toBeGreaterThan(0);
    expect(loadSoloData(window.localStorage).rubber?.hands.map((hand) => hand.handId)).toEqual(["test-hand"]);
    expect(loadSoloData(window.localStorage).rubber?.hands[0]?.detail?.contract).toEqual(finished.contract);
  });

  it("closes the end-of-hand scorecard to see the cards, and Scores in the menu brings it back", async () => {
    const user = userEvent.setup();
    storeRubber({ hands: [], lastDealer: "north", activeHandId: "test-hand" }, completedGame());
    render(<App />);

    await user.click(within(screen.getByRole("region", { name: "Scorecard" })).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("region", { name: "Hand result" })).toBeNull();
    chooseMenu("Scores");
    expect(within(screen.getByRole("dialog", { name: "Scores" })).getByRole("region", { name: "Scorecard" })).toBeTruthy();
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
    const card = within(screen.getByRole("region", { name: "Hand result" })).getByRole("region", { name: "Scorecard" });
    expect(within(card).getByRole("status").textContent).toMatch(/E–W win the rubber 2–0[\s\S]*Final score N–S 0 · E–W 920 · E–W by 920 points/);
    expect(within(card).getByRole("region", { name: "Last hand's points" }).textContent).toMatch(/E–W: \+700 rubber bonus \(2–0 in games\)/);
    await user.click(within(card).getByRole("button", { name: "Play another rubber" }));

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
    setSetting("Opponents", "bots");
    setSetting("Your seat", "south");
    return user;
  }

  it("lets the human declarer play both their own hand and the bot dummy's hand", async () => {
    // South declares 1NT; West (bot) leads, then North is dummy.
    storeCurrentGame(gameWithContract(["pass", "pass", "1notrump", "pass", "pass", "pass"]));
    const user = await playAsSouthAgainstBots();

    await waitFor(() => expect(screen.getByText("Play from dummy")).toBeTruthy());
    const dummyButtons = within(screen.getByRole("region", { name: "North's dummy hand" })).getAllByRole("button", { name: /^Play / });
    const ledSuit = currentLedSuit();
    await user.click(dummyButtons.find((button) => button.getAttribute("aria-label")?.endsWith(`of ${ledSuit}`)) ?? dummyButtons[0]!);

    await waitFor(() => expect(screen.getByText("Your play")).toBeTruthy());
    expect(within(screen.getByRole("region", { name: "South's hand" })).getAllByRole("button", { name: /^Play / }).length).toBe(13);
  });

  it("lets the human play their own cards when the bot partner declares", async () => {
    // North (bot partner) declares 1NT, so South is dummy; East (bot) leads.
    storeCurrentGame(gameWithContract(["1notrump", "pass", "pass", "pass"]));
    await playAsSouthAgainstBots();

    await waitFor(() => expect(screen.getByText("Your play")).toBeTruthy());
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

    expect(screen.getByText("Play declarer's hand")).toBeTruthy();
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
    setSetting("Scoring", "single");
    setSetting("Opponents", "bots");
    setSetting("Your seat", "south");
    fireEvent.click(screen.getByRole("button", { name: "Start a new hand" }));
    fireEvent.click(menuToggle());
    setSetting("Dealer", "west");
    fireEvent.click(screen.getByRole("button", { name: "Deal a new hand" }));

    await act(async () => { await vi.runAllTimersAsync(); });
    const saved = JSON.parse(window.localStorage.getItem("contractplay.solo")!);
    expect(saved.currentGame.dealer).toBe("west");
    expect(saved.currentGame.auction[0].seat).toBe("west");
  });

  describe("queueing the next card", () => {
    /**
     * West declares 1NT and North (a bot) has led, so East (dummy, a bot) plays next and South third.
     * The deal is chosen so South can follow the led suit and also holds another suit.
     */
    function southThirdToPlay(): GameState {
      for (;;) {
        let game = gameWithContract(["pass", "pass", "pass", "1notrump", "pass", "pass", "pass"]);
        const lead = game.hands.north[0]!;
        const result = applyAction(game, { type: "play", seat: "north", card: lead });
        if (!result.ok) throw new Error(result.error.message);
        game = result.state;
        const south = game.hands.south;
        if (south.some((card) => card.suit === lead.suit) && south.some((card) => card.suit !== lead.suit)) return game;
      }
    }

    const cardText = (card: { rank: string; suit: string }) => playButtonLabel(card).replace(/^Play /, "");
    const southPlays = () => loadSoloData(window.localStorage).currentGame!.history.actions.filter((action) => action.type === "play" && action.seat === "south");

    /** Stores the position with forced cards left to the player, so only the queue can play South's card. */
    function renderAsSouthAgainstBots(game: GameState) {
      window.localStorage.setItem("contractplay.forcedPlay", "off");
      storeCurrentGame(game);
      render(<App />);
      expect(screen.queryAllByRole("button", { name: /^Queue / })).toHaveLength(0);
      fireEvent.click(menuToggle());
      setSetting("Opponents", "bots");
      setSetting("Your seat", "south");
    }

    /** Lets the bot to act decide, a timer tick at a time, until South is to play. */
    async function untilSouthToPlay() {
      for (let tick = 0; tick < 20 && loadSoloData(window.localStorage).currentGame!.currentActor !== "south"; tick += 1) {
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      }
      expect(loadSoloData(window.localStorage).currentGame!.currentActor).toBe("south");
    }

    it("queues a card on a bot's turn, plays it on the user's turn, and un-queues it on a second click", async () => {
      vi.useFakeTimers();
      const game = southThirdToPlay();
      const ledSuit = game.currentTrick[0]!.card.suit;
      const card = game.hands.south.find((candidate) => candidate.suit === ledSuit)!;
      renderAsSouthAgainstBots(game);

      fireEvent.click(screen.getByRole("button", { name: `Queue ${cardText(card)}` }));
      expect(screen.getByText(`Queued: ${cardText(card)}`)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: `Unqueue ${cardText(card)}` }));
      expect(screen.queryByText(/^Queued:/)).toBeNull();
      expect(screen.queryAllByRole("button", { name: /^Unqueue / })).toHaveLength(0);
      fireEvent.click(screen.getByRole("button", { name: `Queue ${cardText(card)}` }));

      await untilSouthToPlay();
      expect(southPlays()).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(499); });
      expect(southPlays()).toHaveLength(0);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(southPlays()).toEqual([{ type: "play", seat: "south", card }]);
    });

    it("drops a queued card that is illegal on the user's turn and leaves the user's cards to play", async () => {
      vi.useFakeTimers();
      const game = southThirdToPlay();
      const ledSuit = game.currentTrick[0]!.card.suit;
      const offSuit = game.hands.south.find((candidate) => candidate.suit !== ledSuit)!;
      renderAsSouthAgainstBots(game);

      fireEvent.click(screen.getByRole("button", { name: `Queue ${cardText(offSuit)}` }));
      await untilSouthToPlay();
      await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
      expect(southPlays()).toHaveLength(0);
      expect(screen.queryByText(/^Queued:/)).toBeNull();
      const playable = screen.getAllByRole("button", { name: /^Play / }) as HTMLButtonElement[];
      expect(playable.length).toBeGreaterThan(0);
      expect(playable.every((button) => !button.disabled)).toBe(true);
    });

    it("clears the queue on a take-back", () => {
      vi.useFakeTimers();
      const game = southThirdToPlay();
      renderAsSouthAgainstBots(game);
      fireEvent.click(screen.getByRole("button", { name: `Queue ${cardText(game.hands.south[0]!)}` }));
      expect(screen.getAllByRole("button", { name: /^Unqueue / })).toHaveLength(1);

      fireEvent.click(screen.getByRole("button", { name: /Take back/ }));
      expect(screen.queryAllByRole("button", { name: /^Unqueue / })).toHaveLength(0);
      expect(screen.queryByText(/^Queued:/)).toBeNull();
    });
  });

  describe("claiming", () => {
    const suitHand = (suit: "spades" | "hearts" | "diamonds" | "clubs") => RANKS.map((rank) => ({ suit, rank }));
    /** South holds every spade, North every heart, East every diamond, West every club. South declares; West has led the club ace, so North (dummy) is to play. */
    function southDeclaresAfterLead(bid: "1spades" | "1notrump"): GameState {
      let game = createGameState({ deal: { north: suitHand("hearts"), east: suitHand("diamonds"), south: suitHand("spades"), west: suitHand("clubs") }, dealer: "south", vulnerability: "None" });
      const actions = [...[bid, "pass", "pass", "pass"].map((call) => ({ type: "bid" as const, seat: game.currentActor, bid: call as never })), { type: "play" as const, seat: "west" as const, card: { suit: "clubs" as const, rank: "A" as const } }];
      for (const action of actions) {
        const result = applyAction(game, { ...action, seat: game.currentActor });
        if (!result.ok) throw new Error(result.error.message);
        game = result.state;
      }
      return game;
    }
    const claimItem = () => screen.queryByRole("button", { name: "Claim", hidden: true });

    function renderAsSouthAgainstBots(game: GameState) {
      storeCurrentGame(game);
      render(<App />);
      fireEvent.click(menuToggle());
      setSetting("Opponents", "bots");
      setSetting("Your seat", "south");
    }

    it("accepts a claim the robots prove and shows it in the result", async () => {
      renderAsSouthAgainstBots(southDeclaresAfterLead("1spades"));
      fireEvent.click(claimItem()!);
      fireEvent.click(screen.getByRole("button", { name: "Claim all 13" }));

      expect(screen.getByText(/Checking…/)).toBeTruthy();
      expect(claimItem()).toBeNull();
      await waitFor(() => expect(screen.getByRole("region", { name: "Hand result" })).toBeTruthy(), { timeout: 3000 });
      expect(within(screen.getByRole("region", { name: "Hand result" })).getByText("Claimed by South (declarer): 13 of the remaining 13 tricks")).toBeTruthy();
      expect(loadSoloData(window.localStorage).currentGame!.claim).toEqual({ seat: "south", tricks: 13 });
    });

    it("names the robot that rejects a claim it cannot prove and lets the user play on", async () => {
      renderAsSouthAgainstBots(southDeclaresAfterLead("1notrump"));
      fireEvent.click(claimItem()!);
      fireEvent.click(screen.getByRole("button", { name: "Claim all 13" }));

      await waitFor(() => expect(screen.getByText("East rejected the claim of 13 tricks")).toBeTruthy(), { timeout: 3000 });
      expect(screen.queryByText(/Checking…/)).toBeNull();
      expect(loadSoloData(window.localStorage).currentGame!.phase).toBe("play");
      expect(screen.getByText("Play from dummy")).toBeTruthy();
      const playable = within(screen.getByRole("region", { name: "North's dummy hand" })).getAllByRole("button", { name: /^Play / }) as HTMLButtonElement[];
      expect(playable.every((button) => !button.disabled)).toBe(true);
    });

    it("applies a claim at once at a manual table, for the number of tricks chosen", () => {
      storeCurrentGame(southDeclaresAfterLead("1spades"));
      render(<App />);
      fireEvent.click(menuToggle());
      fireEvent.click(claimItem()!);
      fireEvent.click(screen.getByRole("button", { name: "Fewer tricks" }));
      fireEvent.click(screen.getByRole("button", { name: "Fewer tricks" }));
      expect(screen.getByLabelText("Tricks to claim").textContent).toBe("11");
      fireEvent.click(screen.getByRole("button", { name: "Claim" }));

      expect(within(screen.getByRole("region", { name: "Hand result" })).getByText("Claimed by South (declarer): 11 of the remaining 13 tricks")).toBeTruthy();
    });

    it("closes the picker on Cancel", () => {
      storeCurrentGame(southDeclaresAfterLead("1spades"));
      render(<App />);
      fireEvent.click(menuToggle());
      fireEvent.click(claimItem()!);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(screen.queryByRole("button", { name: "Claim all 13" })).toBeNull();
      expect(loadSoloData(window.localStorage).currentGame!.phase).toBe("play");
    });

    it("offers no claim on a bot's turn, while bots finish, or in review", () => {
      const game = southDeclaresAfterLead("1spades");
      // West (a bot) is on lead before the club ace.
      renderAsSouthAgainstBots(undoAction(game));
      expect(claimItem()).toBeNull();
      cleanup();

      storeCurrentGame(game);
      render(<App />);
      fireEvent.click(menuToggle());
      expect(claimItem()).toBeTruthy();
      fireEvent.click(menuItem("Auto play this hand")!);
      expect(claimItem()).toBeNull();
      cleanup();

      const hand: SavedHand = { id: "finished", game: completedGame(), savedAt: new Date().toISOString() };
      storeCurrentGame(game, [hand]);
      render(<App />);
      chooseMenu("Recent hands");
      fireEvent.click(screen.getByRole("button", { name: /^Review / }));
      expect(screen.getByRole("region", { name: "Hand review" })).toBeTruthy();
      expect(claimItem()).toBeNull();
    });
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

  it("imports a PBN board set, plays it board by board, and keeps its place across a reload", async () => {
    const user = userEvent.setup();
    const table = `[ScoreTable "PairId_NS\\2R;PairId_EW\\2R;Names_NS;Contract\\4L;Declarer\\1R;Result\\2R;Score_NS\\6R;Score_EW\\6R"]
 1  5 "Smith - Jones" 4S   N 10    420      -
 2  6 "Lee - Patel"   4S   N  9      -     50
`;
    const pbn = `${exportPbn({ dealer: "east", vulnerability: "None", actions: [], deal: deal() })}\n${table}\n${exportPbn({ dealer: "south", vulnerability: "EW", actions: [], deal: deal() })}`;
    const firstRender = render(<App />);
    await user.click(screen.getByText("Import a PBN deal"));
    fireEvent.change(screen.getByLabelText("PBN deal"), { target: { value: pbn } });
    await user.click(screen.getByRole("button", { name: "Import hand" }));

    expect(screen.getByText("East to bid")).toBeTruthy();
    expect(menuItem("Next board")).toBeTruthy();
    expect(menuItem("Deal a new hand")).toBeNull();
    expect(menuItem("Leave the board set")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).boardSet.position).toBe(0));

    fireEvent.click(menuItem("Next board")!);
    expect(screen.getByText("South to bid")).toBeTruthy();
    expect(menuItem("Finish board set")).toBeTruthy();
    expect(menuItem("Next board")).toBeNull();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).boardSet.position).toBe(1));

    firstRender.unmount();
    render(<App />);
    expect(screen.getByText("South to bid")).toBeTruthy();
    expect(menuItem("Finish board set")).toBeTruthy();

    fireEvent.click(menuItem("Leave the board set")!);
    expect(menuItem("Deal a new hand")).toBeTruthy();
    expect(screen.getByText("South to bid")).toBeTruthy();
    await waitFor(() => expect(JSON.parse(window.localStorage.getItem("contractplay.solo")!).boardSet).toBeUndefined());
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

    chooseMenu("Recent hands");
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

  it("takes back the most recent action from the game menu", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Start a new hand" }));
    expect(menuItem("Take back")!.disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: bidButtonLabel("1clubs") }));
    chooseMenu("Take back");
    expect(screen.getByText("North to bid")).toBeTruthy();
    expect(screen.queryByText("North1 clubs")).toBeNull();
    expect(menuItem("Take back")!.disabled).toBe(true);
  });

  it("opens and reviews recent hands from the start screen when no hand is in progress", async () => {
    const user = userEvent.setup();
    saveSoloData(window.localStorage, {
      version: 1, currentHandId: null, currentGame: null,
      completedHands: [{ id: "online-ABC234-1", name: "Online hand", game: completedGame(), savedAt: "2026-10-25T12:00:00.000Z" }]
    });
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Recent hands" }));
    const dialog = screen.getByRole("dialog", { name: "Recent hands" });
    await user.click(within(dialog).getByRole("button", { name: /^Review Online hand/ }));
    expect(screen.getByText("Reviewing action 0 of 56")).toBeTruthy();
  });

  it("shows no Recent hands button on the start screen before any hand is saved", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Start a new hand" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Recent hands" })).toBeNull();
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

    chooseMenu("Recent hands");
    await user.click(screen.getByRole("button", { name: /^Review / }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("Reviewing action 0 of 56")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Next action" }));
    expect(screen.getByText("Reviewing action 1 of 56")).toBeTruthy();
    chooseMenu("Exit review");

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
