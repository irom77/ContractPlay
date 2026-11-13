import { useEffect, useRef, useState } from "react";
import { cardId, emptyRubber, forcedCard, summarizeRubber, type Bid, type GameAction, type PlayContext, type Seat, type TrickCard } from "@contractplay/core";
import { loadSoloData, saveSoloData, type StorageLike } from "@contractplay/persistence";
import type { PublicGame, RefusalReason, SeatInfo, TableView as TableViewData } from "@contractplay/protocol";
import { explainBid, highCardPoints, suggestBid, suggestPlay } from "@contractplay/bots";
import { createHandName, handNameFromId } from "../handNames.js";
import { GameMenu, type GameMenuItem } from "../table/GameMenu.js";
import { FORCED_PLAY_MS, forcedPlayEnabled } from "../table/forcedPlay.js";
import { queuedPlay, queueStillValid, type QueuedCard } from "../table/queuedCard.js";
import { TableView } from "../table/TableView.js";
import { ClaimPanel } from "../table/ClaimPanel.js";
import { DraggableBanner } from "../table/DraggableBanner.js";
import { handsOnCard, playerSideNames, Scorecard } from "../table/Scorecard.js";
import { cardLabel, claimRejectedText, compactCallLabel, pendingClaimText, isCallAvailable, partnerOf, samePartnership, seatNames, seats as seatOrder } from "../table/labels.js";
import { connectTable as defaultConnect, type ConnectionStatus, type TableConnection } from "./connection.js";
import { loadIdentity, type Identity } from "./identity.js";
import { NameGate } from "./Lobby.js";
import { savedHandFrom } from "./savedHand.js";
import { HandResultSummary, SeatingPanel, type Outgoing } from "./SeatingPanel.js";

/** How long the host waits on a present player's turn before "Hand to a bot" is offered (the service's limit). */
const IDLE_MS = 120_000;
const TRICK_HOLD_MS = 2000;
const NOTICE_MS = 5000;
const HISTORY_LIMIT = 25;
const HINTS_STORAGE_KEY = "contractplay.hints";
/** Where the player last dragged the Auto play / bot-playing banner. */
const resumeBannerKey = "contractplay.resumeBanner";

export type OnlineTableProps = {
  baseUrl: string; tableId: string; storage: StorageLike; onLeave(): void;
  /** Opens the device's recent hands, where finished online hands are saved; the seat is kept as with Back to lobby. */
  onRecentHands(): void; connect?: typeof defaultConnect;
  /** Opens the game menu on arrival (the UI previews show it this way). */
  menuOpen?: boolean;
  /** Opens the Rubber score dialog on arrival (the UI previews show it this way). */
  rubberOpen?: boolean;
  /** Starts with this card queued (the UI previews show a queued card this way). */
  initialQueued?: QueuedCard;
};

function refusalText(reason: RefusalReason): string | undefined {
  if (reason === "stale") return undefined;
  if (reason === "seat-taken") return "That seat was just taken.";
  if (reason === "not-your-turn") return "It isn't your turn.";
  return "That isn't possible right now.";
}

const isLive = (game: PublicGame | undefined): boolean => game?.phase === "auction" || game?.phase === "play";

/** Calls and cards so far in the hand; it goes down only when someone takes an action back. */
const actionCount = (game: PublicGame | undefined): number =>
  game ? game.auction.length + game.completedTricks.length * 4 + game.currentTrick.length : 0;

/** The seat that decides a card for `seat`, including a human dummy taking over for a bot declarer. */
function cardDecider(game: PublicGame, seats: TableViewData["seats"], seat: Seat): Seat {
  const declarer = game.contract?.declarer;
  if (!declarer) return seat;
  const dummy = partnerOf(declarer);
  const dummyInfo = seats[dummy];
  const humanDummyControls = seats[declarer].kind === "bot" && dummyInfo.kind === "human" &&
    (dummyInfo.standIn !== undefined || !dummyInfo.away);
  if (humanDummyControls && (seat === declarer || seat === dummy)) return dummy;
  return seat === dummy ? declarer : seat;
}

/** The seat that decides the current turn. */
function deciderOf(game: PublicGame, seats: TableViewData["seats"]): Seat {
  return game.phase === "play" ? cardDecider(game, seats, game.currentActor) : game.currentActor;
}

/**
 * Seats whose queued card the viewer keeps during play: every seat whose cards the viewer decides (their own, dummy's
 * as declarer, or both declaring hands as a human dummy for a bot declarer). None while a bot plays for the viewer or
 * a claim is pending.
 */
function queueOwnerSeats(view: TableViewData): Seat[] {
  const game = view.game;
  const yourSeat = view.yourSeat;
  if (!game || !yourSeat || game.phase !== "play" || view.claim) return [];
  const mine = view.seats[yourSeat];
  if (mine.kind === "human" && mine.standIn !== undefined) return [];
  return seatOrder.filter((seat) => cardDecider(game, view.seats, seat) === yourSeat);
}

/**
 * Whether `yourSeat` has a call or card the service would let them take back: their most recent decision,
 * with only bots (or stand-ins) acting since. Mirrors the service's rule so the menu entry is enabled only when it works.
 */
function canTakeBack(game: PublicGame, seats: TableViewData["seats"], yourSeat: Seat): boolean {
  const mine = seats[yourSeat];
  if (!isLive(game) || (mine.kind === "human" && mine.standIn !== undefined)) return false;
  const deciders = [
    ...game.auction.map((call) => call.seat),
    ...[...game.completedTricks.flat(), ...game.currentTrick].map((play) => cardDecider(game, seats, play.seat))
  ];
  for (const decider of deciders.reverse()) {
    if (decider === yourSeat) return true;
    const info = seats[decider];
    if (info.kind === "human" && info.standIn === undefined) return false;
  }
  return false;
}

/** Adds the finished hand to the device's hand history unless a hand with its id is already there. */
function saveToHistory(storage: StorageLike, view: TableViewData): void {
  try {
    const data = loadSoloData(storage);
    const id = `online-${view.id}-${view.handNumber}`;
    if (data.completedHands.some((hand) => hand.id === id)) return;
    const hand = savedHandFrom(view, id, new Date().toISOString());
    if (!hand) return;
    const name = createHandName(new Set(data.completedHands.map((saved) => saved.name ?? handNameFromId(saved.id))));
    saveSoloData(storage, { ...data, completedHands: [{ ...hand, name }, ...data.completedHands].slice(0, HISTORY_LIMIT) });
  } catch {
    // Storage is full or unavailable: the hand is simply not kept.
  }
}

type Hold = { handNumber: number; cards: readonly TrickCard[] };
type Received = { view?: TableViewData; hold?: Hold };

/**
 * The hold that goes with an incoming view, worked out in the same update that stores the view so the
 * completed trick is on screen in the very first render of that view: a new hold when the view completes
 * a trick, none in a new hand, otherwise the current one until its timer ends it.
 */
function receive(previous: Received, view: TableViewData): Received {
  const before = previous.view;
  if (!before || before.handNumber !== view.handNumber) return { view };
  const completed = view.game?.completedTricks ?? [];
  if (completed.length > (before.game?.completedTricks.length ?? 0)) return { view, hold: { handNumber: view.handNumber, cards: completed.at(-1) ?? [] } };
  return previous.hold ? { view, hold: previous.hold } : { view };
}

function publicPlayContext(game: PublicGame): PlayContext {
  const seat = game.currentActor;
  const contract = game.contract;
  const visibleSeat = contract
    ? seat === partnerOf(contract.declarer) ? contract.declarer : partnerOf(contract.declarer)
    : undefined;
  const dummyVisible = game.currentTrick.length > 0 || game.completedTricks.length > 0;
  const visibleHand = dummyVisible && visibleSeat && game.hands[visibleSeat].length ? game.hands[visibleSeat] : undefined;
  return {
    seat,
    hand: game.hands[seat],
    currentTrick: game.currentTrick,
    ...(game.currentTrick[0] ? { ledSuit: game.currentTrick[0].card.suit } : {}),
    ...(contract?.strain !== "notrump" && contract ? { trump: contract.strain } : {}),
    ...(contract ? { declarer: contract.declarer } : {}),
    ...(visibleHand ? { visibleHand } : {}),
    played: game.completedTricks.flatMap((trick) => trick.map(({ card }) => card))
  };
}

export function OnlineTable({ storage, onLeave, ...props }: OnlineTableProps) {
  const [identity, setIdentity] = useState<Identity | undefined>(() => loadIdentity(storage));
  if (!identity) return <NameGate storage={storage} onSaved={setIdentity} secondary={{ label: "Back to lobby", onClick: onLeave }} />;
  return <ConnectedTable {...props} storage={storage} onLeave={onLeave} identity={identity} />;
}

function ConnectedTable({ baseUrl, tableId, storage, onLeave, onRecentHands, identity, connect = defaultConnect, menuOpen = false, rubberOpen = false, initialQueued }: OnlineTableProps & { identity: Identity }) {
  const [{ view, hold }, setReceived] = useState<Received>({});
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [notice, setNotice] = useState<{ text: string }>();
  // True from sending a call or card until the service answers with any view or refusal.
  const [waiting, setWaiting] = useState(false);
  const [lastTrickOpen, setLastTrickOpen] = useState(false);
  const [auctionShown, setAuctionShown] = useState(false);
  const [turn, setTurn] = useState<{ key: string; since: number }>();
  const [idleTurn, setIdleTurn] = useState<string>();
  const [copyNote, setCopyNote] = useState<string>();
  const [hintsOn, setHintsOn] = useState(() => {
    try { return storage.getItem(HINTS_STORAGE_KEY) === "on"; } catch { return false; }
  });
  const [bidHint, setBidHint] = useState<{ view: TableViewData; bid: Bid; reason: string }>();
  const [playHint, setPlayHint] = useState<{ view: TableViewData; cardIds: ReadonlySet<string>; reason: string }>();
  // True from asking to leave the seat until the service confirms it (a view without a seat) or refuses.
  const [leaving, setLeaving] = useState(false);
  const [explainedCall, setExplainedCall] = useState<{ handNumber: number; auctionLength: number; index: number }>();
  const connection = useRef<TableConnection | undefined>(undefined);
  const previousHand = useRef<number | undefined>(undefined);
  const [forcedPlayOn] = useState(() => forcedPlayEnabled(storage));
  // A take-back is on its way; the view it brings is remembered so a forced card there waits for the player.
  const takeBackSent = useRef(false);
  const [takenBackTo, setTakenBackTo] = useState<number>();
  // A card picked before the viewer's turn, sent for them when it comes.
  const [queued, setQueued] = useState<QueuedCard | undefined>(initialQueued);
  // The hand and action count of the last view: a lower count in the same hand is a take-back, by anyone.
  const lastActions = useRef<{ handNumber: number; count: number } | undefined>(undefined);
  // The revision the claim picker was opened at; it closes when the table moves on.
  const [claimPickedAt, setClaimPickedAt] = useState<number>();
  // The finished hand whose result table the viewer left for the seating screen.
  const [seatingAfter, setSeatingAfter] = useState<number>();
  const [rubberShown, setRubberShown] = useState(rubberOpen);
  // The finished hand whose result card the player closed to look at the cards.
  const [closedResult, setClosedResult] = useState<number | undefined>(undefined);
  const queueOwners = view ? queueOwnerSeats(view) : [];
  const activeQueued = queued && view?.game && queueOwners.includes(queued.seat) && queueStillValid(view.game, queued, String(view.handNumber), !!view.claim) ? queued : undefined;

  useEffect(() => {
    const current = connect({
      baseUrl, tableId, identity,
      onView: (next) => {
        setReceived((previous) => receive(previous, next));
        setWaiting(false);
        // A take-back by anyone clears the queue: the card was picked for a position that no longer exists.
        const count = actionCount(next.game);
        if (lastActions.current?.handNumber === next.handNumber && count < lastActions.current.count) setQueued(undefined);
        lastActions.current = { handNumber: next.handNumber, count };
        if (takeBackSent.current) { takeBackSent.current = false; setTakenBackTo(next.revision); }
      },
      onRefused: (reason) => {
        takeBackSent.current = false;
        setWaiting(false);
        setLeaving(false);
        const text = refusalText(reason);
        setNotice(text === undefined ? undefined : { text });
      },
      onStatus: (next) => {
        setStatus(next);
        // Dropped on any break in the connection: the table may have moved on while this client was away.
        if (next !== "open") setQueued(undefined);
      }
    });
    connection.current = current;
    return () => { current.close(); if (connection.current === current) connection.current = undefined; };
  }, [baseUrl, tableId, identity, connect]);

  // Only ending the hold is timed; starting it happens with the view (see `receive`).
  useEffect(() => {
    if (!hold) return;
    const timer = setTimeout(() => setReceived((current) => current.hold === hold ? (current.view ? { view: current.view } : {}) : current), TRICK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [hold]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice((current) => current === notice ? undefined : current), NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);

  // Per view: reset per-hand display state, note when the turn changed, and keep a finished hand.
  useEffect(() => {
    if (!view) return;
    const game = view.game;
    if (previousHand.current !== view.handNumber) {
      previousHand.current = view.handNumber;
      setLastTrickOpen(false);
      setAuctionShown(false);
      setNotice(undefined);
    }
    if (game && game.currentTrick.length > 0) setLastTrickOpen(false);

    // The host's two-minute clock starts when this client first sees the turn, not when the service began it.
    const key = game && isLive(game) ? `${view.handNumber}:${deciderOf(game, view.seats)}:${game.auction.length + game.completedTricks.length * 4 + game.currentTrick.length}` : undefined;
    setTurn((known) => key === undefined ? undefined : known?.key === key ? known : { key, since: Date.now() });

    if (view.revealed && game?.phase === "complete") saveToHistory(storage, view);
  }, [view, storage]);

  useEffect(() => {
    if (!turn) return;
    const timer = setTimeout(() => setIdleTurn(turn.key), Math.max(0, turn.since + IDLE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [turn]);

  useEffect(() => {
    if (leaving && view && !view.yourSeat) onLeave();
  }, [leaving, view, onLeave]);

  const toggleHints = () => setHintsOn((current) => {
    const next = !current;
    try { storage.setItem(HINTS_STORAGE_KEY, next ? "on" : "off"); } catch { /* Hints remain available for this visit. */ }
    return next;
  });

  useEffect(() => {
    if (!view?.game || !view.yourSeat || !hintsOn || !isLive(view.game)) return;
    const game = view.game;
    const seat = game.currentActor;
    const seatInfo = view.seats[view.yourSeat];
    const hasStandIn = seatInfo.kind === "human" && seatInfo.standIn !== undefined;
    const canHint = !hasStandIn && deciderOf(game, view.seats) === view.yourSeat;
    if (!canHint) return;
    let cancelled = false;
    const failed = () => { if (!cancelled) setNotice({ text: "Unable to get a hint. Please try again." }); };
    if (game.phase === "auction") {
      suggestBid(game.hands[seat], game.auction, seat, view.style).then((suggestion) => {
        if (!cancelled && isCallAvailable(game, suggestion.bid)) setBidHint({ view, ...suggestion });
      }).catch(failed);
    } else {
      suggestPlay(publicPlayContext(game)).then(({ card, reason }) => {
        if (!cancelled) setPlayHint({ view, cardIds: new Set([cardId(card)]), reason });
      }).catch(failed);
    }
    return () => { cancelled = true; };
  }, [view, hintsOn]);

  // A card the player must play (the only legal one) is sent for them after a short pause.
  const holdingNow = hold !== undefined && hold.handNumber === view?.handNumber;
  useEffect(() => {
    const game = view?.game;
    if (!forcedPlayOn || !game || !view.yourSeat || game.phase !== "play" || view.claim || waiting || status !== "open" || holdingNow) return;
    // Not while the claim picker is open: the player is deciding whether to play on at all.
    if (view.revision === takenBackTo || view.revision === claimPickedAt) return;
    const mine = view.seats[view.yourSeat];
    if ((mine.kind === "human" && mine.standIn !== undefined) || deciderOf(game, view.seats) !== view.yourSeat) return;
    const card = forcedCard(game);
    if (!card) return;
    const timer = setTimeout(() => {
      setWaiting(true);
      setNotice(undefined);
      connection.current?.send({ type: "act", handNumber: view.handNumber, revision: view.revision, action: { type: "play", seat: game.currentActor, card } });
    }, FORCED_PLAY_MS);
    return () => clearTimeout(timer);
  }, [view, waiting, status, holdingNow, forcedPlayOn, takenBackTo, claimPickedAt]);

  useEffect(() => {
    if (view && queued && !activeQueued) setQueued(undefined);
  }, [view, queued, activeQueued]);

  // The queued card is sent like a forced one, after the same pause. A forced card is that same card, so when the
  // forced-card effect sends this turn's card, this one stays out of it.
  useEffect(() => {
    const game = view?.game;
    if (!activeQueued || !game || !view.yourSeat || game.phase !== "play" || waiting || status !== "open" || holdingNow) return;
    const mine = view.seats[view.yourSeat];
    if ((mine.kind === "human" && mine.standIn !== undefined) || deciderOf(game, view.seats) !== view.yourSeat) return;
    if (view.revision === claimPickedAt || (forcedPlayOn && view.revision !== takenBackTo && forcedCard(game))) return;
    const card = queuedPlay(game, activeQueued, game.currentActor);
    if (!card) return;
    const timer = setTimeout(() => {
      setWaiting(true);
      setNotice(undefined);
      connection.current?.send({ type: "act", handNumber: view.handNumber, revision: view.revision, action: { type: "play", seat: game.currentActor, card } });
    }, FORCED_PLAY_MS);
    return () => clearTimeout(timer);
  }, [view, waiting, status, holdingNow, forcedPlayOn, takenBackTo, activeQueued, claimPickedAt]);

  useEffect(() => {
    setExplainedCall((shown) => shown && (shown.handNumber !== view?.handNumber || shown.auctionLength !== view?.game?.auction.length) ? undefined : shown);
  }, [view?.handNumber, view?.game?.auction.length]);

  useEffect(() => {
    if (explainedCall === undefined) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !(event.target as HTMLElement | null)?.closest?.(".seat-auction-call, .call-meaning")) setExplainedCall(undefined);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, [explainedCall]);

  const send = (message: Outgoing) => {
    setNotice(undefined);
    connection.current?.send(message);
  };

  const backButton = <button className="secondary-button" type="button" onClick={onLeave}>Back to lobby</button>;
  const statusLine = <>
    {status === "reconnecting" ? <p className="online-status" role="status">Reconnecting…</p> : null}
    {status === "reload" ? <div className="online-status" role="status">
      <span>ContractPlay was updated. Reload to keep playing.</span>
      <button className="primary-button" type="button" onClick={() => location.reload()}>Reload</button>
    </div> : null}
    {notice ? <p className="error-message" role="alert">{notice.text}</p> : null}
  </>;

  if (status === "gone") {
    return <main className="app-shell"><section className="empty-table lobby" aria-label="Table closed">
      <div className="lobby-panel"><p>This table no longer exists.</p>{backButton}</div>
    </section></main>;
  }
  if (!view) {
    return <main className="app-shell"><section className="empty-table lobby" aria-label="Joining the table">
      <div className="lobby-panel"><p className="quiet-copy">Connecting…</p>{backButton}</div>
      {statusLine}
    </section></main>;
  }

  // A rubber table scores the rubber in play (or the one just won, until the next deal); older tables keep running totals.
  const rubberSummary = view.scoring === "rubber" ? summarizeRubber(view.rubber ?? emptyRubber()) : undefined;
  const score = rubberSummary ? { ns: rubberSummary.totals.NS, ew: rubberSummary.totals.EW } : view.totals;
  const totals = `${rubberSummary ? "Rubber: " : ""}NS ${score.ns} · EW ${score.ew}`;
  const rubberItem: GameMenuItem[] = rubberSummary
    ? [{ id: "rubber", label: "Scores", title: "The rubber scorecard: above and below the line, games, totals, and the last hand's points", onSelect: () => setRubberShown(true) }]
    : [];
  // The scorecard heads each column with the partnership's players; a passed-out hand just ended scores nothing.
  const sideNames = playerSideNames((seat) => { const info = view.seats[seat]; return info.kind === "human" ? info.name : info.kind === "bot" ? "Bot" : undefined; });
  const cardHands = rubberSummary ? handsOnCard(view.rubber ?? emptyRubber(), rubberSummary) : [];
  const justPassedOut = !view.handInProgress && view.game?.phase === "passed-out";
  const scorecard = (actions?: React.ReactNode) => rubberSummary
    ? <Scorecard summary={rubberSummary} hands={cardHands} names={sideNames} passedOut={justPassedOut} actions={actions} />
    : null;
  const rubberDialog = rubberSummary && rubberShown ? <div className="about-backdrop" onClick={() => setRubberShown(false)}>
    <section className="about-dialog menu-dialog" role="dialog" aria-modal="true" aria-label="Scores" onClick={(event) => event.stopPropagation()}>
      <h2>Scores</h2>
      <section className="rubber-menu" aria-label="Rubber">{scorecard()}</section>
      <button className="primary-button" type="button" autoFocus onClick={() => setRubberShown(false)}>Close</button>
    </section>
  </div> : null;
  // This hand's line on the rubber scoresheet, once it is scored.
  const rubberHand = view.rubber?.hands.find((hand) => hand.handId === view.rubber?.activeHandId);
  const yourSeat = view.yourSeat;
  const game = view.game;
  const holding = hold !== undefined && hold.handNumber === view.handNumber;

  if (yourSeat && game && (isLive(game) || holding)) {
    const live = isLive(game);
    const mine = view.seats[yourSeat];
    const standIn = mine.kind === "human" && mine.standIn !== undefined;
    const decider = deciderOf(game, view.seats);
    const actingSeat = live && !standIn && decider === yourSeat ? game.currentActor : undefined;
    const canHintNow = live && !standIn && decider === yourSeat;
    const visibleBidHint = hintsOn && canHintNow && game.phase === "auction" && bidHint?.view === view ? bidHint : undefined;
    const visiblePlayHint = hintsOn && canHintNow && game.phase === "play" && playHint?.view === view ? playHint : undefined;
    const shownExplanation = explainedCall?.handNumber === view.handNumber && explainedCall.auctionLength === game.auction.length
      ? explainedCall.index
      : undefined;
    const inputDisabled = waiting || status !== "open" || holding;
    const act = (action: GameAction) => {
      if (inputDisabled) return;
      setWaiting(true);
      send({ type: "act", handNumber: view.handNumber, revision: view.revision, action });
    };
    const canHandToBot = (seat: Seat): boolean => {
      const info = view.seats[seat];
      if (!live || seat === yourSeat || info.kind !== "human" || info.standIn !== undefined) return false;
      return info.away || (view.host === yourSeat && decider === seat && idleTurn === turn?.key);
    };
    const isHost = view.host === yourSeat;
    const pendingClaim = view.claim;
    const remaining = 13 - game.completedTricks.length;
    // The service allows one claim per side per trick, and clears `claimRejected` with the next card.
    const ownSideRejected = !!view.claimRejected && samePartnership(view.claimRejected.seat, yourSeat);
    const canClaim = actingSeat !== undefined && game.phase === "play" && !pendingClaim && !ownSideRejected;
    const pickingClaim = canClaim && claimPickedAt === view.revision;
    // The claimer is whoever decides for the claiming side's seat; the opponents asked to answer are in `waitingOn`.
    const isClaimer = !!pendingClaim && cardDecider(game, view.seats, pendingClaim.seat) === yourSeat;
    const answeringClaim = !!pendingClaim && !standIn && pendingClaim.waitingOn.includes(yourSeat);
    const sendClaimMessage = (message: Outgoing) => {
      if (inputDisabled) return;
      setWaiting(true);
      send(message);
    };
    const claimPanel = answeringClaim ? <ClaimPanel mode="answer" text={pendingClaimText(pendingClaim, remaining, false)}
      onAccept={() => sendClaimMessage({ type: "answerClaim", accept: true, claimId: pendingClaim.madeAt })}
      onReject={() => sendClaimMessage({ type: "answerClaim", accept: false, claimId: pendingClaim.madeAt })} />
      : pendingClaim ? <ClaimPanel mode="pending"
        text={`${pendingClaimText(pendingClaim, remaining, isClaimer)}. Waiting for ${pendingClaim.waitingOn.map((seat) => seatNames[seat]).join(", ")}`}
        {...(isClaimer ? { onWithdraw: () => sendClaimMessage({ type: "withdrawClaim" }) } : {})} />
      : pickingClaim ? <ClaimPanel key={view.revision} mode="pick" remaining={remaining} onCancel={() => setClaimPickedAt(undefined)}
        onClaim={(tricks) => { setClaimPickedAt(undefined); sendClaimMessage({ type: "claim", tricks }); }} />
      : null;
    const menuItems: GameMenuItem[] = [
      { id: "lobby", label: "Back to lobby", onSelect: onLeave, title: "Keep your seat and return to the lobby" },
      ...(canClaim && !pickingClaim ? [{ id: "claim", label: "Claim", disabled: inputDisabled,
        title: "Claim some or all of the remaining tricks", onSelect: () => setClaimPickedAt(view.revision) }] : []),
      ...rubberItem,
      { id: "hands", label: "Recent hands", onSelect: onRecentHands, title: "Review finished hands saved on this device; you keep your seat" },
      {
        id: "take-back", label: "Take back", disabled: inputDisabled || !canTakeBack(game, view.seats, yourSeat),
        title: "Undo your last call or card, and any bot play since, to choose again",
        onSelect: () => { if (!inputDisabled) { setWaiting(true); setQueued(undefined); takeBackSent.current = true; send({ type: "takeBack" }); } }
      },
      ...(live && !standIn ? [{ id: "auto-play", label: "Auto play this hand", disabled: status !== "open",
        title: "A bot makes your calls and plays your cards until this hand ends, then you play again", onSelect: () => send({ type: "autoPlay" }) }] : []),
      ...(live && isHost ? [{ id: "cancel", label: "Cancel this hand", tone: "danger" as const, disabled: status !== "open",
        title: "Abandon the hand for everyone, unscored, and return to seating", onSelect: () => send({ type: "cancelHand" }) }] : []),
      { id: "leave", label: "Leave the table", tone: "danger", disabled: status !== "open" || leaving,
        title: live ? "Give up your seat; a bot finishes the hand for you" : "Give up your seat and return to the lobby",
        onSelect: () => { setLeaving(true); send({ type: "leave" }); } }
    ];
    const displayedTrick = holding && game.currentTrick.length === 0
      ? hold.cards
      : game.currentTrick.length ? game.currentTrick : lastTrickOpen ? game.completedTricks.at(-1) ?? [] : [];
    const statusText = !live ? (game.phase === "complete" ? "Hand complete" : "Passed out")
      : actingSeat ? (game.phase === "auction" ? "Your call" : actingSeat === yourSeat ? "Your play" : game.currentActor === game.contract?.declarer ? "Play declarer's hand" : "Play from dummy")
        : activeQueued ? `Queued: ${cardLabel(activeQueued.card)}`
        : `${seatNames[game.currentActor]} to ${game.phase === "auction" ? "bid" : "play"}`;

    return (
      <main className="app-shell">
        <div className={`game-layout online-table ${game.phase === "auction" ? "auction-layout" : "play-layout"}`}>
          <TableView
            game={game}
            bottomSeat={yourSeat}
            actingSeat={actingSeat}
            displayedTrick={displayedTrick}
            showCalls={game.phase !== "play" || auctionShown}
            onToggleCalls={() => setAuctionShown((shown) => !shown)}
            lastTrickOpen={lastTrickOpen}
            onToggleLastTrick={() => setLastTrickOpen((open) => !open)}
            showBottomHand
            fixedSeatHands
            cardsDisabled={inputDisabled || !!pendingClaim || pickingClaim}
            exposedSeat={pendingClaim?.seat}
            bidsDisabled={inputDisabled}
            queueSeats={actingSeat ? [] : queueOwners}
            queuedCard={activeQueued}
            onQueue={(seat, card) => setQueued((current) => current?.seat === seat && cardId(current.card) === cardId(card) ? undefined : { handKey: String(view.handNumber), seat, card })}
            statusText={statusText}
            ariaLabel={`Bridge table ${view.name}`}
            botSeats={botSeatsOf(view.seats)}
            seatLabel={(seat) => <SeatTag info={view.seats[seat]} isHost={view.host === seat}
              onHandToBot={canHandToBot(seat) ? () => send({ type: "handToBot", seat }) : undefined} seat={seat} />}
            onBid={(bid) => act({ type: "bid", seat: game.currentActor, bid })}
            onPlay={(seat, card) => act({ type: "play", seat, card })}
            hintedBid={visibleBidHint?.bid}
            hintedCards={visiblePlayHint?.cardIds}
            explainCall={hintsOn ? {
              shown: shownExplanation,
              onToggle: (index) => setExplainedCall(shownExplanation === index ? undefined : { handNumber: view.handNumber, auctionLength: game.auction.length, index }),
              text: (index) => {
                const callSeat = game.auction[index]!.seat;
                const info = view.seats[callSeat];
                const skill = info.kind === "bot" ? info.skill : info.kind === "human" && info.standIn ? info.standIn : "expert";
                return explainBid(game.auction, index, view.style, skill);
              }
            } : undefined}
            matchScore={score}
            tools={<GameMenu items={menuItems} defaultOpen={menuOpen} />}
            overlay={<>
              {claimPanel}
              {live && !claimPanel ? <div className="hint-controls">
                {hintsOn && actingSeat && game.phase === "auction" ? <strong className="hand-points" aria-label={`${highCardPoints(game.hands[game.currentActor])} high-card points`}>{highCardPoints(game.hands[game.currentActor])} HCP</strong> : null}
                {visibleBidHint && game.phase === "auction" ? <p role="status"><strong>Suggested: {compactCallLabel(visibleBidHint.bid)}</strong> {visibleBidHint.reason}</p> : null}
                {visiblePlayHint && game.phase === "play" ? <p role="status">{visiblePlayHint.reason}</p> : null}
                <button className="secondary-button hint-toggle" type="button" role="switch" aria-checked={hintsOn} title={hintsOn ? "Hide hints" : "Show hints: suggested bids and cards, and what each call means"} onClick={toggleHints}>Hints<span className="hint-switch" aria-hidden="true" /></button>
              </div> : null}
              {standIn ? <DraggableBanner className="online-resume" storageKey={resumeBannerKey} label={mine.autoPlay ? "Auto play is on" : "A bot is playing for you"}>
                <span>{mine.autoPlay ? "Auto play: a bot plays for you until this hand ends." : "A bot is playing for you."}</span>
                <button className="primary-button" type="button" onClick={() => send({ type: "resume" })}>{mine.autoPlay ? "Stop auto play" : "Take my seat back"}</button>
              </DraggableBanner> : null}
              {view.claimRejected ? <p className="claim-notice" role="status">{claimRejectedText(view.claimRejected)}</p> : null}
              {rubberDialog}
              {statusLine}
            </>}
          />
        </div>
      </main>
    );
  }

  // A finished hand: all 52 cards face-up at their seats, with the result, score, and Deal in the middle of the table.
  if (game && view.revealed && !view.handInProgress && seatingAfter !== view.handNumber) {
    const openSeating = () => setSeatingAfter(view.handNumber);
    const resultClosed = closedResult === view.handNumber;
    // Once a rubber is won: deal a new one, or go back to seating or the lobby. Close puts the card away to see the hands.
    const resultActions = <>
      {yourSeat ? <button className="primary-button" type="button" disabled={!view.canDeal} title={view.canDeal ? "Deal the next hand" : "Every seat needs a player or a bot before the next deal"} onClick={() => send({ type: "deal" })}>{rubberSummary?.winner ? "Deal a new rubber" : "Deal"}</button> : null}
      <button className="secondary-button" type="button" onClick={openSeating}>{yourSeat ? "Seating" : "Take a seat"}</button>
      {rubberSummary?.winner ? <button className="secondary-button" type="button" onClick={onLeave}>Back to lobby</button> : null}
      {rubberSummary?.winner && yourSeat ? <button className="secondary-button" type="button" disabled={status !== "open" || leaving} onClick={() => { setLeaving(true); send({ type: "leave" }); }}>Leave the table</button> : null}
      {rubberSummary ? <button className="secondary-button" type="button" onClick={() => setClosedResult(view.handNumber)}>Close</button> : null}
    </>;
    const resultMenu: GameMenuItem[] = [
      { id: "lobby", label: "Back to lobby", onSelect: onLeave, title: yourSeat ? "Keep your seat and return to the lobby" : "Return to the lobby" },
      { id: "seating", label: "Seating", onSelect: openSeating, title: "Change seats, bots, and skill levels before the next deal" },
      ...rubberItem,
      ...(yourSeat ? [{ id: "leave", label: "Leave the table", tone: "danger" as const, disabled: status !== "open" || leaving,
        title: "Give up your seat and return to the lobby", onSelect: () => { setLeaving(true); send({ type: "leave" }); } }] : [])
    ];
    return (
      <main className="app-shell">
        <div className="game-layout online-table play-layout result-layout">
          <TableView
            game={game}
            bottomSeat={yourSeat ?? "south"}
            displayedTrick={[]}
            showCalls={false}
            onToggleCalls={() => undefined}
            lastTrickOpen={false}
            onToggleLastTrick={() => undefined}
            showBottomHand={false}
            revealedHands={view.revealed}
            statusText={game.phase === "complete" ? "Hand complete" : "Passed out"}
            ariaLabel={`Bridge table ${view.name}, hand result`}
            botSeats={botSeatsOf(view.seats)}
            seatLabel={(seat) => <SeatTag info={view.seats[seat]} isHost={view.host === seat} onHandToBot={undefined} seat={seat} />}
            matchScore={score}
            tools={<GameMenu items={resultMenu} />}
            overlay={<>
              {resultClosed ? null : <section className={`score-panel result-panel ${rubberSummary ? "scorecard-panel" : ""}`} aria-label="Hand result">
                <HandResultSummary game={game} rubberHand={rubberSummary ? rubberHand ?? null : undefined} />
                {rubberSummary ? scorecard(resultActions) : <>
                  <p className="result-totals">Table score: {totals}</p>
                  <div className="result-actions">{resultActions}</div>
                </>}
              </section>}
              {rubberDialog}
              {statusLine}
            </>}
          />
        </div>
      </main>
    );
  }

  return <SeatingPanel view={view} totals={totals} rubberSummary={rubberSummary} rubberHand={rubberHand} scorecard={scorecard()} statusLine={statusLine} backButton={backButton} copyNote={copyNote}
    onShowResult={game && view.revealed && !view.handInProgress ? () => setSeatingAfter(undefined) : undefined}
    onCopy={() => {
      const link = `${location.origin}${location.pathname}#/table/${view.id}`;
      const shown = () => setCopyNote(`Copy this link: ${link}`);
      try { void navigator.clipboard.writeText(link).then(() => setCopyNote("Link copied."), shown); } catch { shown(); }
    }}
    send={send} />;
}

/** Seats a bot plays: bot seats, and players a bot is standing in for. */
function botSeatsOf(seats: Readonly<Record<Seat, SeatInfo>>): Seat[] {
  return seatOrder.filter((seat) => { const info = seats[seat]; return info.kind === "bot" || (info.kind === "human" && info.standIn !== undefined); });
}

function SeatTag({ seat, info, isHost, onHandToBot }: { seat: Seat; info: SeatInfo; isHost: boolean; onHandToBot: (() => void) | undefined }) {
  if (info.kind === "empty") return null;
  return <span className="online-seat-label">
    <span className="online-seat-name">{info.kind === "bot" ? "Bot" : info.standIn !== undefined ? `bot playing for ${info.name}` : info.name}</span>
    {info.kind === "human" && info.autoPlay ? <span className="online-badge">auto play</span> : null}
    {info.kind === "human" && info.away ? <span className="online-badge">away</span> : null}
    {isHost ? <span className="online-badge">host</span> : null}
    {onHandToBot ? <button className="secondary-button online-seat-button" type="button" aria-label={`Hand to a bot for ${seatNames[seat]}`} onClick={onHandToBot}>Hand to a bot</button> : null}
  </span>;
}
