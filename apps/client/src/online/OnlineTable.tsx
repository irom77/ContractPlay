import { useEffect, useRef, useState } from "react";
import { SUITS, type GameAction, type Seat, type SkillLevel, type TrickCard } from "@contractplay/core";
import { loadSoloData, saveSoloData, type StorageLike } from "@contractplay/persistence";
import type { ClientMessage, PublicGame, RefusalReason, SeatInfo, TableView as TableViewData } from "@contractplay/protocol";
import { createHandName, handNameFromId } from "../handNames.js";
import { TableView } from "../table/TableView.js";
import { contractText, partnerOf, samePartnership, seatNames, seats, sortHand, suitSymbols } from "../table/labels.js";
import { connectTable as defaultConnect, type ConnectionStatus, type TableConnection } from "./connection.js";
import { loadIdentity, type Identity } from "./identity.js";
import { NameGate } from "./Lobby.js";
import { savedHandFrom } from "./savedHand.js";

/** How long the host waits on a present player's turn before "Hand to a bot" is offered (the service's limit). */
const IDLE_MS = 120_000;
const TRICK_HOLD_MS = 2000;
const HISTORY_LIMIT = 25;
const skillNames: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };

export type OnlineTableProps = { baseUrl: string; tableId: string; storage: StorageLike; onLeave(): void; connect?: typeof defaultConnect };

type Outgoing = Exclude<ClientMessage, { type: "hello" }>;

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

export function OnlineTable({ storage, onLeave, ...props }: OnlineTableProps) {
  const [identity, setIdentity] = useState<Identity | undefined>(() => loadIdentity(storage));
  if (!identity) return <NameGate storage={storage} onSaved={setIdentity} secondary={{ label: "Back to lobby", onClick: onLeave }} />;
  return <ConnectedTable {...props} storage={storage} onLeave={onLeave} identity={identity} />;
}

function ConnectedTable({ baseUrl, tableId, storage, onLeave, identity, connect = defaultConnect }: OnlineTableProps & { identity: Identity }) {
  const [view, setView] = useState<TableViewData>();
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [notice, setNotice] = useState<string>();
  // True from sending a call or card until the service answers with any view or refusal.
  const [waiting, setWaiting] = useState(false);
  const [hold, setHold] = useState<{ handNumber: number; cards: readonly TrickCard[] }>();
  const [lastTrickOpen, setLastTrickOpen] = useState(false);
  const [auctionShown, setAuctionShown] = useState(false);
  const [turn, setTurn] = useState<{ key: string; since: number }>();
  const [idleTurn, setIdleTurn] = useState<string>();
  const [copyNote, setCopyNote] = useState<string>();
  const connection = useRef<TableConnection | undefined>(undefined);
  const previous = useRef<{ handNumber: number; completed: number } | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const current = connect({
      baseUrl, tableId, identity,
      onView: (next) => { setView(next); setWaiting(false); },
      onRefused: (reason) => { setWaiting(false); setNotice(refusalText(reason)); },
      onStatus: setStatus
    });
    connection.current = current;
    return () => { current.close(); if (connection.current === current) connection.current = undefined; };
  }, [baseUrl, tableId, identity, connect]);

  useEffect(() => () => { if (holdTimer.current !== undefined) clearTimeout(holdTimer.current); }, []);

  // Per view: hold a just-completed trick, note when the turn changed, and keep a finished hand.
  useEffect(() => {
    if (!view) return;
    const game = view.game;
    const completed = game?.completedTricks.length ?? 0;
    const before = previous.current;
    previous.current = { handNumber: view.handNumber, completed };
    if (before?.handNumber !== view.handNumber) {
      if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
      setHold(undefined);
      setLastTrickOpen(false);
      setAuctionShown(false);
    } else if (game && completed > before.completed) {
      if (holdTimer.current !== undefined) clearTimeout(holdTimer.current);
      setHold({ handNumber: view.handNumber, cards: game.completedTricks.at(-1) ?? [] });
      setLastTrickOpen(false);
      holdTimer.current = setTimeout(() => { holdTimer.current = undefined; setHold(undefined); }, TRICK_HOLD_MS);
    }
    if (game && game.currentTrick.length > 0) setLastTrickOpen(false);

    const key = game && isLive(game) ? `${view.handNumber}:${deciderOf(game)}:${game.auction.length + completed * 4 + game.currentTrick.length}` : undefined;
    setTurn((known) => key === undefined ? undefined : known?.key === key ? known : { key, since: Date.now() });

    if (view.revealed && game?.phase === "complete") saveToHistory(storage, view);
  }, [view, storage]);

  useEffect(() => {
    if (!turn) return;
    const timer = setTimeout(() => setIdleTurn(turn.key), Math.max(0, turn.since + IDLE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [turn]);

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
    {notice ? <p className="error-message" role="alert">{notice}</p> : null}
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
            tools={<><span className="online-totals">{totals}</span>{backButton}</>}
            overlay={<>
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

function SeatingPanel({ view, totals, statusLine, backButton, copyNote, onCopy, send }: {
  view: TableViewData; totals: string; statusLine: React.ReactNode; backButton: React.ReactNode; copyNote: string | undefined; onCopy(): void; send(message: Outgoing): void;
}) {
  const [botSkills, setBotSkills] = useState<Record<Seat, SkillLevel>>({ north: "intermediate", east: "intermediate", south: "intermediate", west: "intermediate" });
  const yourSeat = view.yourSeat;
  const betweenHands = !view.handInProgress;
  const skillSelect = (value: SkillLevel, onChange: (skill: SkillLevel) => void) =>
    <select aria-label="Bot skill" value={value} onChange={(event) => onChange(event.target.value as SkillLevel)}>
      {(Object.keys(skillNames) as SkillLevel[]).map((skill) => <option key={skill} value={skill}>{skillNames[skill]}</option>)}
    </select>;

  const controls = (seat: Seat, info: SeatInfo): React.ReactNode => {
    if (!betweenHands) return null;
    if (info.kind === "empty") {
      if (!yourSeat) return <button className="primary-button" type="button" onClick={() => send({ type: "sit", seat })}>Sit here</button>;
      return <>
        {skillSelect(botSkills[seat], (skill) => setBotSkills((chosen) => ({ ...chosen, [seat]: skill })))}
        <button className="secondary-button" type="button" onClick={() => send({ type: "setBot", seat, skill: botSkills[seat] })}>Add bot</button>
      </>;
    }
    if (info.kind === "bot") {
      if (!yourSeat) return null;
      return <>
        {skillSelect(info.skill, (skill) => send({ type: "setBot", seat, skill }))}
        <button className="secondary-button" type="button" onClick={() => send({ type: "clearSeat", seat })}>Remove bot</button>
      </>;
    }
    if (seat === yourSeat) return <button className="secondary-button" type="button" onClick={() => send({ type: "leave" })}>Leave seat</button>;
    if (yourSeat && (info.away || view.host === yourSeat)) return <button className="secondary-button" type="button" onClick={() => send({ type: "clearSeat", seat })}>Free seat</button>;
    return null;
  };

  return (
    <main className="app-shell">
      <section className="empty-table lobby online-seating" aria-label={`Table ${view.name}`}>
        <div className="start-bar">
          <span className="brand"><span className="brand-mark">C</span>ContractPlay</span>
          <span className="table-tools-row">
            <button className="secondary-button" type="button" onClick={onCopy}>Copy table link</button>
            {backButton}
          </span>
        </div>
        <div className="lobby-panel">
          <div className="section-heading">
            <h2>{view.name}</h2>
            <span className="quiet-copy">{view.style}</span>
          </div>
          <p className="online-totals">{totals}</p>
          {copyNote ? <p className="quiet-copy online-copy-note" role="status">{copyNote}</p> : null}
          {view.handInProgress && !yourSeat ? <p>A hand is in progress. You can take a seat when it ends.</p> : null}
          {view.revealed && view.game ? <HandResult game={view.game} revealed={view.revealed} /> : null}
          <div className="online-seats">
            {seats.map((seat) => {
              const info = view.seats[seat];
              const occupant = info.kind === "empty" ? "Open" : info.kind === "bot" ? `Bot · ${skillNames[info.skill]}` : info.standIn !== undefined ? `bot playing for ${info.name}` : info.name;
              return <div key={seat} role="group" aria-label={`${seatNames[seat]} seat`} className={`online-seat online-seat-${seat}`}>
                <div className="online-seat-head">
                  <span className="quiet-copy">{seatNames[seat]}</span>
                  <strong>{occupant}</strong>
                  {info.kind === "human" && info.away ? <span className="online-badge">away</span> : null}
                  {view.host === seat ? <span className="online-badge">host</span> : null}
                  {seat === yourSeat ? <span className="online-badge">you</span> : null}
                </div>
                <div className="online-seat-controls">{controls(seat, info)}</div>
              </div>;
            })}
          </div>
          {yourSeat ? <button className="primary-button" type="button" disabled={!view.canDeal} onClick={() => send({ type: "deal" })}>Deal</button> : null}
        </div>
        {statusLine}
      </section>
    </main>
  );
}

function HandResult({ game, revealed }: { game: PublicGame; revealed: NonNullable<TableViewData["revealed"]> }) {
  const contract = game.contract;
  return (
    <section className="online-result" aria-label="Hand result">
      <h2>{contract ? <>{contractText(contract)} by {seatNames[contract.declarer]}</> : "Passed out"}</h2>
      {contract && game.score ? <p>{game.score.tricksTaken} tricks for {samePartnership(contract.declarer, "north") ? "NS" : "EW"} · {game.score.score > 0 ? "+" : ""}{game.score.score} NS</p> : null}
      <div className="online-hands">
        {seats.map((seat) => {
          const hand = sortHand(revealed[seat]);
          return <div key={seat} role="group" aria-label={`${seatNames[seat]}'s hand`} className="online-hand">
            <strong>{seatNames[seat]}</strong>
            {SUITS.map((suit) => {
              const ranks = hand.filter((card) => card.suit === suit).map((card) => card.rank === "T" ? "10" : card.rank).join(" ");
              return <span key={suit} className={suit === "hearts" || suit === "diamonds" ? "online-hand-red" : undefined}>
                <span aria-hidden="true">{suitSymbols[suit]}</span><span className="sr-only">{suit}</span> {ranks || "—"}
              </span>;
            })}
          </div>;
        })}
      </div>
    </section>
  );
}
