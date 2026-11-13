import type { ContractScore } from "@contractplay/core";

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
