import type { Deal, GameAction, HandRecord, Seat, Vulnerability } from "@contractplay/core";

/** A replayable archived deal: its archive id and the record of how it was played before. */
export type ReplayDeal = { dealId: string; record: HandRecord };

const firstPlayedFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The date and time, in the viewer's zone, a replayed deal was first played, for example "12 Nov 2026, 14:32". */
export const formatFirstPlayed = (firstPlayedAt: number): string => firstPlayedFormat.format(firstPlayedAt);

/** The start notice shown for the whole hand of a replayed deal. */
export function replayNotice(firstPlayedAt: number, solo: boolean): string {
  return `Replayed deal · first played ${formatFirstPlayed(firstPlayedAt)} · ${solo ? "you" : "some of you"} may have played it before.`;
}

/** An archived deal to replay, or undefined when there is none or the service cannot be reached. */
export async function fetchReplay(vulnerability?: Vulnerability): Promise<ReplayDeal | undefined> {
  try {
    if (typeof fetch !== "function") return undefined;
    const response = await fetch(`/api/deals/replay${vulnerability ? `?vulnerability=${vulnerability}` : ""}`);
    if (response.status !== 200) return undefined;
    return await response.json() as ReplayDeal;
  } catch {
    return undefined;
  }
}

/** Offers a finished solo hand to the archive. Failures are ignored: the archive is a bonus. */
export async function postResult(input: { deal: Deal; dealer: Seat; vulnerability: Vulnerability; actions: readonly GameAction[]; replayOf?: string }): Promise<void> {
  try {
    if (typeof fetch !== "function") return;
    await fetch("/api/deals/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
  } catch {
    // Not archived.
  }
}
