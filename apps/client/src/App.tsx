import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  cardId,
  claimSeatFor,
  createGameState,
  deal,
  emptyRubber,
  forcedCard,
  nextRubberDeal,
  recordRubberHand,
  redoAction,
  remainingTricks,
  summarizeRubber,
  playContextFor,
  requestHint,
  undoAction,
  type Bid,
  type GameState,
  type Rubber,
  type Seat,
  type SkillLevel,
  type Solver,
  type TrickCard,
  type Vulnerability
} from "@contractplay/core";
import { exportPbn, parsePbn } from "@contractplay/pbn";
import { deleteSavedHand, loadSoloData, saveSoloData, type PbnMetadata, type SavedHand, type SoloData, type StorageLike } from "@contractplay/persistence";
import { checkClaim, createBot, explainBid, highCardPoints, suggestBid, suggestPlay } from "@contractplay/bots";
import { createClientPersistenceAdapter } from "./platformPersistence.js";
import { isNativeClient, openPbnFile, savePbnFile } from "./nativeFiles.js";
import { isFullscreen, setFullscreen } from "./nativeWindow.js";
import { createHandName, savedHandName } from "./handNames.js";
import { cardLabel, claimRejectedText, claimText, compactCallLabel, pendingClaimText, contractText, isCallAvailable, partnerOf, samePartnership, seatNames, seats } from "./table/labels.js";
import { TableView } from "./table/TableView.js";
import { FORCED_PLAY_MS, forcedPlayEnabled, forcedPlayStorageKey } from "./table/forcedPlay.js";
import { queuedPlay, queueStillValid, type QueuedCard } from "./table/queuedCard.js";
import { ClaimPanel } from "./table/ClaimPanel.js";
import { DraggableBanner } from "./table/DraggableBanner.js";
import { GameMenu, type GameMenuItem } from "./table/GameMenu.js";
import { ContractOutcome } from "./table/ResultSummary.js";
import { compassSideNames, handsOnCard, Scorecard, weTheySideNames } from "./table/Scorecard.js";
import { serviceUrl } from "./online/connection.js";

const vulnerabilities: readonly Vulnerability[] = ["None", "NS", "EW", "Both"];
const hintsStorageKey = "contractplay.hints";
const scoringStorageKey = "contractplay.scoring";
/** How long the robots seem to think about a claim, so the player sees it being checked. */
const CLAIM_CHECK_MS = 800;
type ScoringFormat = "rubber" | "single";

function createHandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The robot that answers a claim for the other side: the first defender for a declaring-side claim, else declarer. */
function claimAnswerer(game: GameState, claimSeat: Seat): Seat {
  const declarer = game.contract!.declarer;
  return samePartnership(claimSeat, declarer) ? seats.find((seat) => !samePartnership(seat, declarer))! : declarer;
}

const playedOn = (hand: SavedHand): string => new Date(hand.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function reviewState(hand: SavedHand, cursor: number): GameState {
  let state = hand.game;
  while (state.history.cursor > cursor) state = undoAction(state);
  while (state.history.cursor < cursor) state = redoAction(state);
  return state;
}

/**
 * A fixed solo table for the UI previews (`#/mocks`): the hand and settings come from `storage`, and nothing moves on its
 * own, so no bot, forced, or queued card is ever played. Clicks still work, but only on this in-memory copy.
 */
export type SoloPreview = Readonly<{
  storage: StorageLike;
  /** Play against bots from this seat; without it the table is manual and the user plays all four hands. */
  userSeat?: Seat;
  /** The bots play the user's cards for the rest of the hand (Auto play). */
  autoPlay?: boolean;
  /** The claim picker is open. */
  claiming?: boolean;
  menuOpen?: boolean;
  /** One of the game menu's dialogs is open. */
  dialog?: MenuDialog;
  /** Review this saved hand at this action. */
  review?: Readonly<{ handId: string; cursor: number }>;
}>;

/** The game menu's larger entries open as dialogs over the table. */
export type MenuDialog = "settings" | "rubber" | "hands" | "about";
/** Shared with online play, so the Auto play banner stays where the player last put it. */
const autoPlayBannerKey = "contractplay.resumeBanner";

/** `initialDialog` opens a menu dialog on arrival, as when online play links to Recent hands. */
export default function App({ solver, preview, initialDialog }: { solver?: Solver; preview?: SoloPreview; initialDialog?: MenuDialog } = {}) {
  const frozen = !!preview;
  const persistence = useMemo(() => createClientPersistenceAdapter(preview?.storage ?? window.localStorage), [preview]);
  const [soloData, setSoloData] = useState<SoloData>(() => loadSoloData(persistence.storage));
  const latestSoloData = useRef(soloData);
  latestSoloData.current = soloData;
  const pbnFileInput = useRef<HTMLInputElement>(null);
  const [game, setGame] = useState<GameState | undefined>(() => soloData.currentGame ?? undefined);
  const [currentHandId, setCurrentHandId] = useState(() => soloData.currentHandId ?? (soloData.currentGame ? createHandId() : ""));
  const [dealer, setDealer] = useState<Seat>(() => soloData.currentGame?.dealer ?? "north");
  const [vulnerability, setVulnerability] = useState<Vulnerability>(() => soloData.currentGame?.vulnerability ?? "None");
  const [playAgainstBots, setPlayAgainstBots] = useState(preview?.userSeat !== undefined);
  const [userSeat, setUserSeat] = useState<Seat>(preview?.userSeat ?? "north");
  const [botSkill, setBotSkill] = useState<SkillLevel>("beginner");
  const [biddingStyle, setBiddingStyle] = useState<"SAYC" | "2/1">("SAYC");
  const [auctionShown, setAuctionShown] = useState(false);
  const [fullscreen, setFullscreenState] = useState(false);
  const [pbnInput, setPbnInput] = useState("");
  const [currentPbnMetadata, setCurrentPbnMetadata] = useState<PbnMetadata | undefined>(() => soloData.currentPbnMetadata);
  const [message, setMessage] = useState("");
  const [hintsOn, setHintsOn] = useState(() => {
    try { return persistence.storage.getItem(hintsStorageKey) === "on"; } catch { return false; }
  });
  const [forcedPlayOn, setForcedPlayOn] = useState(() => forcedPlayEnabled(persistence.storage));
  // The position a take-back returned to: a forced card there waits for the player instead of replaying at once.
  const [takenBackTo, setTakenBackTo] = useState<GameState>();
  const [scoring, setScoring] = useState<ScoringFormat>(() => {
    try { return persistence.storage.getItem(scoringStorageKey) === "single" ? "single" : "rubber"; } catch { return "rubber"; }
  });
  const [rubber, setRubber] = useState<Rubber>(() => soloData.rubber ?? emptyRubber());
  // The hand whose end-of-hand scorecard the user closed.
  const [closedScorecard, setClosedScorecard] = useState<string | null>(null);
  const [bidHint, setBidHint] = useState<{ game: GameState; bid: Bid; reason: string }>();
  const [playHint, setPlayHint] = useState<{ game: GameState; cardIds: ReadonlySet<string>; reason: string }>();
  const [explainedCall, setExplainedCall] = useState<{ key: string; index: number }>();
  const [temporaryTrick, setTemporaryTrick] = useState<{ handId: string; cards: readonly TrickCard[] }>();
  const [lastTrickOpen, setLastTrickOpen] = useState(false);
  const [reviewHandId, setReviewHandId] = useState<string | undefined>(preview?.review?.handId);
  const [reviewCursor, setReviewCursor] = useState(preview?.review?.cursor ?? 0);
  const [dialog, setDialog] = useState<MenuDialog | undefined>(preview?.dialog ?? initialDialog);
  // The hand the user has handed over: bots make every remaining call and play for it.
  const [botsFinishHandId, setBotsFinishHandId] = useState<string | undefined>(preview?.autoPlay ? currentHandId : undefined);
  // A card the user picked before their turn, played for them when it comes.
  const [queued, setQueued] = useState<QueuedCard>();
  // The position the claim picker was opened in; it closes when the position changes.
  const [claimPickedAt, setClaimPickedAt] = useState<GameState | undefined>(preview?.claiming ? game : undefined);
  // A claim against robots being checked, for the position it was made in.
  const [soloClaim, setSoloClaim] = useState<{ game: GameState; seat: Seat; tricks: number }>();
  const botsFinishing = !!currentHandId && botsFinishHandId === currentHandId;
  const botsFinishingRef = useRef(botsFinishing);
  botsFinishingRef.current = botsFinishing;
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
        }, botsFinishingRef.current ? 800 : 2000);
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
      const existing = completedHands.find((hand) => hand.id === currentHandId);
      const record: SavedHand = {
        id: currentHandId,
        // Named after the dealt cards of the player's seat against bots, otherwise South's.
        name: existing?.name ?? createHandName(game.initialDeal[playAgainstBots ? userSeat : "south"], new Set(completedHands.map(savedHandName))),
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
      completedHands,
      rubber
    };
    latestSoloData.current = nextData;
    saveSoloData(persistence.storage, nextData);
    setSoloData(nextData);
  }, [game, currentHandId, currentPbnMetadata, rubber]);

  // A rubber hand is scored when it ends, and loses its score again if it is taken back from the end.
  useEffect(() => {
    if (game && currentHandId) setRubber((current) => recordRubberHand(current, currentHandId, game));
  }, [game, currentHandId]);

  useEffect(() => {
    const declaringSideIsHumanControlled = !!game?.contract && game.phase === "play" &&
      (game.completedTricks.length > 0 || game.currentTrick.length > 0) &&
      samePartnership(userSeat, game.contract.declarer) &&
      samePartnership(game.currentActor, game.contract.declarer);
    if (frozen || !game || temporaryTrick || game.phase === "complete" || game.phase === "passed-out") return;
    if (!botsFinishing && (!playAgainstBots || game.currentActor === userSeat || declaringSideIsHumanControlled)) return;
    let cancelled = false;
    const turnState = game;
    const bot = createBot({ skill: botSkill, biddingStyle });
    const decide = async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (cancelled) return;
      const actorSeat = turnState.currentActor;
      const action = turnState.phase === "auction"
        ? { type: "bid" as const, seat: actorSeat, bid: await bot.chooseBid(turnState.hands[actorSeat], turnState.auction, actorSeat) }
        : { type: "play" as const, seat: actorSeat, card: await bot.chooseCard(playContextFor(turnState, actorSeat)) };
      if (cancelled) return;
      const result = applyAction(turnState, action);
      if (result.ok) setGame((current) => current === turnState ? result.state : current);
    };
    void decide();
    return () => { cancelled = true; };
  }, [frozen, game, playAgainstBots, botsFinishing, temporaryTrick, userSeat, biddingStyle, botSkill]);

  const actor = game?.currentActor;
  const selectedHand = reviewHandId ? soloData.completedHands.find((hand) => hand.id === reviewHandId) : undefined;
  const shownGame = selectedHand ? reviewState(selectedHand, reviewCursor) : game;
  const isReviewing = !!selectedHand;
  const shownActor = shownGame?.currentActor;
  const userControlsDeclaringSide = !!shownGame?.contract &&
    (shownGame.completedTricks.length > 0 || shownGame.currentTrick.length > 0) &&
    !!shownActor && samePartnership(userSeat, shownGame.contract.declarer) &&
    samePartnership(shownActor, shownGame.contract.declarer);
  const canShowHand = !isReviewing && !!game && !!actor &&
    (game.phase === "auction" || game.phase === "play") &&
    !botsFinishing && (!playAgainstBots || actor === userSeat || userControlsDeclaringSide);
  // Hints are worked out for the position the user is about to act in, and dropped as soon as the position changes.
  const hintGame = hintsOn && canShowHand ? game : undefined;
  const visibleBidHint = hintGame && bidHint?.game === hintGame ? bidHint : undefined;
  const visibleHint = hintGame && playHint?.game === hintGame ? playHint : undefined;
  const callsKey = `${reviewHandId ?? currentHandId}:${shownGame?.auction.length ?? 0}`;
  const shownExplanation = hintsOn && explainedCall?.key === callsKey ? explainedCall.index : undefined;

  useEffect(() => {
    if (!hintGame) return;
    let cancelled = false;
    const seat = hintGame.currentActor;
    const failed = () => { if (!cancelled) setMessage("Unable to get a hint. Please try again."); };
    if (hintGame.phase === "auction") {
      suggestBid(hintGame.hands[seat], hintGame.auction, seat, biddingStyle).then((suggestion) => {
        if (!cancelled && isCallAvailable(hintGame, suggestion.bid)) setBidHint({ game: hintGame, ...suggestion });
      }).catch(failed);
    } else if (hintGame.phase === "play") {
      const context = playContextFor(hintGame, seat);
      const suggestion = solver
        ? requestHint(context, solver).then((cards) => ({ cards, reason: "Recommended by the solver." }))
        : suggestPlay(context).then(({ card, reason }) => ({ cards: [card], reason }));
      suggestion.then(({ cards, reason }) => {
        if (!cancelled) setPlayHint({ game: hintGame, cardIds: new Set(cards.map(cardId)), reason });
      }).catch(failed);
    }
    return () => { cancelled = true; };
  }, [hintGame, biddingStyle, solver]);

  // The user may claim on their own play turn (as declarer, on dummy's turn too); not while bots finish or in review.
  const claimSeat = canShowHand && game?.phase === "play" ? claimSeatFor(game) : undefined;
  const soloClaimPending = !!soloClaim && soloClaim.game === game && claimSeat !== undefined;
  const pickingClaim = !!game && claimPickedAt === game && claimSeat !== undefined && !soloClaimPending;

  // The robots on the other side answer a claim with the exact check, and accept only a proven one.
  useEffect(() => {
    if (!soloClaimPending || !soloClaim) return;
    const pending = soloClaim;
    const timer = window.setTimeout(() => {
      const action = { type: "claim" as const, seat: pending.seat, tricks: pending.tricks };
      const result = checkClaim(pending.game, action) === "proven" ? applyAction(pending.game, action) : undefined;
      setSoloClaim(undefined);
      if (result?.ok) {
        setGame((current) => current === pending.game ? result.state : current);
        setMessage("");
      } else {
        setMessage(claimRejectedText({ tricks: pending.tricks, by: claimAnswerer(pending.game, pending.seat) }));
      }
    }, CLAIM_CHECK_MS);
    return () => window.clearTimeout(timer);
  }, [soloClaimPending, soloClaim]);

  function claim(tricks: number) {
    if (!game || claimSeat === undefined) return;
    setClaimPickedAt(undefined);
    if (!playAgainstBots) {
      // At a manual table the user plays both sides, so the claim stands at once.
      submitAction({ type: "claim", seat: claimSeat, tricks });
      return;
    }
    setMessage("");
    setSoloClaim({ game, seat: claimSeat, tricks });
  }

  // A card the user must play (the only legal one) is played for them after a short pause.
  const forced = !frozen && canShowHand && forcedPlayOn && !temporaryTrick && !soloClaimPending && !pickingClaim && game !== takenBackTo && game ? forcedCard(game) : undefined;
  useEffect(() => {
    if (!forced || !game) return;
    const turnState = game;
    const timer = window.setTimeout(() => {
      const result = applyAction(turnState, { type: "play", seat: turnState.currentActor, card: forced });
      if (result.ok) setGame((current) => current === turnState ? result.state : current);
    }, FORCED_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [forced, game]);

  // Seats whose queued card is kept: against bots, the user's own and, once dummy is down, dummy's when the user declares.
  // None while a claim is being checked, which clears the queue.
  const queueOwnerSeats: readonly Seat[] = !isReviewing && playAgainstBots && !botsFinishing && !soloClaimPending && game?.phase === "play"
    ? game.contract?.declarer === userSeat && (game.currentTrick.length > 0 || game.completedTricks.length > 0) ? [userSeat, partnerOf(userSeat)] : [userSeat]
    : [];
  const activeQueued = queued && game && queueOwnerSeats.includes(queued.seat) && queueStillValid(game, queued, currentHandId, soloClaimPending) ? queued : undefined;
  useEffect(() => {
    if (queued && !activeQueued) setQueued(undefined);
  }, [queued, activeQueued]);

  // The queued card is played like a forced one, after the same pause; when a card is forced it is that card, so only one plays.
  const queuedNow = !frozen && game && canShowHand && !temporaryTrick && !forced && !pickingClaim ? queuedPlay(game, activeQueued, game.currentActor) : undefined;
  useEffect(() => {
    if (!queuedNow || !game) return;
    const turnState = game;
    const timer = window.setTimeout(() => {
      const result = applyAction(turnState, { type: "play", seat: turnState.currentActor, card: queuedNow });
      if (result.ok) setGame((current) => current === turnState ? result.state : current);
    }, FORCED_PLAY_MS);
    return () => window.clearTimeout(timer);
  }, [queuedNow, game]);

  useEffect(() => {
    if (shownExplanation === undefined) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !(event.target as HTMLElement | null)?.closest?.(".seat-auction-call, .call-meaning")) setExplainedCall(undefined);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [shownExplanation]);

  function toggleHints() {
    const next = !hintsOn;
    setHintsOn(next);
    setExplainedCall(undefined);
    try { persistence.storage.setItem(hintsStorageKey, next ? "on" : "off"); } catch { /* the choice just won't be remembered */ }
  }

  function toggleForcedPlay() {
    const next = !forcedPlayOn;
    setForcedPlayOn(next);
    try { persistence.storage.setItem(forcedPlayStorageKey, next ? "on" : "off"); } catch { /* the choice just won't be remembered */ }
  }

  function chooseScoring(next: ScoringFormat) {
    setScoring(next);
    try { persistence.storage.setItem(scoringStorageKey, next); } catch { /* the choice just won't be remembered */ }
  }
  const phaseLabel = shownGame?.phase === "complete" ? "Hand complete" : "Passed out";
  const displayedTrick = !isReviewing && temporaryTrick?.handId === currentHandId
    ? temporaryTrick.cards
    : shownGame?.currentTrick.length
      ? shownGame.currentTrick
      : lastTrickOpen ? shownGame?.completedTricks.at(-1) ?? [] : [];

  function startHand() {
    const id = createHandId();
    let handDealer = dealer;
    let handVulnerability = vulnerability;
    if (scoring === "rubber") {
      // Rubber deals rotate the dealer and take vulnerability from games won; a finished rubber starts a new one.
      const next = nextRubberDeal(rubber, dealer);
      setRubber({ ...next.rubber, activeHandId: id });
      handDealer = next.dealer;
      handVulnerability = next.vulnerability;
    }
    setCurrentHandId(id);
    setGame(createGameState({ deal: deal(), dealer: handDealer, vulnerability: handVulnerability }));
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
    setDialog(undefined);
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

  function takeBack() {
    if (!game || game.history.cursor === 0) return;
    setBotsFinishHandId(undefined);
    setQueued(undefined);
    const previous = undoAction(game);
    setTakenBackTo(previous);
    setGame(previous);
    setMessage("");
  }

  function openReview(hand: SavedHand) {
    setDialog(undefined);
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

  useEffect(() => {
    const sync = () => { void isFullscreen().then(setFullscreenState).catch(() => undefined); };
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        void toggleFullscreen();
      } else if (event.key === "Escape") {
        setDialog(undefined);
        if (!isNativeClient()) return;
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

  const online = serviceUrl() !== undefined;
  const goOnline = () => { location.hash = "#/online"; };
  const rubberSummary = summarizeRubber(rubber);
  const rubberUnderway = !!rubber.lastDealer && !rubberSummary.winner;
  const dealSettings = <>
    <label>Scoring<select aria-label="Scoring" value={scoring} onChange={(event) => chooseScoring(event.target.value as ScoringFormat)}><option value="rubber">Rubber bridge</option><option value="single">Single deals</option></select></label>
    {scoring === "single" || !rubberUnderway ? <label>{scoring === "rubber" ? "First dealer" : "Dealer"}<select aria-label="Dealer" value={dealer} onChange={(event) => setDealer(event.target.value as Seat)}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label> : null}
    {scoring === "single" ? <label>Vulnerability<select aria-label="Vulnerability" value={vulnerability} onChange={(event) => setVulnerability(event.target.value as Vulnerability)}>{vulnerabilities.map((value) => <option key={value} value={value}>{value === "None" ? "None" : value === "Both" ? "Both" : `${value} vulnerable`}</option>)}</select></label> : null}
    <label>Opponents<select aria-label="Opponents" value={playAgainstBots ? "bots" : "manual"} onChange={(event) => setPlayAgainstBots(event.target.value === "bots")}><option value="manual">Manual table</option><option value="bots">Bots</option></select></label>
    {playAgainstBots ? <><label>Your seat<select aria-label="Your seat" value={userSeat} onChange={(event) => setUserSeat(event.target.value as Seat)}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label><label>Bot skill<select aria-label="Bot skill" value={botSkill} onChange={(event) => setBotSkill(event.target.value as SkillLevel)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select></label><label>Bot bidding style<select aria-label="Bot bidding style" value={biddingStyle} onChange={(event) => setBiddingStyle(event.target.value as "SAYC" | "2/1")}><option value="SAYC">Basic SAYC</option><option value="2/1">Basic 2/1</option></select></label></> : null}
    <label className="setup-check"><input type="checkbox" checked={hintsOn} onChange={toggleHints} />Show hints while bidding and playing</label>
    <label className="setup-check"><input type="checkbox" checked={forcedPlayOn} onChange={toggleForcedPlay} />Play forced cards automatically</label>
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
    {soloData.completedHands.length ? <ul className="recent-list">{soloData.completedHands.map((hand) => <li key={hand.id}>
      <button className="review-link" aria-label={`Review ${savedHandName(hand)}, played ${playedOn(hand)}`} onClick={() => openReview(hand)}><strong>{savedHandName(hand)}</strong><span>Played {playedOn(hand)}</span></button>
      <div className="recent-actions"><button onClick={() => downloadHand(hand.id)} aria-label={`Export PBN of ${savedHandName(hand)}`}>Export PBN</button><button onClick={() => removeHand(hand.id)} aria-label={`Delete ${savedHandName(hand)}`}>Delete</button></div>
    </li>)}</ul> : <p className="quiet-copy">Finished hands will be saved here for review.</p>}
  </section>;
  const fullscreenButton = <button className="icon-button" type="button" aria-label={fullscreen ? "Exit full screen" : "Full screen"} aria-pressed={fullscreen} title={`${fullscreen ? "Exit full screen" : "Full screen"} (F)`} onClick={() => { void toggleFullscreen(); }}>
    <svg viewBox="0 0 24 24" aria-hidden="true">{fullscreen
      ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
      : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}</svg>
  </button>;
  const version = <span className="header-version">Version {__CONTRACTPLAY_VERSION__}</span>;
  const dialogTitles: Record<MenuDialog, string> = { settings: "Settings", rubber: "Scores", hands: "Recent hands", about: "ContractPlay" };
  // The scorecard calls the user's partnership "We" against bots; otherwise the compass sides.
  const sideNames = playAgainstBots ? weTheySideNames(userSeat === "north" || userSeat === "south" ? "NS" : "EW") : compassSideNames;
  const cardHands = handsOnCard(rubber, rubberSummary);
  const menuDialog = dialog ? <div className="about-backdrop" onClick={() => setDialog(undefined)}>
    <section className={`about-dialog ${dialog === "about" ? "" : "menu-dialog"}`} role="dialog" aria-modal="true" aria-label={dialogTitles[dialog]} onClick={(event) => event.stopPropagation()}>
      {dialog === "about" ? <span className="brand-mark" aria-hidden="true">C</span> : null}
      {/* Recent hands keeps its own heading, with the count of saved hands. */}
      {dialog === "hands" ? null : <h2>{dialogTitles[dialog]}</h2>}
      {dialog === "about" ? <>
        <p className="about-version">Version {__CONTRACTPLAY_VERSION__}</p>
        <p>Play, learn, and review contract bridge.</p>
      </> : null}
      {dialog === "settings" ? <>
        <p className="quiet-copy">Scoring, dealer, and vulnerability apply from the next deal.</p>
        <section className="menu-settings" aria-label="Next deal settings">{dealSettings}</section>
      </> : null}
      {dialog === "rubber" ? <section className="rubber-menu" aria-label="Rubber">
        <Scorecard summary={rubberSummary} hands={cardHands} names={sideNames}
          actions={<button className="secondary-button" type="button" onClick={() => { setDialog(undefined); setRubber(emptyRubber()); }}>Start a new rubber</button>} />
      </section> : null}
      {dialog === "hands" ? <>{recentHandsPanel}{pbnImportForm}</> : null}
      <button className="primary-button" type="button" autoFocus onClick={() => setDialog(undefined)}>Close</button>
    </section>
  </div> : null;

  if (!shownGame) {
    return (
      <main className="app-shell">
        <section className="empty-table" aria-label="New deal">
          <div className="start-bar"><span className="brand"><span className="brand-mark">C</span>ContractPlay</span><span className="table-tools-row">{version}{fullscreenButton}</span></div>
          <div className="setup-controls">{dealSettings}</div>
          <button className="primary-button" onClick={startHand}>Start a new hand</button>
          {online ? <button className="secondary-button" type="button" onClick={goOnline}>Play online</button> : null}
          {soloData.completedHands.length ? <button className="secondary-button" type="button" onClick={() => setDialog("hands")}>Recent hands</button> : null}
          {pbnImportForm}
        </section>
        {message ? <p className="error-message" role="alert">{message}</p> : null}
        {menuDialog}
      </main>
    );
  }

  const phase = shownGame.phase;
  const contract = shownGame.contract;
  const liveTurn = phase === "auction" || phase === "play";
  // The seat drawn at the bottom edge: the user against bots, otherwise declarer (so dummy faces them) or South.
  const bottomSeat: Seat = playAgainstBots ? userSeat : contract ? contract.declarer : "south";
  const canAct = canShowHand && !!game && !!actor;
  const showBottomHand = playAgainstBots || isReviewing || botsFinishing;
  // The hand whose points the hints show during the auction: the one the hand zone shows.
  const auctionHandSeat: Seat | undefined = canAct ? actor : showBottomHand ? bottomSeat : undefined;
  const showCalls = phase !== "play" || auctionShown;
  const reviewedClaim = selectedHand && reviewCursor > 0 ? selectedHand.game.history.actions[reviewCursor - 1] : undefined;
  const statusText = isReviewing
    ? reviewedClaim?.type === "claim" && contract
      ? claimText(reviewedClaim, contract.declarer, remainingTricks(selectedHand!.game))
      : `Reviewing action ${reviewCursor} of ${handCount}`
    : liveTurn && activeQueued && !canAct ? `Queued: ${cardLabel(activeQueued.card)}`
    // Against bots, your own turns read as they do online.
    : liveTurn && playAgainstBots && canAct ? (phase === "auction" ? "Your call" : actor === userSeat ? "Your play" : actor === contract?.declarer ? "Play declarer's hand" : "Play from dummy")
    : liveTurn ? `${botsFinishing || (playAgainstBots && shownActor !== userSeat && !userControlsDeclaringSide) ? "Bot · " : ""}${seatNames[shownActor!]} to ${phase === "auction" ? "bid" : "play"}` : phaseLabel;

  // The same game menu as at an online table: the hand's actions first, then this device's settings and hands, and
  // dealing again (which abandons a hand in progress) set apart at the end.
  const handLive = !isReviewing && liveTurn;
  // The live hand counts towards the rubber when it was dealt for it, whatever the scoring choice for the next deal.
  const inRubber = !isReviewing && !!currentHandId && rubber.activeHandId === currentHandId;
  const menuItems: GameMenuItem[] = isReviewing ? [
    { id: "exit-review", label: "Exit review", onSelect: () => { setReviewHandId(undefined); setLastTrickOpen(false); } },
    { id: "hands", label: "Recent hands", onSelect: () => setDialog("hands") },
    { id: "about", label: "About ContractPlay", onSelect: () => setDialog("about") }
  ] : [
    ...(online ? [{ id: "online", label: "Online tables", title: "Go to the online lobby; this hand is kept for later", onSelect: goOnline }] : []),
    ...(claimSeat !== undefined && !soloClaimPending && !pickingClaim ? [{ id: "claim", label: "Claim", title: "Claim some or all of the remaining tricks", onSelect: () => setClaimPickedAt(game) }] : []),
    { id: "take-back", label: "Take back", disabled: !game || game.history.cursor === 0, title: "Undo the last call or card to choose again", onSelect: takeBack },
    ...(handLive && !botsFinishing ? [{ id: "auto-play", label: "Auto play this hand",
      title: "A bot makes your calls and plays your cards until this hand ends, then you play again", onSelect: () => setBotsFinishHandId(currentHandId) }] : []),
    { id: "settings", label: "Settings", title: "Scoring, dealer, opponents, hints, and forced cards for the next deal", onSelect: () => setDialog("settings") },
    ...(scoring === "rubber" || inRubber ? [{ id: "rubber", label: "Scores", title: "The rubber scorecard: above and below the line, games, totals, and the last hand's points", onSelect: () => setDialog("rubber") }] : []),
    { id: "hands", label: "Recent hands", title: "Review, export, or import hands", onSelect: () => setDialog("hands") },
    { id: "about", label: "About ContractPlay", onSelect: () => setDialog("about") },
    { id: "deal", label: "Deal a new hand", ...(handLive ? { tone: "danger" as const, title: "Abandon this hand and deal a new one" } : {}), onSelect: startHand }
  ];
  const tableTools = <>
    <GameMenu items={menuItems} defaultOpen={preview?.menuOpen ?? false} />
    {fullscreenButton}
  </>;

  // At the end of a rubber hand the scorecard offers the next deal, or once the rubber is won, another rubber or the
  // online tables; Close puts it away to look at the cards (Scores in the menu brings it back).
  const scorecardClosed = !!currentHandId && closedScorecard === currentHandId;
  const scorecardActions = <>
    <button className="primary-button" type="button" autoFocus onClick={startHand}>{rubberSummary.winner ? "Play another rubber" : "Next deal"}</button>
    {rubberSummary.winner && online ? <button className="secondary-button" type="button" onClick={goOnline}>Online tables</button> : null}
    <button className="secondary-button" type="button" onClick={() => setClosedScorecard(currentHandId)}>Close</button>
  </>;
  const duplicateScore = shownGame.score?.score ?? 0;
  const tableOverlay = <>
    {phase === "complete" && shownGame.score && contract && !(inRubber && scorecardClosed) ? <section className={`score-panel ${inRubber ? "scorecard-panel" : ""} ${displayedTrick.length ? "score-panel-hidden" : ""}`} aria-label="Hand result">
      <h2>{contractText(contract)} by {seatNames[contract.declarer]}</h2>
      <ContractOutcome score={shownGame.score} />
      {shownGame.claim ? <p className="claim-line">{claimText(shownGame.claim, contract.declarer, remainingTricks(shownGame))}</p> : null}
      {inRubber ? <Scorecard summary={rubberSummary} hands={cardHands} names={sideNames} actions={scorecardActions} /> : <>
        <p className="hand-points-line">{`${duplicateScore >= 0 ? "NS" : "EW"} +${Math.abs(duplicateScore)}`}</p>
        {!isReviewing ? <button className="primary-button" type="button" onClick={startHand}>Next deal</button> : null}
      </>}
    </section> : null}
    {phase === "passed-out" && !(inRubber && scorecardClosed) ? <section className={`score-panel ${inRubber ? "scorecard-panel" : ""}`} aria-label="Hand result"><h2>Passed out</h2>
      {inRubber ? <Scorecard summary={rubberSummary} hands={cardHands} names={sideNames} passedOut actions={scorecardActions} />
        : !isReviewing ? <button className="primary-button" type="button" onClick={startHand}>Next deal</button> : null}
    </section> : null}

    {isReviewing ? <div className="history-controls review-controls" role="group" aria-label="Review controls">
      <button className="secondary-button" aria-label="Previous action" disabled={reviewCursor === 0} onClick={() => setReviewCursor((cursor) => Math.max(0, cursor - 1))}><span aria-hidden="true">‹</span> Previous</button>
      <button className="secondary-button" aria-label="Next action" disabled={reviewCursor >= handCount} onClick={() => setReviewCursor((cursor) => Math.min(handCount, cursor + 1))}>Next <span aria-hidden="true">›</span></button>
    </div> : null}

    {!isReviewing && liveTurn ? <div className="hint-controls">
      {hintsOn && phase === "auction" && auctionHandSeat ? <strong className="hand-points" aria-label={`${highCardPoints(shownGame.hands[auctionHandSeat])} high-card points`}>{highCardPoints(shownGame.hands[auctionHandSeat])} HCP</strong> : null}
      {visibleBidHint && phase === "auction" ? <p role="status"><strong>Suggested: {compactCallLabel(visibleBidHint.bid)}</strong> {visibleBidHint.reason}</p> : null}
      {visibleHint && phase === "play" ? <p role="status">{visibleHint.reason}</p> : null}
      <button className="secondary-button hint-toggle" type="button" role="switch" aria-checked={hintsOn} title={hintsOn ? "Hide hints" : "Show hints: suggested bids and cards, and what each call means"} onClick={toggleHints}>Hints<span className="hint-switch" aria-hidden="true" /></button>
    </div> : null}

    {pickingClaim && game ? <ClaimPanel mode="pick" remaining={remainingTricks(game)} onClaim={claim} onCancel={() => setClaimPickedAt(undefined)} />
      : soloClaimPending && soloClaim ? <ClaimPanel mode="pending" text={`${pendingClaimText(soloClaim, remainingTricks(soloClaim.game), true)}. Checking…`} onWithdraw={() => setSoloClaim(undefined)} />
      : null}

    {botsFinishing && handLive ? <DraggableBanner className="online-resume" storageKey={autoPlayBannerKey} label="Auto play is on">
      <span>Auto play: a bot plays for you until this hand ends.</span>
      <button className="primary-button" type="button" onClick={() => setBotsFinishHandId(undefined)}>Stop auto play</button>
    </DraggableBanner> : null}

    {message ? <p className="error-message" role="alert">{message}</p> : null}
  </>;

  return (
    <main className={`app-shell ${fullscreen ? "is-fullscreen" : ""}`}>
      <div className={`game-layout ${phase === "auction" ? "auction-layout" : phase === "play" ? "play-layout" : ""}`}>
        <TableView
          game={shownGame}
          bottomSeat={bottomSeat}
          botSeats={playAgainstBots ? seats.filter((seat) => seat !== userSeat) : undefined}
          actingSeat={canAct ? actor : undefined}
          displayedTrick={displayedTrick}
          showCalls={showCalls}
          onToggleCalls={() => setAuctionShown((shown) => !shown)}
          lastTrickOpen={lastTrickOpen}
          onToggleLastTrick={() => setLastTrickOpen((open) => !open)}
          showBottomHand={showBottomHand}
          // Once the last trick has cleared, the whole deal is laid face-up around the result.
          revealedHands={displayedTrick.length ? undefined : shownGame.initialDeal}
          cardsDisabled={!!temporaryTrick || pickingClaim || soloClaimPending}
          queueSeats={canAct ? [] : queueOwnerSeats}
          queuedCard={activeQueued}
          onQueue={(seat, card) => setQueued((current) => current?.seat === seat && cardId(current.card) === cardId(card) ? undefined : { handKey: currentHandId, seat, card })}
          statusText={statusText}
          ariaLabel={isReviewing ? "Hand review" : "Bridge table"}
          onBid={(bid) => { if (game) submitAction({ type: "bid", seat: game.currentActor, bid }); }}
          onPlay={(seat, card) => submitAction({ type: "play", seat, card })}
          hintedBid={visibleBidHint?.bid}
          hintedCards={visibleHint?.cardIds}
          explainCall={hintsOn ? {
            shown: shownExplanation,
            onToggle: (index) => setExplainedCall(shownExplanation === index ? undefined : { key: callsKey, index }),
            text: (index) => {
              const seat = shownGame.auction[index]!.seat;
              return explainBid(shownGame.auction, index, biddingStyle, playAgainstBots && seat !== userSeat ? botSkill : "expert");
            }
          } : undefined}
          tools={tableTools}
          overlay={tableOverlay}
        />
      </div>
      {menuDialog}
    </main>
  );
}
