import { useEffect, useMemo, useRef, useState } from "react";
import {
  applyAction,
  cardId,
  contractText as contractPbnText,
  claimSeatFor,
  createGameState,
  deal,
  emptyRubber,
  forcedCard,
  nextRubberDeal,
  partnership,
  recordRubberHand,
  redoAction,
  remainingTricks,
  replayOriginal,
  SEATS,
  summarizeRubber,
  playContextFor,
  requestHint,
  undoAction,
  type Aggression,
  type Bid,
  type GameState,
  type HandRecord,
  type Rubber,
  type Seat,
  type SkillLevel,
  type Solver,
  type TrickCard,
  type Vulnerability
} from "@contractplay/core";
import { exportPbn } from "@contractplay/pbn";
import { newestHands, retainHandHistory } from "./handHistoryRetention.js";
import sampleBoardSetUrl from "./fixtures/bridge-training-ruffing-short-hand-level-1.pbn?url&no-inline";
import { deleteSavedHand, isSyncableSoloHand, loadSoloData, parseBoardSetBackup, saveSoloData, serializeBoardSetBackup, upsertBoardSetLibrary, type BoardSet, type BoardSetLibraryEntry, type OwnCharacter, type PbnMetadata, type SavedHand, type SoloData, type StorageLike } from "@contractplay/persistence";
import { checkClaim, createBot, explainBid, highCardPoints, suggestBid, suggestPlay } from "@contractplay/bots";
import { boardLabel, boardSetFromLin, boardSetFromPbn, boardSetFromPbnAndUsebio, createBoardSetId, isBoardSetFile } from "./boardSet.js";
import { createClientPersistenceAdapter } from "./platformPersistence.js";
import { isNativeClient, openHandFiles, savePbnFile } from "./nativeFiles.js";
import { FullscreenButton, useFullscreen } from "./table/FullscreenButton.js";
import { ReloadButton } from "./table/ReloadButton.js";
import { createHandName, savedHandName } from "./handNames.js";
import { aggressionOptions, cardLabel, claimRejectedText, claimText, compactCallLabel, pendingClaimText, contractText, isCallAvailable, partnerOf, samePartnership, seatNames, seats } from "./table/labels.js";
import { TableView } from "./table/TableView.js";
import { useDealAnimation } from "./table/DealAnimation.js";
import { bottomSeatFor } from "./table/bottomSeat.js";
import { FORCED_PLAY_MS, forcedPlayEnabled, forcedPlayStorageKey } from "./table/forcedPlay.js";
import { queuedPlay, queueStillValid, type QueuedCard } from "./table/queuedCard.js";
import { ClaimPanel } from "./table/ClaimPanel.js";
import { DraggableBanner } from "./table/DraggableBanner.js";
import { GameMenu, type GameMenuItem } from "./table/GameMenu.js";
import { ContractOutcome } from "./table/ResultSummary.js";
import { FieldResult } from "./table/FieldResult.js";
import { fetchReplay, replayNotice, useSoloResultPost } from "./replays.js";
import { botSettingsAt, castCharacterAt, castHasCustom, loadSoloSetup, saveSoloSetup, soloSetupStored, type BotCast, type SoloScoring } from "./soloSetup.js";
import { BotCastFields } from "./table/BotCastFields.js";
import { castMemberName, editedNote, loadPartnerResults, opponentStats, opponentSummary, partnerResultOf, partnerStats, partnerSummary, recordPartnerResult, type PartnerResult } from "./partnerResults.js";
import { compassSideNames, handsOnCard, Scorecard, weTheySideNames } from "./table/Scorecard.js";
import { currentAccount } from "./online/auth.js";
import { syncOnlineHands, uploadSoloHand } from "./online/handHistory.js";
import { syncBotResults, uploadBotResult } from "./online/botResultsSync.js";
import { CharacterLimitError, syncCharacters, uploadCharacters } from "./online/charactersSync.js";
import { applyCharacters, changedCharacters, charactersFor, loadOwnCharacters, saveOwnCharacters } from "./ownCharacters.js";
import { serviceUrl } from "./online/connection.js";
import type { BenchmarkPracticeSetup } from "./online/benchmarkPractice.js";

const vulnerabilities: readonly Vulnerability[] = ["None", "NS", "EW", "Both"];
const hintsStorageKey = "contractplay.hints";
/** How long the robots seem to think about a claim, so the player sees it being checked. */
const CLAIM_CHECK_MS = 800;
type ScoringFormat = SoloScoring;

function createHandId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createMemoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: (key) => { values.delete(key); } };
}

/** The robot that answers a claim for the other side: the first defender for a declaring-side claim, else declarer. */
function claimAnswerer(game: GameState, claimSeat: Seat): Seat {
  const declarer = game.contract!.declarer;
  return samePartnership(claimSeat, declarer) ? seats.find((seat) => !samePartnership(seat, declarer))! : declarer;
}

const playedOn = (hand: SavedHand): string => new Date(hand.savedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function reviewState(game: GameState, cursor: number): GameState {
  let state = game;
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
  /** The named bots around the player; without it the preview keeps the stored (default) cast. */
  cast?: BotCast;
  /** One of the game menu's dialogs is open. */
  dialog?: MenuDialog;
  /** The editor is open on this own character. */
  editingCharacter?: string;
  /** Review this saved hand at this action. */
  review?: Readonly<{ handId: string; cursor: number }>;
  /** Show the original table's play of the current board at this action. */
  viewOriginal?: number;
}>;

/** The game menu's larger entries open as dialogs over the table. */
export type MenuDialog = "settings" | "rubber" | "hands" | "about";
/** Shared with online play, so the Auto play banner stays where the player last put it. */
const autoPlayBannerKey = "contractplay.resumeBanner";

/**
 * `initialDialog` opens a menu dialog on arrival, as when online play links to Recent hands. `autoStart` deals a hand on
 * arrival (the lobby's Play panel), unless a hand is still being bid or played, which is resumed instead.
 */
export default function App({ solver, preview, initialDialog, autoStart, benchmarkPractice, onExitBenchmarkPractice }: { solver?: Solver; preview?: SoloPreview; initialDialog?: MenuDialog; autoStart?: boolean; benchmarkPractice?: BenchmarkPracticeSetup; onExitBenchmarkPractice?: () => void } = {}) {
  const frozen = !!preview;
  const practiceStorage = useMemo(createMemoryStorage, [benchmarkPractice]);
  const persistence = useMemo(() => createClientPersistenceAdapter(preview?.storage ?? (benchmarkPractice ? practiceStorage : window.localStorage)), [preview, benchmarkPractice, practiceStorage]);
  const [soloData, setSoloData] = useState<SoloData>(() => {
    if (!benchmarkPractice) return loadSoloData(persistence.storage);
    const game = createGameState(benchmarkPractice.record);
    return { version: 1, currentHandId: createHandId(), currentGame: game, completedHands: [], currentRecord: benchmarkPractice.record,
      boardSet: { name: benchmarkPractice.record.event ?? "Bot benchmark practice", records: [benchmarkPractice.record], position: 0 }, handsStarted: 1 };
  });
  const latestSoloData = useRef(soloData);
  latestSoloData.current = soloData;
  const pbnFileInput = useRef<HTMLInputElement>(null);
  const [game, setGame] = useState<GameState | undefined>(() => soloData.currentGame ?? undefined);
  const [currentHandId, setCurrentHandId] = useState(() => soloData.currentHandId ?? (soloData.currentGame ? createHandId() : ""));
  const [dealer, setDealer] = useState<Seat>(() => soloData.currentGame?.dealer ?? "north");
  const [vulnerability, setVulnerability] = useState<Vulnerability>(() => soloData.currentGame?.vulnerability ?? "None");
  // Previews fix their own table; otherwise solo opens with the setup the player (or the lobby's Play panel) last chose.
  const [initialSetup] = useState(() => preview ? { ...loadSoloSetup(persistence.storage),
    opponents: preview.userSeat !== undefined ? "bots" as const : "manual" as const, seat: preview.userSeat ?? "north", ...(preview.cast ? { cast: preview.cast } : {}) }
    // A hand left unfinished before setups were remembered was at a manual table, solo's old default: keep it there.
    : benchmarkPractice ? { ...loadSoloSetup(persistence.storage), opponents: "bots" as const, seat: benchmarkPractice.userSeat,
      botSkill: benchmarkPractice.botSkill, biddingStyle: benchmarkPractice.biddingStyle, botAggression: benchmarkPractice.botAggression,
      cast: benchmarkPractice.cast, scoring: "single" as const }
    : !soloSetupStored(persistence.storage) && (soloData.currentGame?.phase === "auction" || soloData.currentGame?.phase === "play")
      ? { ...loadSoloSetup(persistence.storage), opponents: "manual" as const }
      : loadSoloSetup(persistence.storage));
  const [playAgainstBots, setPlayAgainstBots] = useState(initialSetup.opponents === "bots");
  const [userSeat, setUserSeat] = useState<Seat>(initialSetup.seat);
  const [botSkill, setBotSkill] = useState<SkillLevel>(initialSetup.botSkill);
  const [biddingStyle, setBiddingStyle] = useState<"SAYC" | "2/1">(initialSetup.biddingStyle);
  const [botAggression, setBotAggression] = useState<Aggression>(initialSetup.botAggression);
  const [cast, setCast] = useState<BotCast>(initialSetup.cast);
  const [partnerResults, setPartnerResults] = useState<readonly PartnerResult[]>(() => loadPartnerResults(persistence.storage));
  // Every character stored on this device; the player sees and plays only their own (see `charactersFor`).
  const [storedCharacters, setStoredCharacters] = useState<readonly OwnCharacter[]>(() => loadOwnCharacters(persistence.storage));
  const [accountPlayerId, setAccountPlayerId] = useState<string>();
  // Which account's characters to show matters only once some belong to an account, so only then is the account asked for.
  const anySynced = storedCharacters.some((character) => character.owner !== undefined);
  useEffect(() => {
    if (frozen || !anySynced || serviceUrl() === undefined) return;
    let active = true;
    void currentAccount().then((account) => { if (active) setAccountPlayerId(account?.playerId); }).catch(() => {});
    return () => { active = false; };
  }, [frozen, anySynced]);
  const ownCharacters = useMemo(() => charactersFor(storedCharacters, accountPlayerId), [storedCharacters, accountPlayerId]);
  const [auctionShown, setAuctionShown] = useState(false);
  const [fullscreen, toggleFullscreen] = useFullscreen(() => setMessage("Full screen is not available here."));
  const [pbnInput, setPbnInput] = useState("");
  const [currentPbnMetadata, setCurrentPbnMetadata] = useState<PbnMetadata | undefined>(() => soloData.currentPbnMetadata);
  const [message, setMessage] = useState("");
  const [hintsOn, setHintsOn] = useState(() => {
    try { return persistence.storage.getItem(hintsStorageKey) === "on"; } catch { return false; }
  });
  const [forcedPlayOn, setForcedPlayOn] = useState(() => forcedPlayEnabled(persistence.storage));
  // The position a take-back returned to: a forced card there waits for the player instead of replaying at once.
  const [takenBackTo, setTakenBackTo] = useState<GameState>();
  const [scoring, setScoring] = useState<ScoringFormat>(initialSetup.scoring);
  useEffect(() => {
    if (!frozen) saveSoloSetup(persistence.storage, { opponents: playAgainstBots ? "bots" : "manual", seat: userSeat, botSkill, biddingStyle, botAggression, cast, scoring });
  }, [frozen, persistence, playAgainstBots, userSeat, botSkill, biddingStyle, botAggression, cast, scoring]);
  const [rubber, setRubber] = useState<Rubber>(() => soloData.rubber ?? emptyRubber());
  const [boardSet, setBoardSet] = useState<BoardSet | undefined>(() => soloData.boardSet);
  const [boardSetLibrary, setBoardSetLibrary] = useState<readonly BoardSetLibraryEntry[]>(() => soloData.boardSetLibrary ?? []);
  const [currentRecord, setCurrentRecord] = useState<HandRecord | undefined>(() => soloData.currentRecord);
  // New hands dealt so far: every second one asks for an archived deal to replay, and New hand waits for the answer.
  const [handsStarted, setHandsStarted] = useState(() => soloData.handsStarted ?? 0);
  const [replayPending, setReplayPending] = useState(false);
  const replayPendingRef = useRef(false);
  // A new hand is shuffled and dealt on the felt before its cards appear; the hand on the table at start-up is not.
  const dealing = useDealAnimation(currentHandId || undefined);
  const currentHandIdRef = useRef(currentHandId);
  currentHandIdRef.current = currentHandId;
  // The rubber as it stands, for a new hand dealt once a replay request has been answered.
  const rubberRef = useRef(rubber);
  rubberRef.current = rubber;
  // The hand whose end-of-hand scorecard the user closed.
  const [closedScorecard, setClosedScorecard] = useState<string | null>(null);
  const [bidHint, setBidHint] = useState<{ game: GameState; bid: Bid; reason: string }>();
  const [playHint, setPlayHint] = useState<{ game: GameState; cardIds: ReadonlySet<string>; reason: string }>();
  const [explainedCall, setExplainedCall] = useState<{ key: string; index: number }>();
  const [temporaryTrick, setTemporaryTrick] = useState<{ handId: string; cards: readonly TrickCard[] }>();
  const [lastTrickOpen, setLastTrickOpen] = useState(false);
  const [reviewHandId, setReviewHandId] = useState<string | undefined>(preview?.review?.handId);
  const [reviewCursor, setReviewCursor] = useState(preview?.review?.cursor ?? preview?.viewOriginal ?? 0);
  // The original table's play of the shown board, opened from its result, and the review cursor to return to.
  const [original, setOriginal] = useState<{ game: GameState; returnCursor: number } | undefined>(() => {
    const game = preview?.viewOriginal !== undefined && soloData.currentRecord ? replayOriginal(soloData.currentRecord) : undefined;
    return game ? { game, returnCursor: 0 } : undefined;
  });
  const [dialog, setDialog] = useState<MenuDialog | undefined>(preview?.dialog ?? initialDialog);
  useEffect(() => {
    if (frozen || benchmarkPractice || dialog !== "hands" || serviceUrl() === undefined) return;
    let active = true;
    void currentAccount().then(async account => {
      if (!active || !account) return;
      await syncOnlineHands(persistence.storage, account);
      if (active) setSoloData(loadSoloData(persistence.storage));
      // Results with named bots follow the account too; a failure here just waits for the next sync.
      const results = await syncBotResults(persistence.storage, account).catch(() => undefined);
      if (active && results) setPartnerResults(results);
      const characters = await syncCharacters(persistence.storage, account).catch((error: unknown) => {
        if (active && error instanceof CharacterLimitError) {
          setMessage("Your account already holds 24 characters, so your newest ones are kept only in this browser. Delete some to make room.");
        }
        return loadOwnCharacters(persistence.storage);
      });
      if (active) setStoredCharacters(characters);
    }).catch(() => { if (active) setMessage("Online history could not sync. Your local hands are still available; reopen Recent hands to retry."); });
    return () => { active = false; };
  }, [dialog, frozen, benchmarkPractice, persistence]);
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
  }, [reviewHandId, original]);

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
        playerSeat: existing?.playerSeat ?? (playAgainstBots ? userSeat : "south"),
        game,
        savedAt: new Date().toISOString(),
        ...(currentPbnMetadata ? { pbnMetadata: currentPbnMetadata } : {}),
        ...(currentRecord ? { record: currentRecord } : {}),
        // A hand already saved to the account keeps its owner when it is saved again.
        ...(existing?.onlineHistory ? { onlineHistory: existing.onlineHistory } : {})
      };
      completedHands = retainHandHistory([record, ...completedHands.filter((hand) => hand.id !== currentHandId)]);
    }
    const nextData: SoloData = {
      version: 1,
      currentHandId,
      currentGame: game,
      ...(currentPbnMetadata ? { currentPbnMetadata } : {}),
      completedHands,
      rubber,
      ...(boardSet ? { boardSet } : {}),
      ...(boardSetLibrary.length ? { boardSetLibrary } : {}),
      ...(currentRecord ? { currentRecord } : {}),
      ...(handsStarted ? { handsStarted } : {})
    };
    latestSoloData.current = nextData;
    saveSoloData(persistence.storage, nextData);
    setSoloData(nextData);
  }, [game, currentHandId, currentPbnMetadata, rubber, boardSet, boardSetLibrary, currentRecord, handsStarted]);

  // A hand finished with a named partner counts towards your results with them, once per finish (a hand taken back and
  // finished again replaces its result). The hand open when solo starts was counted when it was finished.
  const resultCountedFor = useRef(game);
  useEffect(() => {
    if (frozen || benchmarkPractice || !game || !currentHandId || !playAgainstBots || resultCountedFor.current === game) return;
    resultCountedFor.current = game;
    const result = partnerResultOf(currentHandId, game, userSeat, cast, { at: Date.now() }, ownCharacters);
    if (!result) return;
    setPartnerResults(recordPartnerResult(persistence.storage, result));
    if (serviceUrl() === undefined) return;
    void currentAccount().then(async (account) => {
      if (account) setPartnerResults(await uploadBotResult(persistence.storage, account, result));
    }).catch(() => {});
  }, [frozen, benchmarkPractice, game, currentHandId, playAgainstBots, userSeat, cast, persistence, ownCharacters]);
  // The player's own characters: kept here, and sent to the account for a signed-in player (a failure waits for the next sync).
  const saveOwn = (next: OwnCharacter[]) => {
    const changed = changedCharacters(ownCharacters, next);
    if (frozen || benchmarkPractice) { setStoredCharacters(applyCharacters(storedCharacters, changed)); return; }
    // Into the stored list as it is now, so a sync that just landed isn't overwritten.
    setStoredCharacters(saveOwnCharacters(persistence.storage, applyCharacters(loadOwnCharacters(persistence.storage), changed)));
    if (serviceUrl() === undefined) return;
    void currentAccount().then(async (account) => {
      if (account) setStoredCharacters(await uploadCharacters(persistence.storage, account, changed));
    }).catch(() => {});
  };
  const castRecords = useMemo(() => ({ partners: partnerStats(partnerResults), opponents: opponentStats(partnerResults), results: partnerResults }), [partnerResults]);
  const partnerRecords = castRecords.partners;

  // Hands played against bots on dealt or replayed deals go to the archive; imported, board-set and repeated ones do not.
  useSoloResultPost(currentHandId, game, !frozen && !benchmarkPractice && playAgainstBots && !currentPbnMetadata && !boardSet && (!currentRecord || !!currentRecord.replay), currentRecord?.replay?.dealId);

  // A signed-in player's finished hand goes to their account at once (dealt or replayed only); a failure retries on the next sync.
  const uploadedHandId = useRef(game?.phase === "complete" ? currentHandId : undefined);
  useEffect(() => {
    if (frozen || benchmarkPractice || !currentHandId || game?.phase !== "complete" || uploadedHandId.current === currentHandId || serviceUrl() === undefined) return;
    // The finished hand reaches the saved list one render after the game ends.
    const hand = soloData.completedHands.find((candidate) => candidate.id === currentHandId);
    if (!hand) return;
    uploadedHandId.current = currentHandId;
    if (!isSyncableSoloHand(hand)) return;
    void currentAccount().then(async (account) => {
      if (!account) return;
      await uploadSoloHand(persistence.storage, account, hand);
      setSoloData(loadSoloData(persistence.storage));
    }).catch(() => {});
  }, [frozen, benchmarkPractice, currentHandId, game, soloData, persistence]);

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
    const decide = async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      if (cancelled) return;
      const actorSeat = turnState.currentActor;
      // Each seat's bot is its cast character, or the custom bot (as is the bot playing for the player on auto play).
      const settings = botSettingsAt({ cast, botSkill, botAggression }, actorSeat, userSeat, ownCharacters);
      const bot = createBot({ skill: settings.skill, biddingStyle, aggression: settings.aggression, ...(settings.traits ? { traits: settings.traits } : {}) });
      const action = turnState.phase === "auction"
        ? { type: "bid" as const, seat: actorSeat, bid: await bot.chooseBid(turnState.hands[actorSeat], turnState.auction, actorSeat) }
        : { type: "play" as const, seat: actorSeat, card: await bot.chooseCard(playContextFor(turnState, actorSeat)) };
      if (cancelled) return;
      const result = applyAction(turnState, action);
      if (result.ok) setGame((current) => current === turnState ? result.state : current);
    };
    void decide();
    return () => { cancelled = true; };
  }, [frozen, game, playAgainstBots, botsFinishing, temporaryTrick, userSeat, biddingStyle, botSkill, botAggression, cast, ownCharacters]);

  const actor = game?.currentActor;
  const selectedHand = reviewHandId ? newestHands(soloData.completedHands).find((hand) => hand.id === reviewHandId) : undefined;
  // The original play is looked at over the hand it belongs to, live or reviewed.
  const reviewedGame = original?.game ?? selectedHand?.game;
  const shownGame = reviewedGame ? reviewState(reviewedGame, reviewCursor) : game;
  const isReviewing = !!reviewedGame;
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
  const callsKey = `${original ? "original:" : ""}${reviewHandId ?? currentHandId}:${shownGame?.auction.length ?? 0}`;
  const shownExplanation = explainedCall?.key === callsKey ? explainedCall.index : undefined;

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
  }
  const phaseLabel = shownGame?.phase === "complete" ? "Hand complete" : "Passed out";
  const displayedTrick = !isReviewing && temporaryTrick?.handId === currentHandId
    ? temporaryTrick.cards
    : shownGame?.currentTrick.length
      ? shownGame.currentTrick
      : lastTrickOpen ? shownGame?.completedTricks.at(-1) ?? [] : [];

  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || frozen || autoStarted.current) return;
    autoStarted.current = true;
    if (game?.phase !== "auction" && game?.phase !== "play") void startHand();
    // Only on arrival: the hand in progress when solo opened decides.
  }, []);

  async function startHand() {
    if (replayPendingRef.current) return;
    const count = handsStarted + 1;
    // Rubber deals rotate the dealer and take vulnerability from games won; a finished rubber starts a new one.
    const rubberDeal = () => scoring === "rubber" ? nextRubberDeal(rubberRef.current, dealer) : undefined;
    let replay: Awaited<ReturnType<typeof fetchReplay>>;
    if (count % 2 === 0) {
      const handBefore = currentHandIdRef.current;
      replayPendingRef.current = true;
      setReplayPending(true);
      const requested = rubberDeal()?.vulnerability;
      replay = await fetchReplay(requested);
      replayPendingRef.current = false;
      setReplayPending(false);
      // Another hand was started meanwhile (an import, a board set): it stands.
      if (currentHandIdRef.current !== handBefore) return;
      // A game won meanwhile changed the rubber's vulnerability, which the replay's field was scored at.
      if (rubberDeal()?.vulnerability !== requested) replay = undefined;
    }
    const next = rubberDeal();
    const id = createHandId();
    if (next) setRubber({ ...next.rubber, activeHandId: id });
    setHandsStarted(count);
    setCurrentHandId(id);
    setGame(createGameState({
      deal: replay?.record.deal ?? deal(),
      dealer: replay?.record.dealer ?? next?.dealer ?? dealer,
      vulnerability: next?.vulnerability ?? replay?.record.vulnerability ?? vulnerability
    }));
    setCurrentPbnMetadata(undefined);
    setBoardSet(undefined);
    setCurrentRecord(replay?.record);
    setAuctionShown(false);
    setReviewHandId(undefined);
    setOriginal(undefined);
    setMessage("");
  }

  function rememberBoardSet(entry: BoardSetLibraryEntry): boolean {
    const result = upsertBoardSetLibrary(boardSetLibrary, entry);
    setBoardSetLibrary(result.entries);
    return result.stored;
  }

  function boardSetEntry(set: BoardSet, progress: number, completed = false): BoardSetLibraryEntry {
    return { id: set.id ?? createBoardSetId(), name: set.name, records: set.records, progress, completed };
  }

  // A board of an imported set is dealt as recorded; it stays out of the rubber and leaves the next-deal settings alone.
  function startBoard(set: BoardSet) {
    const identified = { ...set, id: set.id ?? createBoardSetId() };
    const stored = rememberBoardSet(boardSetEntry(identified, identified.position));
    const record = identified.records[identified.position]!;
    setCurrentHandId(createHandId());
    setGame(createGameState({ deal: record.deal, dealer: record.dealer, vulnerability: record.vulnerability }));
    setCurrentRecord(record);
    setBoardSet(identified);
    setCurrentPbnMetadata(undefined);
    setAuctionShown(false);
    setReviewHandId(undefined);
    setOriginal(undefined);
    setDialog(undefined);
    if (!stored) setMessage("This board set exceeds the local library limit; it is available only while active.");
    else setMessage("");
  }

  function importHand(contents = pbnInput, usebioContents?: string) {
    const backup = parseBoardSetBackup(contents);
    if (backup) {
      const stored = rememberBoardSet(backup);
      setPbnInput("");
      setMessage(stored ? `Imported ${backup.name} into Recent hands.` : "This board set exceeds the local library limit and could not be stored.");
      return;
    }
    const isLin = !/^\s*\[Dealer\b/im.test(contents) && /\b(?:pn|qx|md)\|/i.test(contents);
    const importedSet = usebioContents
      ? boardSetFromPbnAndUsebio(contents, usebioContents)
      : isLin ? boardSetFromLin(contents) : boardSetFromPbn(contents);
    const { set, skipped, boards } = importedSet;
    if (set && (isBoardSetFile(set) || usebioContents !== undefined)) {
      startBoard(set);
      setPbnInput("");
      const messages = [
        ...(skipped ? ["Skipped " + skipped + " board(s) that could not be read."] : []),
        ...("diagnostics" in importedSet ? importedSet.diagnostics as readonly string[] : [])
      ];
      setMessage(messages.join(" "));
      return;
    }
    const board = boards[0];
    const diagnostic = board?.diagnostics.find((entry) => entry.severity === "error");
    if (!board?.deal || !board.dealer || diagnostic) {
      setMessage(`Cannot import ${isLin ? "LIN" : "PBN"}: ${diagnostic?.message ?? "include a valid deal and dealer"}`);
      return;
    }
    let imported = createGameState({ deal: board.deal, dealer: board.dealer, vulnerability: board.vulnerability ?? "None" });
    for (const action of board.actions) {
      const result = applyAction(imported, action);
      if (!result.ok) {
        setMessage(`Cannot import ${isLin ? "LIN" : "PBN"}: ${result.error.message}`);
        return;
      }
      imported = result.state;
    }
    setCurrentHandId(createHandId());
    setGame(imported);
    setBoardSet(undefined);
    setCurrentRecord(undefined);
    setAuctionShown(false);
    setCurrentPbnMetadata({ tags: board.tags, comments: board.comments });
    setDialog(undefined);
    setDealer(board.dealer);
    setVulnerability(board.vulnerability ?? "None");
    setReviewHandId(undefined);
    setOriginal(undefined);
    setPbnInput("");
    setMessage(skipped ? `Skipped ${skipped} board(s) that could not be read.` : "");
  }

  function advanceBoardSet() {
    if (!boardSet) return;
    const nextPosition = boardSet.position + 1;
    const completed = nextPosition >= boardSet.records.length;
    const entry = boardSetEntry(boardSet, completed ? boardSet.records.length : nextPosition, completed);
    const stored = rememberBoardSet(entry);
    if (completed) setBoardSet(undefined);
    else startBoard({ ...boardSet, position: nextPosition });
    if (!stored) setMessage("Board set progress could not be saved because the local library limit was reached.");
  }

  function finishBoardSet() {
    if (!boardSet) return;
    const stored = rememberBoardSet(boardSetEntry(boardSet, boardSet.records.length, true));
    setBoardSet(undefined);
    if (!stored) setMessage("Board set progress could not be saved because the local library limit was reached.");
  }

  function resumeBoardSet(entry: BoardSetLibraryEntry, restart = false) {
    const position = restart || entry.completed ? 0 : Math.min(entry.progress, entry.records.length - 1);
    startBoard({ id: entry.id, name: entry.name, records: entry.records, position });
  }

  function deleteBoardSet(entry: BoardSetLibraryEntry) {
    setBoardSetLibrary((items) => items.filter((item) => item.id !== entry.id));
    if (boardSet?.id === entry.id) setBoardSet(undefined);
  }

  async function exportBoardSet(entry: BoardSetLibraryEntry) {
    const contents = serializeBoardSetBackup(entry);
    const fileName = `${entry.name.replace(/[^\w.-]+/g, "-") || "board-set"}.json`;
    if (isNativeClient()) {
      try { await savePbnFile(fileName, contents); } catch (error) {
        setMessage(`Cannot export board set: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function choosePbnFile() {
    if (!isNativeClient()) {
      pbnFileInput.current?.click();
      return;
    }
    try {
      const files = await openHandFiles();
      if (!files?.length) return;
      const pbn = files.find((file) => /\.(?:pbn|lin|txt)$/i.test(file.name));
      const usebio = files.find((file) => /\.xml$/i.test(file.name));
      const backup = files.find((file) => /\.json$/i.test(file.name));
      if (usebio && pbn) importHand(pbn.contents, usebio.contents);
      else if (backup) importHand(backup.contents);
      else if (pbn) importHand(pbn.contents);
      else setMessage("Choose a PBN or LIN hand record, or choose a PBN and USEBIO XML pair.");
    } catch (error) {
      setMessage(`Cannot open hand record: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importSelectedPbnFile(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    if (!files.length) return;
    try {
      const pbn = files.find((file) => /\.(?:pbn|lin|txt)$/i.test(file.name));
      const usebio = files.find((file) => /\.xml$/i.test(file.name));
      const backup = files.find((file) => /\.json$/i.test(file.name));
      if (usebio && pbn) importHand(await pbn.text(), await usebio.text());
      else if (backup) importHand(await backup.text());
      else if (pbn) importHand(await pbn.text());
      else setMessage("Choose a PBN or LIN hand record, or choose a PBN and USEBIO XML pair.");
    } catch (error) {
      setMessage(`Cannot open hand record: ${error instanceof Error ? error.message : String(error)}`);
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
    setOriginal(undefined);
    setReviewCursor(0);
    setLastTrickOpen(false);
    setMessage("");
  }

  function replaySavedDeal(hand: SavedHand) {
    const attempts = soloData.completedHands.filter((candidate) => candidate.game.score && candidate.game.dealer === hand.game.dealer &&
      candidate.game.vulnerability === hand.game.vulnerability && SEATS.every((seat) =>
        candidate.game.initialDeal[seat].map(cardId).sort().join(",") === hand.game.initialDeal[seat].map(cardId).sort().join(",")));
    const record: HandRecord = {
      board: hand.name ?? savedHandName(hand),
      event: "Previous attempts",
      scoring: "MP",
      dealer: hand.game.dealer,
      vulnerability: hand.game.vulnerability,
      deal: hand.game.initialDeal,
      field: attempts.map(({ game: previous }) => ({
        nsScore: previous.score!.score,
        contract: contractPbnText(previous.contract),
        ...(previous.contract ? { declarer: previous.contract.declarer } : {}),
        tricks: previous.score!.tricksTaken,
        multiplicity: 1,
        artificial: false
      }))
    };
    setCurrentHandId(createHandId());
    setGame(createGameState({ deal: hand.game.initialDeal, dealer: hand.game.dealer, vulnerability: hand.game.vulnerability }));
    setCurrentPbnMetadata(undefined);
    setCurrentRecord(record);
    setBoardSet(undefined);
    setDialog(undefined);
    setReviewHandId(undefined);
    setOriginal(undefined);
    setAuctionShown(false);
    setMessage("");
  }

  function removeHand(id: string) {
    setSoloData(deleteSavedHand(persistence.storage, id));
  }

  async function downloadHand(id: string) {
    const hand = newestHands(soloData.completedHands).find((candidate) => candidate.id === id);
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

  const handCount = reviewedGame?.history.actions.length ?? 0;

  function viewOriginal(record: HandRecord) {
    const originalGame = replayOriginal(record);
    if (!originalGame) return;
    setOriginal({ game: originalGame, returnCursor: reviewCursor });
    setReviewCursor(0);
    setMessage("");
  }

  function exitReview() {
    setReviewHandId(undefined);
    setLastTrickOpen(false);
  }

  function backToResult() {
    if (original) setReviewCursor(original.returnCursor);
    setOriginal(undefined);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setDialog(undefined); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const online = serviceUrl() !== undefined;
  const goOnline = () => { location.hash = "#/online"; };
  const rubberSummary = summarizeRubber(rubber);
  const rubberUnderway = !!rubber.lastDealer && !rubberSummary.winner;
  const dealSettings = <>
    <label>Scoring<select aria-label="Scoring" value={scoring} onChange={(event) => chooseScoring(event.target.value as ScoringFormat)}><option value="rubber">Rubber bridge</option><option value="single">Single deals</option></select></label>
    {scoring === "single" || !rubberUnderway ? <label>{scoring === "rubber" ? "First dealer" : "Dealer"}<select aria-label="Dealer" value={dealer} onChange={(event) => setDealer(event.target.value as Seat)}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label> : null}
    {scoring === "single" ? <label>Vulnerability<select aria-label="Vulnerability" value={vulnerability} onChange={(event) => setVulnerability(event.target.value as Vulnerability)}>{vulnerabilities.map((value) => <option key={value} value={value}>{value === "None" ? "None" : value === "Both" ? "Both" : `${value} vulnerable`}</option>)}</select></label> : null}
    <label>Opponents<select aria-label="Opponents" value={playAgainstBots ? "bots" : "manual"} onChange={(event) => setPlayAgainstBots(event.target.value === "bots")}><option value="manual">Manual table</option><option value="bots">Bots</option></select></label>
    {playAgainstBots ? <><label>Your seat<select aria-label="Your seat" value={userSeat} onChange={(event) => setUserSeat(event.target.value as Seat)}>{seats.map((seat) => <option key={seat} value={seat}>{seatNames[seat]}</option>)}</select></label><BotCastFields cast={cast} onChange={setCast} records={castRecords} own={ownCharacters} onOwnChange={saveOwn} initialEditing={preview?.editingCharacter} />{castHasCustom(cast, ownCharacters) ? <><label>Bot skill<select aria-label="Bot skill" value={botSkill} onChange={(event) => setBotSkill(event.target.value as SkillLevel)}><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select></label><label>Bot aggressiveness<select aria-label="Bot aggressiveness" value={botAggression} onChange={(event) => setBotAggression(event.target.value as Aggression)}>{aggressionOptions}</select></label></> : null}<label>Bot bidding style<select aria-label="Bot bidding style" value={biddingStyle} onChange={(event) => setBiddingStyle(event.target.value as "SAYC" | "2/1")}><option value="SAYC">Basic SAYC</option><option value="2/1">Basic 2/1</option></select></label></> : null}
    <label className="setup-check"><input type="checkbox" checked={hintsOn} onChange={toggleHints} />Show hints while bidding and playing</label>
    <label className="setup-check"><input type="checkbox" checked={forcedPlayOn} onChange={toggleForcedPlay} />Play forced cards automatically</label>
  </>;
  const pbnImportForm = <details className="pbn-import">
      <summary>Import a PBN deal</summary>
    <form onSubmit={(event) => { event.preventDefault(); importHand(); }}>
      <label htmlFor="pbn-input">PBN deal</label>
      <p>Select a PBN and USEBIO XML file together to compare a club traveller with its boards.</p>
      <input ref={pbnFileInput} aria-label="Hand records and optional USEBIO results" type="file" accept=".pbn,.lin,.xml,.txt,.json,text/plain,application/xml,application/json" multiple onChange={(event) => { void importSelectedPbnFile(event); }} hidden />
      <button className="secondary-button" type="button" onClick={() => { void choosePbnFile(); }}>Choose file</button>
      <textarea id="pbn-input" value={pbnInput} onChange={(event) => setPbnInput(event.target.value)} placeholder={'[Dealer "N"]\n[Vulnerable "None"]\n[Deal "N:..."]'} />
      <button className="secondary-button" type="submit">Import hand</button>
    </form>
    <p>Practice with the <a className="secondary-button" href={sampleBoardSetUrl} download="bridge-training-ruffing-short-hand-level-1.pbn">8-board CC0 sample set</a> from <a href="https://www.bridge-training.com/en/themes/short-hand-ruff/">Bridge Training</a>.</p>
  </details>;
  // Account caches can hold the same table hand; list it once while retaining each owner's retry copy.
  const recentHands = newestHands(soloData.completedHands).filter((hand, index, hands) => hands.findIndex(candidate => candidate.id === hand.id) === index);
  const recentHandsPanel = <section className="recent-panel" aria-label="Recent hands">
    <div className="section-heading"><h2>Recent hands</h2><span className="auction-count">{recentHands.length}</span></div>
    {recentHands.length ? <ul className="recent-list">{recentHands.map((hand) => <li key={hand.id}>
      <button className="review-link" aria-label={`Review ${savedHandName(hand)}, played ${playedOn(hand)}`} onClick={() => openReview(hand)}><strong>{savedHandName(hand)}</strong><span>Played {playedOn(hand)}</span></button>
      <div className="recent-actions">{(!hand.record || hand.record.event === "Previous attempts") && !hand.pbnMetadata && hand.game.score ? <button onClick={() => replaySavedDeal(hand)} aria-label={`Play this deal again from ${savedHandName(hand)}`}>Play this deal again</button> : null}<button onClick={() => downloadHand(hand.id)} aria-label={`Export PBN of ${savedHandName(hand)}`}>Export PBN</button><button onClick={() => removeHand(hand.id)} aria-label={`Delete ${savedHandName(hand)}`}>Delete</button></div>
    </li>)}</ul> : <p className="quiet-copy">Finished hands will be saved here for review.</p>}
    {partnerRecords.length ? <><h3>Your partners</h3><ul className="recent-list partner-results" aria-label="Your partners">{partnerRecords.map((stats) =>
      <li key={stats.partner}><div className="review-link"><strong>{castMemberName(stats.partner, ownCharacters, partnerResults)}</strong>
        <span>{partnerSummary(stats)}{stats.declared ? ` · made ${stats.made} of ${stats.declared} contracts you declared` : ""}{editedNote(stats.partner, ownCharacters, partnerResults)}</span></div></li>)}</ul></> : null}
    {castRecords.opponents.length ? <><h3>Your opponents</h3><ul className="recent-list partner-results" aria-label="Your opponents">{castRecords.opponents.map((stats) =>
      <li key={stats.opponent}><div className="review-link"><strong>{castMemberName(stats.opponent, ownCharacters, partnerResults)}</strong><span>{opponentSummary(stats)}{editedNote(stats.opponent, ownCharacters, partnerResults)}</span></div></li>)}</ul></> : null}
    {boardSetLibrary.length ? <><h3>Imported board sets</h3><ul className="recent-list">{boardSetLibrary.map((entry) => <li key={entry.id}>
      <div className="review-link"><strong>{entry.name}</strong><span>{entry.completed ? `Complete · ${entry.records.length} boards` : `${entry.progress} of ${entry.records.length} played`}</span></div>
      <div className="recent-actions"><button type="button" onClick={() => resumeBoardSet(entry)}>Resume</button><button type="button" onClick={() => resumeBoardSet(entry, true)}>Restart</button><button type="button" onClick={() => { void exportBoardSet(entry); }}>Export backup</button><button type="button" onClick={() => deleteBoardSet(entry)}>Delete</button></div>
    </li>)}</ul></> : null}
  </section>;
  const fullscreenButton = <><FullscreenButton fullscreen={fullscreen} onToggle={toggleFullscreen} /><ReloadButton /></>;
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
          <button className="primary-button" disabled={replayPending} onClick={startHand}>Start a new hand</button>
          {online ? <button className="secondary-button" type="button" onClick={goOnline}>Lobby</button> : null}
          {soloData.completedHands.length || boardSetLibrary.length || partnerResults.length ? <button className="secondary-button" type="button" onClick={() => setDialog("hands")}>Recent hands</button> : null}
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
  // The seat drawn at the bottom edge: the user against bots (or, once dummy is down, the bot partner's declaring hand
  // they play), otherwise declarer (so dummy faces them) or South.
  const bottomSeat: Seat = playAgainstBots ? bottomSeatFor(shownGame, userSeat, true) : contract ? contract.declarer : "south";
  const canAct = canShowHand && !!game && !!actor;
  const showBottomHand = playAgainstBots || isReviewing || botsFinishing;
  // The hand whose points the hints show during the auction: the one the hand zone shows.
  const auctionHandSeat: Seat | undefined = canAct ? actor : showBottomHand ? bottomSeat : undefined;
  const showCalls = phase !== "play" || auctionShown;
  const reviewedClaim = reviewedGame && reviewCursor > 0 ? reviewedGame.history.actions[reviewCursor - 1] : undefined;
  const statusText = reviewedGame
    ? reviewedClaim?.type === "claim" && contract
      ? claimText(reviewedClaim, contract.declarer, remainingTricks(reviewedGame))
      : `${original ? "Original play: action" : "Reviewing action"} ${reviewCursor} of ${handCount}`
    : liveTurn && activeQueued && !canAct ? `Queued: ${cardLabel(activeQueued.card)}`
    // Against bots, your own turns read as they do online.
    : liveTurn && playAgainstBots && canAct ? (phase === "auction" ? "Your call" : actor === userSeat ? "Your play" : actor === contract?.declarer ? "Play declarer's hand" : "Play from dummy")
    : liveTurn ? `${botsFinishing || (playAgainstBots && shownActor !== userSeat && !userControlsDeclaringSide) ? `${castCharacterAt(cast, shownActor!, userSeat, ownCharacters)?.name ?? "Bot"} · ` : ""}${seatNames[shownActor!]} to ${phase === "auction" ? "bid" : "play"}` : phaseLabel;

  // The same game menu as at an online table: the hand's actions first, then this device's settings and hands, and
  // dealing again (which abandons a hand in progress) set apart at the end.
  const handLive = !isReviewing && liveTurn;
  // The live hand counts towards the rubber when it was dealt for it, whatever the scoring choice for the next deal.
  const inRubber = !isReviewing && !!currentHandId && rubber.activeHandId === currentHandId;
  const menuItems: GameMenuItem[] = isReviewing ? [
    original
      ? { id: "exit-review", label: "Back to your result", onSelect: backToResult }
      : { id: "exit-review", label: "Exit review", onSelect: exitReview },
    { id: "hands", label: "Recent hands", onSelect: () => setDialog("hands") },
    { id: "about", label: "About ContractPlay", onSelect: () => setDialog("about") }
  ] : [
    ...(benchmarkPractice && onExitBenchmarkPractice ? [{ id: "benchmark-return", label: "Return to benchmark replay", onSelect: onExitBenchmarkPractice }] : []),
    ...(online ? [{ id: "online", label: "Online tables", title: "Go to the online lobby; this hand is kept for later", onSelect: goOnline }] : []),
    ...(claimSeat !== undefined && !soloClaimPending && !pickingClaim ? [{ id: "claim", label: "Claim", title: "Claim some or all of the remaining tricks", onSelect: () => setClaimPickedAt(game) }] : []),
    { id: "take-back", label: "Take back", disabled: !game || game.history.cursor === 0, title: "Undo the last call or card to choose again", onSelect: takeBack },
    ...(handLive && !botsFinishing ? [{ id: "auto-play", label: "Auto play this hand",
      title: "A bot makes your calls and plays your cards until this hand ends, then you play again", onSelect: () => setBotsFinishHandId(currentHandId) }] : []),
    ...(benchmarkPractice ? [] : [{ id: "settings", label: "Settings", title: "Scoring, dealer, opponents, hints, and forced cards for the next deal", onSelect: () => setDialog("settings") }]),
    ...(scoring === "rubber" || inRubber ? [{ id: "rubber", label: "Scores", title: "The rubber scorecard: above and below the line, games, totals, and the last hand's points", onSelect: () => setDialog("rubber") }] : []),
    ...(benchmarkPractice ? [] : [{ id: "hands", label: "Recent hands", title: "Review, export, or import hands", onSelect: () => setDialog("hands") }]),
    { id: "about", label: "About ContractPlay", onSelect: () => setDialog("about") },
    ...(benchmarkPractice && onExitBenchmarkPractice ? [
      { id: "deal", label: "Finish practice", title: "Return to this benchmark replay", onSelect: onExitBenchmarkPractice }
    ] : boardSet ? [
      { id: "leave-set", label: "Leave the board set", title: "Stop playing this board set; this hand stays on the table", onSelect: () => setBoardSet(undefined) },
      boardSet.position + 1 < boardSet.records.length
        ? { id: "deal", label: "Next board", ...(handLive ? { tone: "danger" as const, title: "Abandon this board and play the next" } : {}), onSelect: advanceBoardSet }
        : { id: "deal", label: "Finish board set", title: "End the board set; this hand stays on the table", onSelect: finishBoardSet }
    ] : [
      { id: "deal", label: "Deal a new hand", disabled: replayPending, ...(handLive ? { tone: "danger" as const, title: "Abandon this hand and deal a new one" } : {}), onSelect: startHand }
    ])
  ];
  const tableTools = <>
    <GameMenu items={menuItems} defaultOpen={preview?.menuOpen ?? false} />
    {fullscreenButton}
  </>;

  // At the end of a rubber hand the scorecard offers the next deal, or once the rubber is won, another rubber or the
  // online tables; Close puts it away to look at the cards (Scores in the menu brings it back).
  const scorecardClosed = !!currentHandId && closedScorecard === currentHandId;
  const scorecardActions = <>
    <button className="primary-button" type="button" autoFocus disabled={replayPending} onClick={startHand}>{rubberSummary.winner ? "Play another rubber" : "Next deal"}</button>
    {rubberSummary.winner && online ? <button className="secondary-button" type="button" onClick={goOnline}>Online tables</button> : null}
    <button className="secondary-button" type="button" onClick={() => setClosedScorecard(currentHandId)}>Close</button>
  </>;
  const duplicateScore = shownGame.score?.score ?? 0;
  // A board-set hand's result is set against the field; the original table's play is a review of its own, without one.
  const shownRecord = original ? undefined : selectedHand ? selectedHand.record : currentRecord;
  // While a board set is active, the result moves on through the set instead of dealing afresh.
  const nextButton = isReviewing ? null : benchmarkPractice && onExitBenchmarkPractice
    ? <button className="primary-button" type="button" onClick={onExitBenchmarkPractice}>Finish practice</button>
    : boardSet
    ? boardSet.position + 1 < boardSet.records.length
      ? <button className="primary-button" type="button" onClick={advanceBoardSet}>Next board</button>
      : <button className="primary-button" type="button" onClick={finishBoardSet}>Finish board set</button>
    : <button className="primary-button" type="button" disabled={replayPending} onClick={startHand}>Next deal</button>;
  const handOver = phase === "complete" || phase === "passed-out";
  const fieldResult = shownRecord ? <FieldResult
    record={shownRecord}
    nsScore={duplicateScore}
    showPoints={phase === "complete"}
    side={partnership(selectedHand?.playerSeat ?? (playAgainstBots ? userSeat : "south"))}
    {...(!isReviewing && boardSet ? { label: boardLabel(boardSet) } : {})}
    actions={<>
      {handOver && replayOriginal(shownRecord) ? <button className="secondary-button" type="button" onClick={() => viewOriginal(shownRecord)}>View original play</button> : null}
      {nextButton}
    </>} /> : null;
  // A replayed rubber hand is still set against the deal's earlier results, above the scorecard.
  const replayResult = inRubber && currentRecord?.replay ? <FieldResult record={currentRecord} nsScore={duplicateScore} showPoints={phase === "complete"} side={partnership(playAgainstBots ? userSeat : "south")} /> : null;
  // The original table's result is marked as such, with the way back to the player's own result on it.
  const originalTag = original ? <p className="original-tag">At the original table</p> : null;
  const backButton = original ? <button className="primary-button" type="button" onClick={backToResult}>{selectedHand ? "Back to the review" : "Back to your result"}</button> : null;
  const tableOverlay = <>
    {phase === "complete" && shownGame.score && contract && !(inRubber && scorecardClosed) ? <section className={`score-panel ${inRubber ? "scorecard-panel" : ""} ${displayedTrick.length ? "score-panel-hidden" : ""}`} aria-label="Hand result">
      {originalTag}
      <h2>{contractText(contract)} by {seatNames[contract.declarer]}</h2>
      <ContractOutcome score={shownGame.score} />
      {shownGame.claim ? <p className="claim-line">{claimText(shownGame.claim, contract.declarer, remainingTricks(shownGame))}</p> : null}
      {inRubber ? <>{replayResult}<Scorecard summary={rubberSummary} hands={cardHands} names={sideNames} actions={scorecardActions} /></> : fieldResult ?? <>
        <p className="hand-points-line">{`${duplicateScore >= 0 ? "NS" : "EW"} +${Math.abs(duplicateScore)}`}</p>
        {nextButton}{backButton}
      </>}
    </section> : null}
    {phase === "passed-out" && !(inRubber && scorecardClosed) ? <section className={`score-panel ${inRubber ? "scorecard-panel" : ""}`} aria-label="Hand result">{originalTag}<h2>Passed out</h2>
      {inRubber ? <>{replayResult}<Scorecard summary={rubberSummary} hands={cardHands} names={sideNames} passedOut actions={scorecardActions} /></>
        : fieldResult ?? <>{nextButton}{backButton}</>}
    </section> : null}

    {isReviewing ? <div className="history-controls review-controls" role="group" aria-label="Review controls">
      <button className="secondary-button" aria-label="Previous action" disabled={reviewCursor === 0} onClick={() => setReviewCursor((cursor) => Math.max(0, cursor - 1))}><span aria-hidden="true">‹</span> Previous</button>
      <button className="secondary-button" aria-label="Next action" disabled={reviewCursor >= handCount} onClick={() => setReviewCursor((cursor) => Math.min(handCount, cursor + 1))}>Next <span aria-hidden="true">›</span></button>
      {original ? <button className="secondary-button" type="button" onClick={backToResult}>{selectedHand ? "Back to the review" : "Back to your result"}</button>
        : <button className="secondary-button" type="button" onClick={exitReview}>Exit review</button>}
    </div> : null}

    {!isReviewing && liveTurn ? <div className="hint-controls">
      {hintsOn && phase === "auction" && auctionHandSeat ? <strong className="hand-points" aria-label={`${highCardPoints(shownGame.hands[auctionHandSeat])} high-card points`}>{highCardPoints(shownGame.hands[auctionHandSeat])} HCP</strong> : null}
      {visibleBidHint && phase === "auction" ? <p role="status"><strong>Suggested: {compactCallLabel(visibleBidHint.bid)}</strong> {visibleBidHint.reason}</p> : null}
      {visibleHint && phase === "play" ? <p role="status">{visibleHint.reason}</p> : null}
      <button className="secondary-button hint-toggle" type="button" role="switch" aria-checked={hintsOn} title={hintsOn ? "Hide hints" : "Show hints: your points and suggested bids and cards"} onClick={toggleHints}>Hints<span className="hint-switch" aria-hidden="true" /></button>
    </div> : null}

    {pickingClaim && game ? <ClaimPanel mode="pick" remaining={remainingTricks(game)} onClaim={claim} onCancel={() => setClaimPickedAt(undefined)} />
      : soloClaimPending && soloClaim ? <ClaimPanel mode="pending" text={`${pendingClaimText(soloClaim, remainingTricks(soloClaim.game), true)}. Checking…`} onWithdraw={() => setSoloClaim(undefined)} />
      : null}

    {botsFinishing && handLive ? <DraggableBanner className="online-resume" storageKey={autoPlayBannerKey} label="Auto play is on">
      <span>Auto play: a bot plays for you until this hand ends.</span>
      <button className="primary-button" type="button" onClick={() => setBotsFinishHandId(undefined)}>Stop auto play</button>
    </DraggableBanner> : null}

    {!isReviewing && currentRecord?.replay ? <p className="replay-notice" role="status">{replayNotice(currentRecord.replay.firstPlayedAt, true)}</p> : null}
    {message ? <p className="error-message" role="alert">{message}</p> : null}
  </>;

  return (
    <main className={`app-shell ${fullscreen ? "is-fullscreen" : ""}`}>
      {benchmarkPractice ? <p className="benchmark-practice-banner">Practice board {benchmarkPractice.record.board} as {benchmarkPractice.benchmark.profileId} · benchmark {benchmarkPractice.benchmark.sideScore} {benchmarkPractice.benchmark.side}</p> : null}
      <div className={`game-layout ${phase === "auction" ? "auction-layout" : phase === "play" ? "play-layout" : ""}`}>
        <TableView
          game={shownGame}
          bottomSeat={bottomSeat}
          botSeats={playAgainstBots ? seats.filter((seat) => seat !== userSeat) : undefined}
          seatLabel={(seat) => {
            const character = playAgainstBots ? castCharacterAt(cast, seat, userSeat, ownCharacters) : undefined;
            return character ? <span className="online-seat-label bot-name-tag" title={`${character.name}: ${character.blurb}`}><span className="online-seat-name">{character.name}</span></span> : null;
          }}
          actingSeat={canAct ? actor : undefined}
          displayedTrick={displayedTrick}
          showCalls={showCalls}
          onToggleCalls={() => setAuctionShown((shown) => !shown)}
          lastTrickOpen={lastTrickOpen}
          onToggleLastTrick={() => setLastTrickOpen((open) => !open)}
          showBottomHand={showBottomHand}
          // Once the last trick has cleared, the whole deal is laid face-up around the result.
          revealedHands={displayedTrick.length ? undefined : shownGame.initialDeal}
          dealing={dealing && !isReviewing}
          cardsDisabled={!!temporaryTrick || pickingClaim || soloClaimPending}
          queueSeats={canAct ? [] : queueOwnerSeats}
          queuedCard={activeQueued}
          onQueue={(seat, card) => setQueued((current) => current?.seat === seat && cardId(current.card) === cardId(card) ? undefined : { handKey: currentHandId, seat, card })}
          statusText={statusText}
          boardLabel={!isReviewing && boardSet ? boardLabel(boardSet) : undefined}
          ariaLabel={isReviewing ? "Hand review" : "Bridge table"}
          onBid={(bid) => { if (game) submitAction({ type: "bid", seat: game.currentActor, bid }); }}
          onPlay={(seat, card) => submitAction({ type: "play", seat, card })}
          hintedBid={visibleBidHint?.bid}
          hintedCards={visibleHint?.cardIds}
          explainCall={{
            shown: shownExplanation,
            onToggle: (index) => setExplainedCall(shownExplanation === index ? undefined : { key: callsKey, index }),
            text: (index) => {
              const seat = shownGame.auction[index]!.seat;
              return explainBid(shownGame.auction, index, biddingStyle, playAgainstBots && seat !== userSeat ? botSettingsAt({ cast, botSkill, botAggression }, seat, userSeat, ownCharacters).skill : "expert");
            }
          }}
          tools={tableTools}
          overlay={tableOverlay}
        />
      </div>
      {menuDialog}
    </main>
  );
}
