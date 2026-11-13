import { RUBBER_BONUS_ENTRY, type Rubber, type RubberEntry, type RubberHand, type RubberScoreItem, type RubberSummary, type Side } from "@contractplay/core";
import type { ReactNode } from "react";
import { contractText } from "./labels.js";

const sides: readonly Side[] = ["NS", "EW"];
const other = (side: Side): Side => (side === "NS" ? "EW" : "NS");
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** How the scorecard names each partnership: the column heading, and a short name for the breakdown and status. */
export type SideNames = Readonly<Record<Side, Readonly<{ heading: string; short: string }>>>;

export const compassSideNames: SideNames = { NS: { heading: "North–South", short: "N–S" }, EW: { heading: "East–West", short: "E–W" } };

/** "We" for the user's partnership and "They" for the other, with the compass sides under them. */
export function weTheySideNames(userSide: Side): SideNames {
  const name = (side: Side) => side === userSide ? "We" : "They";
  return {
    NS: { heading: `${name("NS")} (N–S)`, short: name("NS") },
    EW: { heading: `${name("EW")} (E–W)`, short: name("EW") }
  };
}

/** The rubber's hands that are on its scorecard: a hand recorded after the rubber was won belongs to no rubber. */
export function handsOnCard(rubber: Rubber, summary: RubberSummary): readonly RubberHand[] {
  if (!summary.wonOn) return rubber.hands;
  const last = rubber.hands.findIndex((hand) => hand.handId === summary.wonOn);
  return last < 0 ? rubber.hands : rubber.hands.slice(0, last + 1);
}

function itemText(item: RubberScoreItem, hand: RubberHand): ReactNode {
  const contract = hand.detail!.contract;
  switch (item.kind) {
    case "contract": return <>for making {contractText(contract)}</>;
    case "overtricks": return `for ${plural(item.count ?? 0, "overtrick")}${contract.doubled ? (contract.doubled === 2 ? " (redoubled)" : " (doubled)") : ""}`;
    case "insult": return `for making a ${contract.doubled === 2 ? "redoubled" : "doubled"} contract`;
    case "slam": return `${contract.level === 7 ? "grand" : "small"} slam bonus`;
    case "undertricks": return <>for defeating {contractText(contract)} by {item.count ?? 0}{hand.detail!.vulnerable ? " (vulnerable)" : ""}</>;
    case "honors": return `for honors`;
  }
}

/** The items add up to the points written on the card, so the breakdown can be trusted. */
function detailMatches(hand: RubberHand): boolean {
  if (!hand.detail || !Array.isArray(hand.detail.items)) return false;
  return sides.every((side) => (["below", "above"] as const).every((line) =>
    hand.detail!.items.filter((item) => item.side === side && item.line === line).reduce((sum, item) => sum + item.points, 0) === hand[line][side]));
}

/** One line per point award on the hand, then the game or rubber it won. */
function breakdownLines(hand: RubberHand, summary: RubberSummary, names: SideNames): ReactNode[] {
  const lines: ReactNode[] = [];
  if (detailMatches(hand)) {
    for (const item of hand.detail!.items) {
      lines.push(<>{names[item.side].short}: <strong>+{item.points}</strong> {itemText(item, hand)}{item.line === "below" ? " (below the line)" : ""}</>);
    }
  } else {
    // A hand scored before breakdowns were kept: its points above and below the line.
    for (const side of sides) {
      if (hand.below[side]) lines.push(<>{names[side].short}: <strong>+{hand.below[side]}</strong> below the line</>);
      if (hand.above[side]) lines.push(<>{names[side].short}: <strong>+{hand.above[side]}</strong> above the line</>);
    }
  }
  const gameIndex = summary.games.findIndex((game) => game.wonOn === hand.handId);
  const game = summary.games[gameIndex];
  if (game?.winner) lines.push(<>{names[game.winner].short} win game {gameIndex + 1}</>);
  if (summary.wonOn === hand.handId && summary.winner) {
    lines.push(<>{names[summary.winner].short}: <strong>+{summary.rubberBonus}</strong> rubber bonus ({summary.gamesWon[summary.winner]}–{summary.gamesWon[other(summary.winner)]} in games)</>);
  }
  return lines;
}

function Entries({ entries, lastHandId, label }: { entries: readonly RubberEntry[]; lastHandId: string | undefined; label: string }) {
  return <ul className="pad-entries" aria-label={entries.length ? `${label}: ${entries.map((entry) => entry.points).join(", ")}` : `${label}: none`}>
    {entries.map((entry, index) => <li key={`${entry.handId}-${index}`}
      className={entry.handId === RUBBER_BONUS_ENTRY ? "pad-bonus" : entry.handId === lastHandId ? "pad-new" : ""}>{entry.points}</li>)}
  </ul>;
}

/**
 * A rubber bridge scorecard drawn like a paper pad: the partnerships either side of a vertical divider, bonuses and
 * penalties above the line (newest highest), trick points below it game by game with a dotted line and an arrow towards
 * the side that won each game, the totals, and what the last hand scored.
 */
export function Scorecard({ summary, hands, names = compassSideNames, passedOut = false, actions }: {
  summary: RubberSummary;
  /** The hands on the card, oldest first; the last one gets the breakdown. */
  hands: readonly RubberHand[];
  names?: SideNames;
  /** The hand just ended was passed out: it scores nothing and the breakdown says so. */
  passedOut?: boolean;
  actions?: ReactNode;
}) {
  const last = passedOut ? undefined : hands.at(-1);
  const winner = summary.winner;
  const status = `Games: ${names.NS.short} ${summary.gamesWon.NS}, ${names.EW.short} ${summary.gamesWon.EW} · ${summary.vulnerability === "None" ? "Neither side" : summary.vulnerability === "Both" ? "Both sides" : names[summary.vulnerability].short} vulnerable`;
  const lead: Side | undefined = summary.totals.NS === summary.totals.EW ? undefined : summary.totals.NS > summary.totals.EW ? "NS" : "EW";
  const lines = last ? breakdownLines(last, summary, names) : [];
  const lastLabel = last?.detail ? <>{contractText(last.detail.contract)} by {seatName(last.detail.contract.declarer)}</> : null;
  return <section className={`scorecard ${winner ? "scorecard-final" : ""}`} aria-label="Scorecard">
    {winner ? <header className="pad-result" role="status">
      <h3>{names[winner].short} win the rubber {summary.gamesWon[winner]}–{summary.gamesWon[other(winner)]}</h3>
      <p>Final score {names.NS.short} {summary.totals.NS} · {names.EW.short} {summary.totals.EW}{lead ? ` · ${names[lead].short} by ${Math.abs(summary.totals.NS - summary.totals.EW)} points` : " · level on points"}</p>
    </header> : <p className="pad-status">{status}</p>}
    <div className="pad" role="group" aria-label="Rubber scorecard">
      <div className="pad-row pad-head">{sides.map((side) => <div key={side} className="pad-cell" role="heading" aria-level={4}>{names[side].heading}</div>)}</div>
      <div className="pad-row pad-above" aria-label="Above the line">
        {sides.map((side) => <div key={side} className="pad-cell"><Entries entries={summary.aboveEntries[side]} lastHandId={last?.handId} label={`${names[side].short} above the line`} /></div>)}
      </div>
      <div className="pad-line" role="separator" aria-label="The line" />
      {summary.games.map((game, index) => <div key={index} className="pad-game" aria-label={`Game ${index + 1}${game.winner ? `, won by ${names[game.winner].short}` : ", in play"}`}>
        <div className="pad-row pad-below">
          {sides.map((side) => <div key={side} className="pad-cell"><Entries entries={game.entries[side]} lastHandId={last?.handId} label={`${names[side].short} game ${index + 1}`} /></div>)}
        </div>
        {game.winner ? <div className={`pad-game-line pad-game-${game.winner}`} role="img" aria-label={`Game ${index + 1} to ${names[game.winner].short}`}>
          <svg className="pad-arrow" viewBox="0 0 16 10" aria-hidden="true"><path d="M1 5h14M1 5l5-4M1 5l5 4" /></svg>
        </div> : null}
      </div>)}
      <div className="pad-row pad-total" aria-label={`Total: ${names.NS.short} ${summary.totals.NS}, ${names.EW.short} ${summary.totals.EW}`}>
        {sides.map((side) => <div key={side} className={`pad-cell ${winner === side ? "pad-winner" : ""}`}>{summary.totals[side]}</div>)}
      </div>
    </div>
    <section className="pad-breakdown" aria-label="Last hand's points">
      {passedOut ? <p>Passed out: no score.</p>
        : last ? <>
          {lastLabel ? <p className="pad-breakdown-title">Last hand: {lastLabel}</p> : null}
          <ul>{lines.map((line, index) => <li key={index}>{line}</li>)}</ul>
        </>
        : <p>No hands scored yet in this rubber.</p>}
    </section>
    {actions ? <div className="pad-actions">{actions}</div> : null}
  </section>;
}

const seatName = (seat: string) => seat.charAt(0).toUpperCase() + seat.slice(1);

/** The players' names at the head of each column (for example "Alex & Bot"), falling back to the compass sides. */
export function playerSideNames(nameOf: (seat: "north" | "south" | "east" | "west") => string | undefined): SideNames {
  const pair = (a: "north" | "east", b: "south" | "west", fallback: string) => {
    const names = [nameOf(a), nameOf(b)];
    return names.every((name) => name === undefined) ? fallback : names.map((name, index) => name ?? seatName(index ? b : a)).join(" & ");
  };
  return {
    NS: { heading: pair("north", "south", "North–South"), short: "N–S" },
    EW: { heading: pair("east", "west", "East–West"), short: "E–W" }
  };
}
