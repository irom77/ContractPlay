import { useState } from "react";
import type { RubberHand, RubberSummary, Seat, SkillLevel } from "@contractplay/core";
import type { ClientMessage, PublicGame, SeatInfo, TableView as TableViewData } from "@contractplay/protocol";
import { ContractOutcome, RubberScoresheet, rubberHandText } from "../table/ResultSummary.js";
import { claimText, contractText, seatNames, seats } from "../table/labels.js";

export type Outgoing = Exclude<ClientMessage, { type: "hello" }>;

const skillNames: Record<SkillLevel, string> = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced", expert: "Expert" };

/** Between hands, or for anyone unseated: the four seats with their controls, the totals, the last result, and Deal. */
export function SeatingPanel({ view, totals, rubberSummary, rubberHand, statusLine, backButton, copyNote, onCopy, onShowResult, send }: {
  view: TableViewData; totals: string;
  /** A rubber table's rubber, shown as its scoresheet, and the last hand's line on it. */
  rubberSummary?: RubberSummary | undefined; rubberHand?: RubberHand | undefined; statusLine: React.ReactNode; backButton: React.ReactNode; copyNote: string | undefined; onCopy(): void;
  /** Back to the finished hand laid out on the table, when there is one. */
  onShowResult?: (() => void) | undefined;
  send(message: Outgoing): void;
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
            <span className="quiet-copy">{view.style}{rubberSummary ? " · Rubber bridge" : ""}</span>
          </div>
          {rubberSummary ? <RubberScoresheet summary={rubberSummary} /> : <p className="online-totals">{totals}</p>}
          {copyNote ? <p className="quiet-copy online-copy-note" role="status">{copyNote}</p> : null}
          {view.handInProgress && !yourSeat ? <p>A hand is in progress. You can take a seat when it ends.</p> : null}
          {view.revealed && view.game ? <section className="online-result" aria-label="Last hand">
            <HandResultSummary game={view.game} rubberHand={rubberSummary ? rubberHand ?? null : undefined} />
            {onShowResult ? <button className="secondary-button" type="button" onClick={onShowResult}>Show the hands</button> : null}
          </section> : null}
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
          {yourSeat ? <button className="primary-button online-deal" type="button" disabled={!view.canDeal} onClick={() => send({ type: "deal" })}>{rubberSummary?.winner ? "Deal a new rubber" : "Deal"}</button> : null}
        </div>
        {statusLine}
      </section>
    </main>
  );
}

/**
 * The finished hand's contract, how it went, and its score: the centre of the result table, and a reminder on the seating screen.
 * At a rubber table `rubberHand` is the hand's line on the scoresheet (null when it is not on the sheet).
 */
export function HandResultSummary({ game, rubberHand }: { game: PublicGame; rubberHand?: RubberHand | null | undefined }) {
  const contract = game.contract;
  const score = game.score;
  if (!contract || !score) return <h2>Passed out</h2>;
  return <>
    <h2>{contractText(contract)} by {seatNames[contract.declarer]}</h2>
    <ContractOutcome score={score} />
    {game.claim ? <p className="claim-line">{claimText(game.claim, contract.declarer, 13 - game.completedTricks.length)}</p> : null}
    <p className="hand-points-line">{rubberHand !== undefined ? (rubberHand ? rubberHandText(rubberHand) : "No score") : `${score.score >= 0 ? "NS" : "EW"} +${Math.abs(score.score)}`}</p>
  </>;
}
