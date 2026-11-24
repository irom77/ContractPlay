import { useEffect, useRef } from "react";
import type { Deal, GameAction, GameState, HandRecord, Seat, Vulnerability } from "@contractplay/core";
import { isHandRecord } from "@contractplay/persistence";

/** A replayable archived deal: its archive id and the record of how it was played before. */
export type ReplayDeal = { dealId: string; record: HandRecord };

const firstPlayedFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The date and time, in the viewer's zone, a replayed deal was first played, for example "12 Nov 2026, 14:32". */
export const formatFirstPlayed = (firstPlayedAt: number): string => firstPlayedFormat.format(firstPlayedAt);

/** The start notice shown for the whole hand of a replayed deal. */
export function replayNotice(firstPlayedAt: number, solo: boolean): string {
  return `Replayed deal · first played ${formatFirstPlayed(firstPlayedAt)} · ${solo ? "you" : "some of you"} may have played it before.`;
}

/** How long a new hand waits for a replay before it is dealt fresh. */
export const REPLAY_TIMEOUT_MS = 3000;

const isReplayDeal = (value: unknown): value is ReplayDeal =>
  typeof value === "object" && value !== null && typeof (value as ReplayDeal).dealId === "string" &&
  isHandRecord((value as ReplayDeal).record) && (value as ReplayDeal).record.replay !== undefined;

/**
 * An archived deal to replay, or undefined when there is none, the service cannot be reached or answers with
 * something malformed, or no answer comes within `REPLAY_TIMEOUT_MS`.
 */
export async function fetchReplay(vulnerability?: Vulnerability): Promise<ReplayDeal | undefined> {
  if (typeof fetch !== "function") return undefined;
  const controller = typeof AbortController === "function" ? new AbortController() : undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { controller?.abort(); resolve(undefined); }, REPLAY_TIMEOUT_MS);
  });
  const request = (async () => {
    try {
      const response = await fetch(`/api/deals/replay${vulnerability ? `?vulnerability=${vulnerability}` : ""}`, controller ? { signal: controller.signal } : undefined);
      if (response.status !== 200) return undefined;
      const body: unknown = await response.json();
      return isReplayDeal(body) ? body : undefined;
    } catch {
      return undefined;
    }
  })();
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
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

const isOver = (game: GameState | undefined): game is GameState => game?.phase === "complete" || game?.phase === "passed-out";

/**
 * Offers a solo hand to the archive when it ends, if it is eligible then, at most once per hand id. A hand already over
 * when the app opens was dealt with before the reload, so it is not offered again.
 */
export function useSoloResultPost(handId: string, game: GameState | undefined, eligible: boolean, replayOf: string | undefined): void {
  const seen = useRef(isOver(game) ? handId : undefined);
  useEffect(() => {
    if (!handId || !isOver(game) || seen.current === handId) return;
    // Eligibility counts at the moment the hand ends: changing a setting afterwards cannot offer it.
    seen.current = handId;
    if (!eligible) return;
    void postResult({
      deal: game.initialDeal, dealer: game.dealer, vulnerability: game.vulnerability,
      actions: game.history.actions.slice(0, game.history.cursor), ...(replayOf ? { replayOf } : {})
    });
  }, [handId, game, eligible, replayOf]);
}
