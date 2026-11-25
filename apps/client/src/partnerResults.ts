import { botCharacter } from "@contractplay/bots";
import { SEATS, type GameState, type Seat } from "@contractplay/core";
import type { SeatInfo } from "@contractplay/protocol";
import { isBotResult, MAX_BOT_RESULTS, type BotResult } from "@contractplay/persistence";

/**
 * Results with each named bot partner and against each named opponent, solo and online, kept apart from the hand history
 * (which holds only the latest hands) so they build up over time. One entry per finished hand, replaced if the hand is
 * taken back and finished again. A signed-in player's results also go to the account (see `online/botResultsSync.ts`).
 */
export type PartnerResult = BotResult;

export type PartnerStats = Readonly<{ partner: string; hands: number; average: number; declared: number; made: number }>;
/** Your record against one opponent: hands they sat against you, and your side's average score a hand. */
export type OpponentStats = Readonly<{ opponent: string; hands: number; average: number }>;

export const partnerResultsKey = "contractplay.partnerResults";
export const MAX_PARTNER_RESULTS = MAX_BOT_RESULTS;

const sameSide = (a: Seat, b: Seat): boolean => (["north", "south"].includes(a)) === (["north", "south"].includes(b));

export function loadPartnerResults(storage: Pick<Storage, "getItem">): PartnerResult[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(partnerResultsKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isBotResult) : [];
  } catch { return []; }
}

/** Replaces the stored results, keeping the newest; returns what was kept. */
export function savePartnerResults(storage: Pick<Storage, "setItem">, results: readonly PartnerResult[]): PartnerResult[] {
  const kept = results.slice(-MAX_PARTNER_RESULTS);
  try { storage.setItem(partnerResultsKey, JSON.stringify(kept)); } catch { /* the results just won't be kept */ }
  return kept;
}

/** The result of a finished hand for the player in `userSeat`; undefined when it was not played out to a score or no seat was a named bot. */
export function partnerResultOf(handId: string, game: GameState, userSeat: Seat, cast: Readonly<{ partner: string; left: string; right: string }>,
  extra: Readonly<{ online?: true; at?: number }> = {}): PartnerResult | undefined {
  if (game.phase !== "complete" || !game.score || !game.contract || ![cast.partner, cast.left, cast.right].some((id) => botCharacter(id))) return undefined;
  const nsScore = game.score.score;
  const declared = sameSide(userSeat, game.contract.declarer);
  return { handId, partner: cast.partner, left: cast.left, right: cast.right, score: sameSide(userSeat, "north") ? nsScore : -nsScore,
    declared, made: declared && game.score.undertricks === 0, ...extra };
}

/** Who sat around the player at an online table: named bots by id, other bots as "custom", people as "human". */
export function onlineCast(seats: Readonly<Record<Seat, SeatInfo>>, userSeat: Seat): Readonly<{ partner: string; left: string; right: string }> {
  const at = (turn: number): string => {
    const info = seats[SEATS[(SEATS.indexOf(userSeat) + turn) % 4]!];
    return info.kind === "bot" ? botCharacter(info.character)?.id ?? "custom" : info.kind === "empty" ? "custom" : "human";
  };
  return { left: at(1), partner: at(2), right: at(3) };
}

/** Adds or replaces this hand's result, keeping the newest entries. */
export function recordPartnerResult(storage: Pick<Storage, "getItem" | "setItem">, result: PartnerResult): PartnerResult[] {
  return savePartnerResults(storage, [...loadPartnerResults(storage).filter((entry) => entry.handId !== result.handId), result]);
}

/** Each partner's record, most-played first. */
export function partnerStats(results: readonly PartnerResult[]): PartnerStats[] {
  const byPartner = new Map<string, { hands: number; total: number; declared: number; made: number }>();
  for (const result of results) {
    if (!botCharacter(result.partner)) continue;
    const stats = byPartner.get(result.partner) ?? { hands: 0, total: 0, declared: 0, made: 0 };
    stats.hands += 1;
    stats.total += result.score;
    if (result.declared) stats.declared += 1;
    if (result.made) stats.made += 1;
    byPartner.set(result.partner, stats);
  }
  return [...byPartner].map(([partner, stats]) => ({ partner, hands: stats.hands, average: Math.round(stats.total / stats.hands), declared: stats.declared, made: stats.made }))
    .sort((a, b) => b.hands - a.hands || b.average - a.average);
}

/** Each named opponent's record against you, most-met first; an opponent in both seats of a hand counts once for it. */
export function opponentStats(results: readonly PartnerResult[]): OpponentStats[] {
  const byOpponent = new Map<string, { hands: number; total: number }>();
  for (const result of results) {
    for (const opponent of new Set([result.left, result.right])) {
      if (!botCharacter(opponent)) continue;
      const stats = byOpponent.get(opponent) ?? { hands: 0, total: 0 };
      stats.hands += 1;
      stats.total += result.score;
      byOpponent.set(opponent, stats);
    }
  }
  return [...byOpponent].map(([opponent, stats]) => ({ opponent, hands: stats.hands, average: Math.round(stats.total / stats.hands) }))
    .sort((a, b) => b.hands - a.hands || b.average - a.average);
}

const signed = (points: number): string => points > 0 ? `+${points}` : `${points}`;

/** "7 hands against, +40 a hand", or "No hands against yet". */
export function opponentSummary(stats: OpponentStats | undefined): string {
  if (!stats) return "No hands against yet";
  return `${stats.hands} ${stats.hands === 1 ? "hand" : "hands"} against, ${signed(stats.average)} a hand`;
}

/** "12 hands together, +85 a hand", or "No hands together yet". */
export function partnerSummary(stats: PartnerStats | undefined): string {
  if (!stats) return "No hands together yet";
  return `${stats.hands} ${stats.hands === 1 ? "hand" : "hands"} together, ${signed(stats.average)} a hand`;
}
