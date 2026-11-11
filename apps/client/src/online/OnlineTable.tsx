import { useEffect, useRef, useState } from "react";
import { cardId, type Bid, type GameAction, type PlayContext, type Seat, type TrickCard } from "@contractplay/core";
import { loadSoloData, saveSoloData, type StorageLike } from "@contractplay/persistence";
import type { PublicGame, RefusalReason, SeatInfo, TableView as TableViewData } from "@contractplay/protocol";
import { explainBid, highCardPoints, suggestBid, suggestPlay } from "@contractplay/bots";
import { createHandName, handNameFromId } from "../handNames.js";
import { TableView } from "../table/TableView.js";
import { compactCallLabel, isCallAvailable, partnerOf, seatNames } from "../table/labels.js";
import { connectTable as defaultConnect, type ConnectionStatus, type TableConnection } from "./connection.js";
import { loadIdentity, type Identity } from "./identity.js";
import { NameGate } from "./Lobby.js";
import { savedHandFrom } from "./savedHand.js";
import { SeatingPanel, type Outgoing } from "./SeatingPanel.js";

/** How long the host waits on a present player's turn before "Hand to a bot" is offered (the service's limit). */
const IDLE_MS = 120_000;
const TRICK_HOLD_MS = 2000;
const NOTICE_MS = 5000;
const HISTORY_LIMIT = 25;
const HINTS_STORAGE_KEY = "contractplay.hints";

export type OnlineTableProps = { baseUrl: string; tableId: string; storage: StorageLike; onLeave(): void; connect?: typeof defaultConnect };

function refusalText(reason: RefusalReason): string | undefined {
  if (reason === "stale") return undefined;
  if (reason === "seat-taken") return "That seat was just taken.";
  if (reason === "not-your-turn") return "It isn't your turn.";
  return "That isn't possible right now.";
}

const isLive = (game: PublicGame | undefined): boolean => game?.phase === "auction" || game?.phase === "play";

/** The seat that decides the current turn: declarer when dummy is to play, otherwise the seat to act. */
function deciderOf(game: PublicGame): Seat {
  const declarer = game.contract?.declarer;
  return game.phase === "play" && declarer && game.currentActor === partnerOf(declarer) ? declarer : game.currentActor;
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

function ConnectedTable({ baseUrl, tableId, storage, onLeave, identity, connect = defaultConnect }: OnlineTableProps & { identity: Identity }) {
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
  const [explainedCall, setExplainedCall] = useState<{ handNumber: number; auctionLength: number; index: number }>();
  const connection = useRef<TableConnection | undefined>(undefined);
  const previousHand = useRef<number | undefined>(undefined);

  useEffect(() => {
    const current = connect({
      baseUrl, tableId, identity,
      onView: (next) => { setReceived((previous) => receive(previous, next)); setWaiting(false); },
      onRefused: (reason) => {
        setWaiting(false);
        const text = refusalText(reason);
        setNotice(text === undefined ? undefined : { text });
      },
      onStatus: setStatus
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
    const key = game && isLive(game) ? `${view.handNumber}:${deciderOf(game)}:${game.auction.length + game.completedTricks.length * 4 + game.currentTrick.length}` : undefined;
    setTurn((known) => key === undefined ? undefined : known?.key === key ? known : { key, since: Date.now() });

    if (view.revealed && game?.phase === "complete") saveToHistory(storage, view);
  }, [view, storage]);

  useEffect(() => {
    if (!turn) return;
    const timer = setTimeout(() => setIdleTurn(turn.key), Math.max(0, turn.since + IDLE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [turn]);

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
    const canHint = !hasStandIn && deciderOf(game) === view.yourSeat;
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

  const totals = `NS ${view.totals.ns} · EW ${view.totals.ew}`;
  const yourSeat = view.yourSeat;
  const game = view.game;
  const holding = hold !== undefined && hold.handNumber === view.handNumber;

  if (yourSeat && game && (isLive(game) || holding)) {
    const live = isLive(game);
    const mine = view.seats[yourSeat];
    const standIn = mine.kind === "human" && mine.standIn !== undefined;
    const decider = deciderOf(game);
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
    const displayedTrick = holding && game.currentTrick.length === 0
      ? hold.cards
      : game.currentTrick.length ? game.currentTrick : lastTrickOpen ? game.completedTricks.at(-1) ?? [] : [];
    const statusText = !live ? (game.phase === "complete" ? "Hand complete" : "Passed out")
      : actingSeat ? (game.phase === "auction" ? "Your call" : actingSeat === yourSeat ? "Your play" : "Play from dummy")
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
            cardsDisabled={inputDisabled}
            bidsDisabled={inputDisabled}
            statusText={statusText}
            ariaLabel={`Bridge table ${view.name}`}
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
            tools={<><span className="online-totals">{totals}</span>{backButton}</>}
            overlay={<>
              {live ? <div className="hint-controls">
                {hintsOn && actingSeat && game.phase === "auction" ? <strong className="hand-points" aria-label={`${highCardPoints(game.hands[game.currentActor])} high-card points`}>{highCardPoints(game.hands[game.currentActor])} HCP</strong> : null}
                {visibleBidHint && game.phase === "auction" ? <p role="status"><strong>Suggested: {compactCallLabel(visibleBidHint.bid)}</strong> {visibleBidHint.reason}</p> : null}
                {visiblePlayHint && game.phase === "play" ? <p role="status">{visiblePlayHint.reason}</p> : null}
                <button className="secondary-button hint-toggle" type="button" role="switch" aria-checked={hintsOn} title={hintsOn ? "Hide hints" : "Show hints: suggested bids and cards, and what each call means"} onClick={toggleHints}>Hints<span className="hint-switch" aria-hidden="true" /></button>
              </div> : null}
              {standIn ? <div className="online-resume" role="group" aria-label="A bot is playing for you">
                <span>A bot is playing for you.</span>
                <button className="primary-button" type="button" onClick={() => send({ type: "resume" })}>Take my seat back</button>
              </div> : null}
              {statusLine}
            </>}
          />
        </div>
      </main>
    );
  }

  return <SeatingPanel view={view} totals={totals} statusLine={statusLine} backButton={backButton} copyNote={copyNote}
    onCopy={() => {
      const link = `${location.origin}${location.pathname}#/table/${view.id}`;
      const shown = () => setCopyNote(`Copy this link: ${link}`);
      try { void navigator.clipboard.writeText(link).then(() => setCopyNote("Link copied."), shown); } catch { shown(); }
    }}
    send={send} />;
}

function SeatTag({ seat, info, isHost, onHandToBot }: { seat: Seat; info: SeatInfo; isHost: boolean; onHandToBot: (() => void) | undefined }) {
  if (info.kind === "empty") return null;
  return <span className="online-seat-label">
    <span className="online-seat-name">{info.kind === "bot" ? "Bot" : info.standIn !== undefined ? `bot playing for ${info.name}` : info.name}</span>
    {info.kind === "human" && info.away ? <span className="online-badge">away</span> : null}
    {isHost ? <span className="online-badge">host</span> : null}
    {onHandToBot ? <button className="secondary-button online-seat-button" type="button" aria-label={`Hand to a bot for ${seatNames[seat]}`} onClick={onHandToBot}>Hand to a bot</button> : null}
  </span>;
}
