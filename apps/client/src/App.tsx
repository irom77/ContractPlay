import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  cardId,
  createGameState,
  deal,
  redoAction,
  requestHint,
  SUITS,
  trickWinner,
  undoAction,
  type Bid,
  type Card,
  type GameState,
  type Seat,
  type SkillLevel,
  type Solver,
  type Suit,
  type TrickCard,
  type Vulnerability
} from "@contractplay/core";
import { exportPbn, parsePbn } from "@contractplay/pbn";
import { deleteSavedHand, loadSoloData, saveSoloData, type PbnMetadata, type SavedHand, type SoloData } from "@contractplay/persistence";
import { createBot } from "@contractplay/bots";
import { createClientPersistenceAdapter } from "./platformPersistence.js";
import { isNativeClient, openPbnFile, savePbnFile } from "./nativeFiles.js";
import { isFullscreen, setFullscreen } from "./nativeWindow.js";

const seatNames: Record<Seat, string> = { north: "North", east: "East", south: "South", west: "West" };
const biddingStrains = ["clubs", "diamonds", "hearts", "spades", "notrump"] as const;
const suitSymbols: Record<Suit, string> = { spades: "♠", hearts: "♥", diamonds: "♦", clubs: "♣" };
const suitNames: Record<Suit, string> = { spades: "spades", hearts: "hearts", diamonds: "diamonds", clubs: "clubs" };
const ranks: Record<string, string> = { A: "ace", K: "king", Q: "queen", J: "jack", T: "ten" };
/** Pip centres as [x, y] percentages of the pip area; the lower half is drawn upside down like a printed card. */
const cardPipLayouts: Record<number, readonly (readonly [number, number])[]> = {
  2: [[50, 0], [50, 100]],
  3: [[50, 0], [50, 50], [50, 100]],
  4: [[0, 0], [100, 0], [0, 100], [100, 100]],
  5: [[0, 0], [100, 0], [50, 50], [0, 100], [100, 100]],
  6: [[0, 0], [100, 0], [0, 50], [100, 50], [0, 100], [100, 100]],
  7: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [0, 100], [100, 100]],
  8: [[0, 0], [100, 0], [50, 25], [0, 50], [100, 50], [50, 75], [0, 100], [100, 100]],
  9: [[0, 0], [100, 0], [0, 33], [100, 33], [50, 50], [0, 67], [100, 67], [0, 100], [100, 100]],
  10: [[0, 0], [100, 0], [50, 17], [0, 33], [100, 33], [0, 67], [100, 67], [50, 83], [0, 100], [100, 100]]
};
const seats: readonly Seat[] = ["north", "east", "south", "west"];
const vulnerabilities: readonly Vulnerability[] = ["None", "NS", "EW", "Both"];
const tablePositions = ["bottom", "left", "top", "right"] as const;
const isRedSuit = (suit: string): boolean => suit === "hearts" || suit === "diamonds";
const partnerOf = (seat: Seat): Seat => seats[(seats.indexOf(seat) + 2) % 4]!;
const samePartnership = (a: Seat, b: Seat): boolean => seats.indexOf(a) % 2 === seats.indexOf(b) % 2;
const contractRank = (bid: Bid): number => {
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? Number(match[1]) * 5 + biddingStrains.indexOf(match[2] as typeof biddingStrains[number]) : 0;
};

function isCallAvailable(game: GameState, bid: Bid): boolean {
  if (bid === "pass") return true;
  const previousContract = [...game.auction].reverse().find(({ bid: call }) => call !== "pass" && call !== "double" && call !== "redouble");
  const callsSinceContract = previousContract ? game.auction.slice(game.auction.indexOf(previousContract) + 1) : [];
  const lastNonPass = [...callsSinceContract].reverse().find(({ bid: call }) => call !== "pass");
  if (bid === "double") return !!previousContract && !["double", "redouble"].includes(lastNonPass?.bid ?? "") && !samePartnership(previousContract.seat, game.currentActor);
  if (bid === "redouble") return !!previousContract && lastNonPass?.bid === "double" && samePartnership(previousContract.seat, game.currentActor);
  return !previousContract || contractRank(bid) > contractRank(previousContract.bid);
}

function callLabel(bid: Bid): string {
  if (bid === "pass") return "Pass";
  if (bid === "double") return "Double";
  if (bid === "redouble") return "Redouble";
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  return match ? `${match[1]} ${match[2]}` : bid;
}

function compactCallLabel(bid: Bid): string {
  if (bid === "double") return "X";
  if (bid === "redouble") return "XX";
  const match = /^(\d)(clubs|diamonds|hearts|spades|notrump)$/.exec(bid);
  if (!match) return callLabel(bid);
  const strain = match[2] as typeof biddingStrains[number];
  return `${match[1]}${strain === "notrump" ? "NT" : suitSymbols[strain]}`;
}

function cardLabel(card: Card): string {
  return `${ranks[card.rank] ?? card.rank} of ${suitNames[card.suit]}`;
}

function cardFace(card: Card) {
  const suit = suitSymbols[card.suit];
  const rank = card.rank === "T" ? "10" : card.rank;
  const pips = cardPipLayouts[card.rank === "T" ? 10 : Number(card.rank)];
  const corner = (side: "top" | "bottom") => <span className={`card-corner card-corner-${side}`} aria-hidden="true"><span className={rank === "10" ? "card-rank-ten" : undefined}>{rank}</span><span>{suit}</span></span>;
  return <>
    {corner("top")}
    {pips ? <span className="card-pips" aria-hidden="true">{pips.map(([x, y], index) => <span className={`card-pip ${y > 50 ? "card-pip-flipped" : ""}`} style={{ left: `${x}%`, top: `${y}%` }} key={index}>{suit}</span>)}</span>
      : card.rank === "A" ? <span className="card-center-suit" aria-hidden="true">{suit}</span>
        : <span className="card-portrait" aria-hidden="true"><span>{card.rank}</span><span>{suit}</span></span>}
    {corner("bottom")}
  </>;
}

function callChipClass(bid: Bid): string {
  if (bid === "pass" || bid === "double" || bid === "redouble") return `call-${bid}`;
  return isRedSuit(bid.slice(1)) ? "auction-call-red" : "";
}

function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit) || "23456789TJQKA".indexOf(b.rank) - "23456789TJQKA".indexOf(a.rank));
}

function createHandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function reviewState(hand: SavedHand, cursor: number): GameState {
  let state = hand.game;
  while (state.history.cursor > cursor) state = undoAction(state);
  while (state.history.cursor < cursor) state = redoAction(state);
  return state;
}

export default function App({ solver }: { solver?: Solver } = {}) {
  const persistence = useMemo(() => createClientPersistenceAdapter(window.localStorage), []);
  const [soloData, setSoloData] = useState<SoloData>(() => loadSoloData(persistence.storage));
  const latestSoloData = useRef(soloData);
  latestSoloData.current = soloData;
  const pbnFileInput = useRef<HTMLInputElement>(null);
  const [game, setGame] = useState<GameState | undefined>(() => soloData.currentGame ?? undefined);
  const gameRef = useRef(game);
  gameRef.current = game;
  const [currentHandId, setCurrentHandId] = useState(() => soloData.currentHandId ?? (soloData.currentGame ? createHandId() : ""));
  const [dealer, setDealer] = useState<Seat>(() => soloData.currentGame?.dealer ?? "north");
  const [vulnerability, setVulnerability] = useState<Vulnerability>(() => soloData.currentGame?.vulnerability ?? "None");
  const [playAgainstBots, setPlayAgainstBots] = useState(false);
  const [userSeat, setUserSeat] = useState<Seat>("north");
  const [botSkill, setBotSkill] = useState<SkillLevel>("beginner");
  const [biddingStyle, setBiddingStyle] = useState<"SAYC" | "2/1">("SAYC");
  const [auctionShown, setAuctionShown] = useState(false);
  const [fullscreen, setFullscreenState] = useState(false);
  const [pbnInput, setPbnInput] = useState("");
  const [currentPbnMetadata, setCurrentPbnMetadata] = useState<PbnMetadata | undefined>(() => soloData.currentPbnMetadata);
  const [message, setMessage] = useState("");
  const [hint, setHint] = useState<{ game: GameState; seat: Seat; cardIds: ReadonlySet<string>; usesSolver: boolean }>();
  const [temporaryTrick, setTemporaryTrick] = useState<{ handId: string; cards: readonly TrickCard[] }>();
  const [lastTrickOpen, setLastTrickOpen] = useState(false);
  const [reviewHandId, setReviewHandId] = useState<string>();
  const [reviewCursor, setReviewCursor] = useState(0);
  const auctionListRef = useRef<HTMLOListElement>(null);
  const trickTimerRef = useRef<number | undefined>(undefined);
  const previousTrickState = useRef({
    handId: currentHandId,
    cursor: game?.history.cursor ?? 0,
    completedCount: game?.completedTricks.length ?? 0
  });

  useEffect(() => {
    const previous = previousTrickState.current;
    const next = {
      handId: currentHandId,
      cursor: game?.history.cursor ?? 0,
      completedCount: game?.completedTricks.length ?? 0
    };
    const newHand = previous.handId !== next.handId;
    const undone = !newHand && next.cursor < previous.cursor;

    if (newHand || !game || undone) {
      if (trickTimerRef.current !== undefined) window.clearTimeout(trickTimerRef.current);
      trickTimerRef.current = undefined;
      setTemporaryTrick(undefined);
      setLastTrickOpen(false);
    } else if (next.completedCount > previous.completedCount) {
      if (trickTimerRef.current !== undefined) window.clearTimeout(trickTimerRef.current);
      const completed = game.completedTricks.at(-1);
      if (completed) {
        setTemporaryTrick({ handId: currentHandId, cards: completed });
        setLastTrickOpen(false);
        trickTimerRef.current = window.setTimeout(() => {
          setTemporaryTrick(undefined);
          trickTimerRef.current = undefined;
        }, 2000);
      }
    } else if (game.currentTrick.length > 0) {
      setLastTrickOpen(false);
    }

    previousTrickState.current = next;
  }, [game, currentHandId]);

  useEffect(() => () => {
    if (trickTimerRef.current !== undefined) window.clearTimeout(trickTimerRef.current);
  }, []);

  useEffect(() => {
    setLastTrickOpen(false);
  }, [reviewHandId]);

  useEffect(() => persistence.onSuspend(() => saveSoloData(persistence.storage, latestSoloData.current)), [persistence]);

  useEffect(() => {
    if (!game || !currentHandId) return;
    let completedHands = soloData.completedHands;
    if (game.phase === "complete") {
      const record: SavedHand = {
        id: currentHandId,
        game,
        savedAt: new Date().toISOString(),
        ...(currentPbnMetadata ? { pbnMetadata: currentPbnMetadata } : {})
      };
      completedHands = [record, ...completedHands.filter((hand) => hand.id !== currentHandId)].slice(0, 25);
    }
    const nextData: SoloData = {
      version: 1,
      currentHandId,
      currentGame: game,
      ...(currentPbnMetadata ? { currentPbnMetadata } : {}),
      completedHands
    };
    latestSoloData.current = nextData;
    saveSoloData(persistence.storage, nextData);
    setSoloData(nextData);
  }, [game, currentHandId, currentPbnMetadata]);

  useEffect(() => {
    const dummyIsHumanControlled = !!game?.contract && game.phase === "play" &&
      (game.completedTricks.length > 0 || game.currentTrick.length > 0) &&
      samePartnership(userSeat, game.contract.declarer) && game.currentActor === partnerOf(game.contract.declarer);
    if (!game || !playAgainstBots || temporaryTrick || game.phase === "complete" || game.phase === "passed-out" || game.currentActor === userSeat || dummyIsHumanControlled) return;
    let cancelled = false;
    const turnState = game;
    const bot = createBot({ skill: botSkill, biddingStyle });
    const decide = async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (cancelled) return;
      const actorSeat = turnState.currentActor;
      const action = turnState.phase === "auction"
        ? { type: "bid" as const, seat: actorSeat, bid: await bot.chooseBid(turnState.hands[actorSeat], turnState.auction, actorSeat) }
        : { type: "play" as const, seat: actorSeat, card: await bot.chooseCard({
            seat: actorSeat,
            hand: turnState.hands[actorSeat],
            currentTrick: turnState.currentTrick,
            ...(turnState.currentTrick[0] ? { ledSuit: turnState.currentTrick[0].card.suit } : {}),
            ...(turnState.contract && turnState.contract.strain !== "notrump" ? { trump: turnState.contract.strain } : {})
          }) };
      if (cancelled) return;
      const result = applyAction(turnState, action);
      if (result.ok) setGame((current) => current === turnState ? result.state : current);
    };
    void decide();
    return () => { cancelled = true; };
  }, [game, playAgainstBots, temporaryTrick, userSeat, biddingStyle, botSkill]);

  const actor = game?.currentActor;
  const selectedHand = reviewHandId ? soloData.completedHands.find((hand) => hand.id === reviewHandId) : undefined;
  const shownGame = selectedHand ? reviewState(selectedHand, reviewCursor) : game;
  const isReviewing = !!selectedHand;
  const shownActor = shownGame?.currentActor;
  const dummySeat = shownGame?.contract ? partnerOf(shownGame.contract.declarer) : undefined;
  const userControlsDummy = !!shownGame?.contract &&
    (shownGame.completedTricks.length > 0 || shownGame.currentTrick.length > 0) &&
    samePartnership(userSeat, shownGame.contract.declarer) && shownActor === dummySeat;
  const canShowHand = !isReviewing && !!game && !!actor &&
    (game.phase === "auction" || game.phase === "play") &&
    (!playAgainstBots || actor === userSeat || userControlsDummy);
  const visibleHint = game && hint?.game === game && hint.seat === game.currentActor ? hint : undefined;
  const phaseLabel = shownGame?.phase === "complete" ? "Hand complete" : "Passed out";
  const dummyVisible = !!shownGame?.contract && (shownGame.currentTrick.length > 0 || shownGame.completedTricks.length > 0 || shownGame.phase === "complete");
  const completedNsTricks = shownGame?.contract
    ? shownGame.completedTricks.filter((trick) => samePartnership(
        trickWinner(trick, shownGame.contract!.strain === "notrump" ? undefined : shownGame.contract!.strain),
        "north"
      )).length
    : 0;
  const completedEwTricks = (shownGame?.completedTricks.length ?? 0) - completedNsTricks;
  const displayedTrick = !isReviewing && temporaryTrick?.handId === currentHandId
    ? temporaryTrick.cards
    : shownGame?.currentTrick.length
      ? shownGame.currentTrick
      : lastTrickOpen ? shownGame?.completedTricks.at(-1) ?? [] : [];

  function startHand() {
    const id = createHandId();
    setCurrentHandId(id);
    setGame(createGameState({ deal: deal(), dealer, vulnerability }));
    setCurrentPbnMetadata(undefined);
    setAuctionShown(false);
    setReviewHandId(undefined);
    setMessage("");
  }

  function importHand(contents = pbnInput) {
    const board = parsePbn(contents).boards[0];
    const diagnostic = board?.diagnostics.find((entry) => entry.severity === "error");
    if (!board?.deal || !board.dealer || diagnostic) {
      setMessage(`Cannot import PBN: ${diagnostic?.message ?? "include a valid deal and dealer"}`);
      return;
    }
    let imported = createGameState({ deal: board.deal, dealer: board.dealer, vulnerability: board.vulnerability ?? "None" });
    for (const action of board.actions) {
      const result = applyAction(imported, action);
      if (!result.ok) {
        setMessage(`Cannot import PBN: ${result.error.message}`);
        return;
      }
      imported = result.state;
    }
    setCurrentHandId(createHandId());
    setGame(imported);
    setAuctionShown(false);
    setCurrentPbnMetadata({ tags: board.tags, comments: board.comments });
    setDealer(board.dealer);
    setVulnerability(board.vulnerability ?? "None");
    setReviewHandId(undefined);
    setPbnInput("");
    setMessage("");
  }

  async function choosePbnFile() {
    if (!isNativeClient()) {
      pbnFileInput.current?.click();
      return;
    }
    try {
      const contents = await openPbnFile();
      if (contents !== null) importHand(contents);
    } catch (error) {
      setMessage(`Cannot open PBN file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importSelectedPbnFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;
    try {
      importHand(await file.text());
    } catch (error) {
      setMessage(`Cannot open PBN file: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      input.value = "";
    }
  }

  function submitAction(action: Parameters<typeof applyAction>[1]) {
    if (!game || isReviewing) return;
    const result = applyAction(game, action);
    if (result.ok) {
      setGame(result.state);
      setMessage("");
    } else {
      setMessage(result.error.message);
    }
  }

  async function showHint() {
    if (!game || game.phase !== "play") return;
    const requestedGame = game;
    const seat = requestedGame.currentActor;
    try {
      const cards = await requestHint({
        seat,
        hand: requestedGame.hands[seat],
        currentTrick: requestedGame.currentTrick,
        ...(requestedGame.currentTrick[0] ? { ledSuit: requestedGame.currentTrick[0].card.suit } : {}),
        ...(requestedGame.contract && requestedGame.contract.strain !== "notrump" ? { trump: requestedGame.contract.strain } : {})
      }, solver);
      if (gameRef.current !== requestedGame) return;
      setHint({ game: requestedGame, seat, cardIds: new Set(cards.map(cardId)), usesSolver: !!solver });
      setMessage("");
    } catch {
      if (gameRef.current === requestedGame) setMessage("Unable to get a hint. Please try again.");
    }
  }

  function takeBack() {
    if (!game || game.history.cursor === 0) return;
    setGame(undoAction(game));
    setMessage("");
  }

  function redo() {
    if (!game || game.history.cursor >= game.history.actions.length) return;
    setGame(redoAction(game));
    setMessage("");
  }

  function openReview(hand: SavedHand) {
    setReviewHandId(hand.id);
    setReviewCursor(0);
    setLastTrickOpen(false);
    setMessage("");
  }

  function removeHand(id: string) {
    setSoloData(deleteSavedHand(persistence.storage, id));
  }

  async function downloadHand(id: string) {
    const hand = soloData.completedHands.find((candidate) => candidate.id === id);
    if (!hand) return;
    const contents = exportPbn({
      dealer: hand.game.dealer,
      vulnerability: hand.game.vulnerability,
      actions: hand.game.history.actions,
      deal: hand.game.initialDeal,
      ...hand.pbnMetadata
    });
    if (!contents) return;
    if (isNativeClient()) {
      try {
        await savePbnFile(`contractplay-${id}.pbn`, contents);
      } catch (error) {
        setMessage(`Cannot export PBN file: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    if (typeof URL.createObjectURL !== "function") return;
    const url = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `contractplay-${id}.pbn`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const handCount = selectedHand?.game.history.actions.length ?? 0;
  const shownAuctionLength = shownGame?.auction.length;

  useEffect(() => {
    const list = auctionListRef.current;
    if (shownGame?.phase === "auction" && list) list.scrollTop = list.scrollHeight;
  }, [shownGame?.phase, shownAuctionLength]);


  useEffect(() => {
    const sync = () => { void isFullscreen().then(setFullscreenState).catch(() => undefined); };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === "Escape" && isNativeClient()) {
        void setFullscreen(false).then(setFullscreenState).catch(() => undefined);
      }
    };
    sync();
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  async function toggleFullscreen() {
    try {
      setFullscreenState(await setFullscreen(!(await isFullscreen())));
    } catch {
      setMessage("Full screen is not available here.");
    }
  }

  const dealSettings = <>
    <label>Dealer<select aria-label="Dealer" value={dealer} onChange={(event) => setDealer(event.target.value as Seat)}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label>
    <label>Vulnerability<select aria-label="Vulnerability" value={vulnerability} onChange={(event) => setVulnerability(event.target.value as Vulnerability)}>{vulnerabilities.map((value) => <option key={value} value={value}>{value === "None" ? "None" : value === "Both" ? "Both" : `${value} vulnerable`}</option>)}</select></label>
    <label>Opponents<select aria-label="Opponents" value={playAgainstBots ? "bots" : "manual"} onChange={(event) => setPlayAgainstBots(event.target.value === "bots")}><option value="manual">Manual table</option><option value="bots">Bots</option></select></label>
    {playAgainstBots ? <><label>Your seat<select aria-label="Your seat" value={userSeat} onChange={(event) => setUserSeat(event.target.value as Seat)}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label><label>Bot skill<select aria-label="Bot skill" value={botSkill} onChange={(event) => setBotSkill(event.target.value as SkillLevel)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select></label><label>Bot bidding style<select aria-label="Bot bidding style" value={biddingStyle} onChange={(event) => setBiddingStyle(event.target.value as "SAYC" | "2/1")}><option value="SAYC">Basic SAYC</option><option value="2/1">Basic 2/1</option></select></label></> : null}
  </>;
  const pbnImportForm = <details className="pbn-import">
    <summary>Import a PBN deal</summary>
    <form onSubmit={(event) => { event.preventDefault(); importHand(); }}>
      <label htmlFor="pbn-input">PBN deal</label>
      <input ref={pbnFileInput} aria-label="PBN file" type="file" accept=".pbn,.txt,text/plain" onChange={(event) => { void importSelectedPbnFile(event); }} hidden />
      <button className="secondary-button" type="button" onClick={() => { void choosePbnFile(); }}>Choose PBN file</button>
      <textarea id="pbn-input" value={pbnInput} onChange={(event) => setPbnInput(event.target.value)} placeholder={'[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:..."]'} />
      <button className="secondary-button" type="submit">Import hand</button>
    </form>
  </details>;
  const recentHandsPanel = <section className="recent-panel" aria-label="Recent hands">
    <div className="section-heading"><h2>Recent hands</h2><span className="auction-count">{soloData.completedHands.length}</span></div>
    {soloData.completedHands.length ? <ul className="recent-list">{soloData.completedHands.map((hand, index) => <li key={hand.id}>
      <button className="review-link" aria-label={`Review hand ${index + 1}`} onClick={() => openReview(hand)}><strong>Hand {soloData.completedHands.length - index}</strong><span>{new Date(hand.savedAt).toLocaleDateString()}</span></button>
      <div className="recent-actions"><button onClick={() => downloadHand(hand.id)} aria-label={`Export PBN hand ${index + 1}`}>Export PBN</button><button onClick={() => removeHand(hand.id)} aria-label={`Delete hand ${index + 1}`}>Delete</button></div>
    </li>)}</ul> : <p className="quiet-copy">Finished hands will be saved here for review.</p>}
  </section>;
  const fullscreenButton = <button className="icon-button" type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen} title={`${fullscreen ? "Exit full screen" : "Full screen"} (F)`} onClick={() => { void toggleFullscreen(); }}>
    <svg viewBox="0 0 24 24" aria-hidden="true">{fullscreen
      ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
  </button>;
  const version = <span className="header-version">Version {__CONTRACTPLAY_VERSION__}</span>;

  if (!shownGame) {
    return (
      <main className="app-shell">
        <section className="empty-table" aria-label="New deal">
          <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>ContractPlay</span><span className="table-tools-row">{version}{fullscreenButton}</span></div>
          <div className="setup-controls">{dealSettings}</div>
          <button className="primary-button" onClick={startHand}>Start a new hand</button>
          {pbnImportForm}
        </section>
        {message ? <p className="error-message" role="alert">{message}</p> : null}
      </main>
    );
  }

  const phase = shownGame.phase;
  const contract = shownGame.contract;
  const trump = contract && contract.strain !== "notrump" ? contract.strain : undefined;
  const liveTurn = phase === "auction" || phase === "play";
  // The seat drawn at the bottom edge: the user against bots, otherwise declarer (so dummy faces them) or South.
  const bottomSeat: Seat = playAgainstBots ? userSeat : contract ? contract.declarer : "south";
  const positionOf = (seat: Seat) => tablePositions[(seats.indexOf(seat) - seats.indexOf(bottomSeat) + 4) % 4]!;
  const canAct = canShowHand && !!game && !!actor;
  // Dummy laid out across the table is played from there, so the bottom edge keeps showing declarer's own cards.
  const playFromDummy = canAct && phase === "play" && dummyVisible && actor === dummySeat && positionOf(actor) !== "bottom";
  const handIsInteractive = canAct && !playFromDummy;
  const handSeat: Seat | undefined = handIsInteractive ? actor : playAgainstBots || isReviewing || playFromDummy ? bottomSeat : undefined;
  const handCards = handSeat ? sortHand(shownGame.hands[handSeat]) : [];
  const handIsDummy = dummyVisible && handSeat === dummySeat;
  const showCalls = phase !== "play" || auctionShown;
  const lastTrick = shownGame.completedTricks.at(-1);
  const lastTrickWinner = lastTrick ? trickWinner(lastTrick, trump) : undefined;
  const contractText = contract ? <>{contract.level}<span className={isRedSuit(contract.strain) ? "red-card" : ""}>{contract.strain === "notrump" ? "NT" : suitSymbols[contract.strain]}</span>{"X".repeat(contract.doubled)}</> : null;
  const statusText = isReviewing
    ? `Reviewing action ${reviewCursor} of ${handCount}`
    : liveTurn ? `${playAgainstBots && shownActor !== userSeat && !userControlsDummy ? "Bot · " : ""}${seatNames[shownActor!]} to ${phase === "auction" ? "bid" : "play"}` : phaseLabel;
  const auctionList = shownGame.auction.length ? <ol className="sr-only" ref={auctionListRef} aria-label="Auction calls">{shownGame.auction.map(({ seat, bid }, index) => <li key={`${seat}-${index}`}><span>{seatNames[seat]}</span><strong>{callLabel(bid)}</strong></li>)}</ol> : null;
  const tableCard = (card: Card, className: string, label: string) => <span className={`${className} ${isRedSuit(card.suit) ? "red-card" : ""}`} key={cardId(card)} role="img" aria-label={label}>{cardFace(card)}</span>;

  return (
    <main className={`app-shell ${fullscreen ? "is-fullscreen" : ""}`}>
      <div className={`game-layout ${phase === "auction" ? "auction-layout" : phase === "play" ? "play-layout" : ""}`}>
        <section className="table-panel" aria-label={isReviewing ? "Hand review" : "Bridge table"}>
          <div className={`table-surface ${phase === "play" && auctionShown ? "calls-shown" : ""}`}>
            <div className="table-status">
              {contract ? <button className="contract-badge" type="button" disabled={phase !== "play"} aria-expanded={showCalls} aria-label={`${showCalls ? "Hide" : "Show"} auction, ${shownGame.auction.length} calls. Contract ${callLabel(`${contract.level}${contract.strain}` as Bid)} by ${seatNames[contract.declarer]}`} title={phase === "play" ? `${showCalls ? "Hide" : "Show"} the bidding` : undefined} onClick={() => setAuctionShown((shown) => !shown)}>
                <strong>{contractText}</strong><span>{seatNames[contract.declarer][0]}</span>
              </button> : null}
              {contract ? <span className="trick-count" role="group" aria-label={`NS ${completedNsTricks} · EW ${completedEwTricks} tricks`} aria-live="polite">
                <span>NS<b>{completedNsTricks}</b></span><span>EW<b>{completedEwTricks}</b></span>
              </span> : null}
              <span className="status-pill" aria-live="polite">{statusText}</span>
            </div>

            <div className="table-tools">
              <div className="table-tools-row">
                <details className="table-menu">
                  <summary className="icon-button" aria-label="Table menu" title="Table menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg></summary>
                  <div className="table-menu-content">
                    {!isReviewing ? <button className="secondary-button menu-deal" onClick={startHand}>Deal a new hand</button> : <button className="secondary-button menu-deal" onClick={() => { setReviewHandId(undefined); setLastTrickOpen(false); }}>Exit review</button>}
                    {!isReviewing ? <section className="menu-settings" aria-label="Next deal settings">{dealSettings}</section> : null}
                    {pbnImportForm}
                    {recentHandsPanel}
                    {version}
                  </div>
                </details>
                {fullscreenButton}
              </div>
              {lastTrick ? <button className="last-trick-button" type="button" disabled={shownGame.currentTrick.length > 0} aria-pressed={lastTrickOpen} aria-label={lastTrickOpen ? "Hide last trick" : "Last trick"} title={shownGame.currentTrick.length > 0 ? "Last trick" : lastTrickOpen ? "Hide last trick" : "Show last trick on the table"} onClick={() => setLastTrickOpen((open) => !open)}>
                {lastTrick.map(({ seat, card }) => <span className={`table-card last-trick-card trick-pos-${positionOf(seat)} ${seat === lastTrickWinner ? "last-trick-winner" : ""} ${isRedSuit(card.suit) ? "red-card" : ""}`} key={seat} aria-hidden="true">{cardFace(card)}</span>)}
              </button> : null}
            </div>

            {seats.map((seat) => {
              const position = positionOf(seat);
              const hasPlayed = phase === "play" && shownGame.currentTrick.some((play) => play.seat === seat);
              const isActor = shownActor === seat && liveTurn;
              const seatCalls = showCalls ? shownGame.auction.filter((entry) => entry.seat === seat) : [];
              const vulnerable = shownGame.vulnerability === "Both" || (shownGame.vulnerability === "NS" && samePartnership(seat, "north")) || (shownGame.vulnerability === "EW" && samePartnership(seat, "east"));
              const isDealer = shownGame.dealer === seat;
              const dummyCards = dummyVisible && dummySeat === seat && position !== "bottom" ? sortHand(shownGame.hands[seat]) : [];
              return <div key={seat} className={`seat seat-${seat} pos-${position} ${isActor ? "active-seat" : ""} ${hasPlayed ? "played-seat" : ""} ${vulnerable ? "vulnerable-seat" : ""} ${isDealer ? "dealer-seat" : ""} ${dummyCards.length ? "has-dummy" : ""} ${dummyCards.length && playFromDummy ? "playable-dummy" : ""}`}>
                <span className="seat-compass" role="img" aria-label={`${seatNames[seat]}${isDealer ? ", dealer" : ""}${vulnerable ? ", vulnerable" : ""}`} title={`${seatNames[seat]}${isDealer ? " · dealer" : ""}${vulnerable ? " · vulnerable" : ""}`}>{seat[0]!.toUpperCase()}{isDealer && phase === "auction" ? <span className="dealer-mark" aria-hidden="true">D</span> : null}</span>
                {seatCalls.length ? <span className="seat-auction-calls" aria-label={`${seatNames[seat]} calls`}>{seatCalls.map(({ bid }, index) => <span className={`seat-auction-call ${callChipClass(bid)}`} key={`${seat}-${index}`}>{compactCallLabel(bid)}</span>)}</span> : null}
                {dummyCards.length ? <section className="dummy-table-hand" aria-label={`${seatNames[seat]}'s dummy hand`}>
                  {SUITS.map((suit) => {
                    const suitCards = dummyCards.filter((card) => card.suit === suit);
                    return suitCards.length ? <div className="dummy-suit-row" key={suit}>{suitCards.map((card) => playFromDummy
                      ? <button className={`table-card dummy-card ${isRedSuit(card.suit) ? "red-card" : ""} ${visibleHint?.cardIds.has(cardId(card)) ? "hinted-card" : ""}`} key={cardId(card)} aria-label={`Play ${cardLabel(card)}`} disabled={!!temporaryTrick} onClick={() => submitAction({ type: "play", seat, card })}>{cardFace(card)}</button>
                      : tableCard(card, "table-card dummy-card", cardLabel(card)))}</div> : null;
                  })}
                </section> : null}
              </div>;
            })}

            <div className="trick-area" role="region" aria-label="Current trick">
              {displayedTrick.map(({ seat, card }) => tableCard(card, `trick-card trick-card-position-${seat} trick-pos-${positionOf(seat)}`, `${seatNames[seat]} played ${cardLabel(card)}`))}
            </div>

            <section className={phase === "auction" ? "auction-panel centered-auction" : "sr-only"} aria-label="Auction">
              {auctionList}
              {!isReviewing && game?.phase === "auction" && (!playAgainstBots || game.currentActor === userSeat) ? <div className="bid-picker" aria-label="Choose a bid">
                <div className="bid-grid" role="group" aria-label="Contract bids by level and strain">
                  {[1, 2, 3, 4, 5, 6, 7].map((level) => biddingStrains.map((strain) => {
                    const bid = `${level}${strain}` as Bid;
                    return <button key={bid} type="button" className={`bid-cell ${isRedSuit(strain) ? "bid-red" : ""}`} aria-label={`${level} ${strain}`} disabled={!isCallAvailable(game, bid)} onClick={() => submitAction({ type: "bid", seat: game.currentActor, bid })}>{level}<span>{strain === "notrump" ? "NT" : suitSymbols[strain]}</span></button>;
                  }))}
                </div>
                <div className="bid-special-calls" role="group" aria-label="Pass, double, or redouble">
                  {(["double", "redouble", "pass"] as const).map((bid) => <button key={bid} type="button" className={`bid-special bid-special-${bid}`} disabled={!isCallAvailable(game, bid)} onClick={() => submitAction({ type: "bid", seat: game.currentActor, bid })}>{bid === "double" ? "X" : bid === "redouble" ? "XX" : "Pass"}</button>)}
                </div>
              </div> : null}
            </section>

            {phase === "complete" && shownGame.score && contract ? <section className={`score-panel ${displayedTrick.length ? "score-panel-hidden" : ""}`} aria-label="Hand result">
              <h2>{contractText} by {seatNames[contract.declarer]}</h2>
              <p>{shownGame.score.tricksTaken} tricks for {samePartnership(contract.declarer, "north") ? "NS" : "EW"} · {shownGame.score.score > 0 ? "+" : ""}{shownGame.score.score} NS</p>
              {!isReviewing ? <button className="primary-button" type="button" onClick={startHand}>Next deal</button> : null}
            </section> : null}
            {phase === "passed-out" ? <div className="score-panel"><h2>Passed out</h2>{!isReviewing ? <button className="primary-button" type="button" onClick={startHand}>Next deal</button> : null}</div> : null}

            {isReviewing ? <div className="history-controls review-controls" role="group" aria-label="Review controls">
              <button className="secondary-button" aria-label="Previous action" disabled={reviewCursor === 0} onClick={() => setReviewCursor((cursor) => Math.max(0, cursor - 1))}><span aria-hidden="true">‹</span> Previous</button>
              <button className="secondary-button" aria-label="Next action" disabled={reviewCursor >= handCount} onClick={() => setReviewCursor((cursor) => Math.min(handCount, cursor + 1))}>Next <span aria-hidden="true">›</span></button>
            </div> : <div className="history-controls">
              <button className="secondary-button" disabled={!game || game.history.cursor === 0} onClick={takeBack}><span aria-hidden="true">↶ </span>Take back</button>
              <button className="secondary-button" disabled={!!temporaryTrick || !game || game.history.cursor >= game.history.actions.length} onClick={redo}><span aria-hidden="true">↷ </span>Redo</button>
            </div>}

            {canAct && game.phase === "play" ? <div className="hint-controls">
              {visibleHint ? <p role="status">{visibleHint.usesSolver ? "Solver recommendations are highlighted." : "Legal cards are highlighted."}</p> : null}
              <button className="secondary-button" onClick={() => { void showHint(); }}>Show hint</button>
            </div> : null}

            {message ? <p className="error-message" role="alert">{message}</p> : null}
          </div>

          <div className="hand-zone">
            {handSeat && handCards.length ? <section className="hand-panel" aria-label={`${seatNames[handSeat]}'s ${handIsInteractive ? "hand" : "cards"}`}>
              <div className="cards-row">
                {handSeat !== bottomSeat || handIsDummy ? <span className="hand-tag"><span className="seat-compass" aria-hidden="true">{handSeat[0]!.toUpperCase()}</span>{handIsDummy ? <span>DUMMY</span> : <span className="sr-only">{seatNames[handSeat]}</span>}</span> : null}
                {handCards.map((card, index) => {
                  const className = `playing-card ${isRedSuit(card.suit) ? "red-card" : ""} ${index > 0 && handCards[index - 1]!.suit !== card.suit ? "suit-gap" : ""}`;
                  return handIsInteractive && game.phase === "play"
                    ? <button className={`${className} ${visibleHint?.cardIds.has(cardId(card)) ? "hinted-card" : ""}`} key={cardId(card)} aria-label={`Play ${cardLabel(card)}`} disabled={!!temporaryTrick} onClick={() => submitAction({ type: "play", seat: handSeat, card })}>{cardFace(card)}</button>
                    : tableCard(card, `${className} auction-card`, cardLabel(card));
                })}
              </div>
            </section> : null}
          </div>
        </section>
      </div>
    </main>
  );
}
