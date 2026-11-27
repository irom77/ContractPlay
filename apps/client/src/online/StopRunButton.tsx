import { useState } from "react";

/**
 * Stop for a bot benchmark run, offered to benchmark admins: after a confirm it cancels the whole run (every table of
 * it closes and its session is removed). Callers decide whether the viewer may see it.
 */
export function StopRunButton({ stop, onStopped, ariaLabel }: { stop(): Promise<unknown>; onStopped(): void; ariaLabel?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async () => {
    if (!window.confirm("Stop this benchmark run? Every table in it closes, and the run won't count toward ratings.")) return;
    setBusy(true); setError(undefined);
    try {
      await stop();
      onStopped();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not stop the run");
    } finally {
      setBusy(false);
    }
  };
  return <>
    <button className="secondary-button stop-run-button" type="button" disabled={busy} aria-label={ariaLabel} title="Stop this benchmark run and close its tables" onClick={() => void run()}>{busy ? "Stopping…" : "Stop"}</button>
    {error ? <span className="stop-run-error" role="alert">{error}</span> : null}
  </>;
}
