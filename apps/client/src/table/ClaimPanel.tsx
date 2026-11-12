import { useState } from "react";

export type ClaimPanelProps =
  /** Choosing a claim: all remaining tricks in one tap, or a number from 0 to `remaining`. */
  | { mode: "pick"; remaining: number; onClaim(tricks: number): void; onCancel(): void }
  /** A claim waiting for answers; the claimer can take it back. */
  | { mode: "pending"; text: string; onWithdraw?(): void }
  /** A claim this player must answer. */
  | { mode: "answer"; text: string; onAccept(): void; onReject(): void };

/** The claim panel over the table: the claimer's picker, a pending claim, or the answer asked of an opponent. */
export function ClaimPanel(props: ClaimPanelProps) {
  if (props.mode === "pick") return <ClaimPicker {...props} />;
  if (props.mode === "pending") {
    return <div className="claim-panel" role="group" aria-label="Claim">
      <p role="status">{props.text}</p>
      {props.onWithdraw ? <div className="claim-actions">
        <button className="secondary-button" type="button" onClick={props.onWithdraw}>Withdraw</button>
      </div> : null}
    </div>;
  }
  return <div className="claim-panel" role="group" aria-label="Answer the claim">
    <p role="status">{props.text}</p>
    <div className="claim-actions">
      <button className="primary-button" type="button" onClick={props.onAccept}>Accept</button>
      <button className="secondary-button" type="button" onClick={props.onReject}>Reject</button>
    </div>
  </div>;
}

function ClaimPicker({ remaining, onClaim, onCancel }: Extract<ClaimPanelProps, { mode: "pick" }>) {
  const [tricks, setTricks] = useState(remaining);
  const count = Math.min(tricks, remaining);
  return <div className="claim-panel" role="group" aria-label="Claim tricks">
    <p>How many of the remaining {remaining} tricks does your side take?</p>
    <button className="primary-button" type="button" onClick={() => onClaim(remaining)}>Claim all {remaining}</button>
    <div className="claim-stepper" role="group" aria-label="Claim some of the tricks">
      <button className="secondary-button" type="button" aria-label="Fewer tricks" disabled={count <= 0} onClick={() => setTricks(count - 1)}>−</button>
      <output aria-label="Tricks to claim" aria-live="polite">{count}</output>
      <button className="secondary-button" type="button" aria-label="More tricks" disabled={count >= remaining} onClick={() => setTricks(count + 1)}>+</button>
      <button className="secondary-button" type="button" onClick={() => onClaim(count)}>Claim</button>
    </div>
    <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
  </div>;
}
