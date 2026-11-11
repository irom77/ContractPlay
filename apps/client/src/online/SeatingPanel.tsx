import { useState } from "react";
import { SUITS, type Seat, type SkillLevel } from "@contractplay/core";
import type { ClientMessage, PublicGame, SeatInfo, TableView as TableViewData } from "@contractplay/protocol";
import { contractText, samePartnership, seatNames, seats, sortHand, suitSymbols } from "../table/labels.js";

export type Outgoing = Exclude<ClientMessage, { type: "hello" }>;

const skillNames: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };

/** Between hands, or for anyone unseated: the four seats with their controls, the totals, the last result, and Deal. */
export function SeatingPanel({ view, totals, statusLine, backButton, copyNote, onCopy, send }: {
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
