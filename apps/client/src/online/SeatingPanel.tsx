import { useState } from "react";
import type { RubberHand, RubberSummary, Seat, SkillLevel } from "@contractplay/core";
import { MAX_TABLE_NAME } from "@contractplay/protocol";
import type { ClientMessage, PublicGame, SeatInfo, TableView as TableViewData } from "@contractplay/protocol";
import type { OwnCharacter } from "@contractplay/persistence";
import { ContractOutcome } from "../table/ResultSummary.js";
import { botCharacter } from "@contractplay/core";
import { aggressionNames, botName, claimText, contractText, onlineBotOptions, seatNames, seats, setBotFor, skillNames, traitSummary } from "../table/labels.js";
import { ReloadButton } from "../table/ReloadButton.js";

export type Outgoing = Exclude<ClientMessage, { type: "hello" }>;


/**
 * Deals the next hand, or after a finished one, confirms the viewer is ready for it: the server deals once every
 * present human has confirmed, so nobody's look at the result is cut short. Shows who it still waits for.
 */
export function DealButton({ view, newRubber, className = "primary-button", send }: {
  view: TableViewData; newRubber: boolean; className?: string; send(message: Outgoing): void;
}) {
  const label = newRubber ? "Deal a new rubber" : "Deal";
  const you = view.yourSeat;
  if (!you) return null;
  const others = (view.nextHand?.waitingOn ?? []).filter((seat) => seat !== you);
  const names = others.map((seat) => seatNames[seat]).join(" and ");
  const youReady = view.nextHand?.ready.includes(you) ?? false;
  const [text, title] = !view.canDeal
    ? [label, "Every seat needs a player or a bot before the next deal"]
    : youReady && others.length ? [`Waiting for ${names}`, `You are ready. The next hand is dealt once ${names} ${others.length > 1 ? "are" : "is"} ready too`]
    : others.length ? ["Ready", `Confirm you are ready. The next hand is dealt once ${names} ${others.length > 1 ? "are" : "is"} ready too`]
    : [label, "Deal the next hand"];
  return <button className={className} type="button" aria-live="polite" disabled={!view.canDeal || (youReady && others.length > 0)} title={title} onClick={() => send({ type: "deal" })}>{text}</button>;
}

/** Between hands, for anyone unseated, or opened from the game menu mid-hand (then read-only): the four seats with their controls, the totals, the last result, and Deal. */
export function SeatingPanel({ view, own, totals, rubberSummary, rubberHand, scorecard, statusLine, backButton, copyNote, onCopy, onBackToTable, send }: {
  view: TableViewData; totals: string;
  own: readonly OwnCharacter[];
  /** A rubber table's rubber, shown as its scoresheet, and the last hand's line on it. */
  rubberSummary?: RubberSummary | undefined; rubberHand?: RubberHand | undefined;
  /** A rubber table's scorecard. */
  scorecard?: React.ReactNode; statusLine: React.ReactNode; backButton: React.ReactNode; copyNote: string | undefined; onCopy(): void;
  /** Back to the table the viewer opened seating from: the hand in play, or the finished hand laid out face-up. */
  onBackToTable?: (() => void) | undefined;
  send(message: Outgoing): void;
}) {
  // Each open seat's bot choice: a skill level for a table bot, or a named bot's id.
  const [botChoices, setBotChoices] = useState<Record<Seat, string>>({ north: "intermediate", east: "intermediate", south: "intermediate", west: "intermediate" });
  const yourSeat = view.yourSeat;
  const betweenHands = !view.handInProgress;
  const botSelect = (value: string, onChange: (choice: string) => void, seated?: { value: string; name: string }) =>
    <select aria-label="Bot" value={value} onChange={(event) => onChange(event.target.value)}>{onlineBotOptions(own, seated)}</select>;

  const controls = (seat: Seat, info: SeatInfo): React.ReactNode => {
    if (!betweenHands) return null;
    if (info.kind === "empty") {
      if (!yourSeat) return <button className="primary-button" type="button" onClick={() => send({ type: "sit", seat })}>Sit here</button>;
      return <>
        {botSelect(botChoices[seat], (choice) => setBotChoices((chosen) => ({ ...chosen, [seat]: choice })))}
        <button className="secondary-button" type="button" onClick={() => send(setBotFor(seat, botChoices[seat], own))}>Add bot</button>
      </>;
    }
    if (info.kind === "bot") {
      if (!yourSeat) return null;
      const ownId = info.custom?.id && own.some((character) => !character.deleted && character.id === info.custom?.id) ? info.custom.id : undefined;
      const choice = info.custom ? ownId ?? "seated" : botCharacter(info.character)?.id ?? info.skill;
      const seated = info.custom && !ownId ? { value: "seated", name: info.custom.name } : undefined;
      return <>
        {botSelect(choice, (selected) => send(setBotFor(seat, selected, own)), seated)}
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
            {onBackToTable ? <button className="primary-button" type="button" onClick={onBackToTable}>Back to the table</button> : null}
            <button className="secondary-button" type="button" onClick={onCopy}>Copy table link</button>
            {backButton}
            <ReloadButton />
          </span>
        </div>
        <div className="lobby-panel">
          <div className="section-heading">
            <TableName name={view.name} canRename={yourSeat !== undefined && view.host === yourSeat} send={send} />
            <span className="quiet-copy">{view.style}{rubberSummary ? " · Rubber bridge" : ""}</span>
          </div>
          {rubberSummary ? scorecard : <p className="online-totals">{totals}</p>}
          {copyNote ? <p className="quiet-copy online-copy-note" role="status">{copyNote}</p> : null}
          {view.handInProgress ? <p>{yourSeat ? "A hand is in progress. Seats can change when it ends." : "A hand is in progress. You can take a seat when it ends."}</p> : null}
          {view.revealed && view.game ? <section className="online-result" aria-label="Last hand">
            <HandResultSummary game={view.game} rubberHand={rubberSummary ? rubberHand ?? null : undefined} />
          </section> : null}
          <div className="online-seats">
            {seats.map((seat) => {
              const info = view.seats[seat];
              const occupant = info.kind === "empty" ? "Open" : info.kind === "bot" ? botOccupant(info) : info.standIn !== undefined ? `bot playing for ${info.name}` : info.name;
              return <div key={seat} role="group" aria-label={`${seatNames[seat]} seat`} className={`online-seat online-seat-${seat}`}>
                <div className="online-seat-head">
                  <span className="quiet-copy">{seatNames[seat]}</span>
                  <strong>{occupant}</strong>
                  {info.kind === "bot" && info.custom ? <span className="quiet-copy">{traitSummary(info.custom.traits)}</span> : null}
                  {info.kind === "human" && info.away ? <span className="online-badge">away</span> : null}
                  {view.host === seat ? <span className="online-badge">host</span> : null}
                  {seat === yourSeat ? <span className="online-badge">you</span> : null}
                </div>
                <div className="online-seat-controls">{controls(seat, info)}</div>
              </div>;
            })}
          </div>
          {view.handInProgress ? null : <DealButton view={view} newRubber={!!rubberSummary?.winner} className="primary-button online-deal" send={send} />}
        </div>
        {statusLine}
      </section>
    </main>
  );
}

/** The table's name; the host also gets a Rename button that opens an inline form. The new name arrives with the next view. */
function TableName({ name, canRename, send }: { name: string; canRename: boolean; send(message: Outgoing): void }) {
  const [draft, setDraft] = useState<string | undefined>();
  if (draft === undefined || !canRename) {
    return <span className="table-tools-row">
      <h2>{name}</h2>
      {canRename ? <button className="secondary-button" type="button" title="Change this table's name for everyone, here and in the lobby" onClick={() => setDraft(name)}>Rename</button> : null}
    </span>;
  }
  const next = draft.trim();
  return <form className="table-tools-row table-rename" aria-label="Rename table" onSubmit={(event) => {
    event.preventDefault();
    if (next === "") return;
    if (next !== name) send({ type: "rename", name: next });
    setDraft(undefined);
  }}>
    <input aria-label="Table name" value={draft} maxLength={MAX_TABLE_NAME} autoFocus onChange={(event) => setDraft(event.target.value)} />
    <button className="primary-button" type="submit" disabled={next === ""}>Save name</button>
    <button className="secondary-button" type="button" onClick={() => setDraft(undefined)}>Cancel</button>
  </form>;
}

/**
 * The finished hand's contract, how it went, and its score: the centre of the result table, and a reminder on the seating screen.
 * At a rubber table `rubberHand` is the hand's line on the scorecard (null when it is not on it); its points are told
 * by the scorecard's breakdown, so only a running-totals table shows them here.
 */
export function HandResultSummary({ game, rubberHand }: { game: PublicGame; rubberHand?: RubberHand | null | undefined }) {
  const contract = game.contract;
  const score = game.score;
  if (!contract || !score) return <h2>Passed out</h2>;
  return <>
    <h2>{contractText(contract)} by {seatNames[contract.declarer]}</h2>
    <ContractOutcome score={score} />
    {game.claim ? <p className="claim-line">{claimText(game.claim, contract.declarer, 13 - game.completedTricks.length)}</p> : null}
    {rubberHand === undefined ? <p className="hand-points-line">{`${score.score >= 0 ? "NS" : "EW"} +${Math.abs(score.score)}`}</p> : null}
  </>;
}

/** "Bot · Advanced" for a table bot; "Bold Bea · Advanced · Aggressive" for a named one. */
function botOccupant(info: { skill: SkillLevel; character?: string | undefined; custom?: { name: string } | undefined }): string {
  if (info.custom) return `${info.custom.name} · ${skillNames[info.skill]} · Player's character`;
  const character = botCharacter(info.character);
  return character ? `${character.name} · ${skillNames[character.skill]} · ${aggressionNames[character.aggression]}` : `${botName(info)} · ${skillNames[info.skill]}`;
}
