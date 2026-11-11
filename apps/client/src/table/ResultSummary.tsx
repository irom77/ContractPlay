import type { ContractScore, RubberHand, RubberSummary, Side } from "@contractplay/core";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/** Made or down, the tricks taken against the tricks needed, and the over- or undertricks. */
export function ContractOutcome({ score }: { score: ContractScore }) {
  const made = score.undertricks === 0;
  return <p className={`contract-outcome ${made ? "outcome-made" : "outcome-down"}`}>
    <strong>{made ? "Made" : `Down ${score.undertricks}`}</strong>
    <span>{score.tricksTaken} of {score.tricksRequired} tricks needed</span>
    <span>{made ? (score.overtricks ? plural(score.overtricks, "overtrick") : "exactly") : plural(score.undertricks, "undertrick")}</span>
  </p>;
}

const sides: readonly Side[] = ["NS", "EW"];

/** This hand's rubber points for each side that scored, split into below and above the line. */
export function rubberHandText(hand: RubberHand): string {
  const parts = sides.flatMap((side) => {
    const entries = [hand.below[side] ? `${hand.below[side]} below` : "", hand.above[side] ? `${hand.above[side]} above` : ""].filter(Boolean);
    return entries.length ? [`${side} ${entries.join(", ")} the line`] : [];
  });
  return parts.length ? parts.join(" · ") : "No score";
}

/** The rubber scoresheet: points above the line, each game below it, and the totals. */
export function RubberScoresheet({ summary }: { summary: RubberSummary }) {
  const status = summary.winner
    ? `${summary.winner} win the rubber ${summary.gamesWon[summary.winner]}–${summary.gamesWon[summary.winner === "NS" ? "EW" : "NS"]} (+${summary.rubberBonus} bonus)`
    : `Games NS ${summary.gamesWon.NS} · EW ${summary.gamesWon.EW} · ${summary.vulnerability === "None" ? "Neither side" : summary.vulnerability === "Both" ? "Both sides" : summary.vulnerability} vulnerable`;
  return <table className="rubber-sheet" aria-label="Rubber score">
    <caption>{status}</caption>
    <thead><tr><th scope="col"><span className="sr-only">Line</span></th><th scope="col">NS</th><th scope="col">EW</th></tr></thead>
    <tbody>
      <tr className="above-line"><th scope="row">Above the line</th><td>{summary.above.NS}</td><td>{summary.above.EW}</td></tr>
      {summary.games.map((game, index) => <tr key={index} className={index === 0 ? "first-game" : ""}>
        <th scope="row">Game {index + 1}{game.winner ? "" : " (in play)"}</th>
        {sides.map((side) => <td key={side} className={game.winner === side ? "game-winner" : ""}>{game.below[side]}</td>)}
      </tr>)}
    </tbody>
    <tfoot><tr><th scope="row">Total</th><td>{summary.totals.NS}</td><td>{summary.totals.EW}</td></tr></tfoot>
  </table>;
}
