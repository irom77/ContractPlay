import { botCharacter } from "@contractplay/bots";
import type { GameState, Seat } from "@contractplay/core";

/**
 * Results with each named bot partner and against each named opponent, kept apart from the hand history (which holds only the latest hands) so they
 * build up over time. One entry per finished hand, replaced if the hand is taken back and finished again.
 */
export type PartnerResult = Readonly<{
  handId: string;
  /** The partner's character id, or "custom" for a custom bot. */
  partner: string;
  /** The opponents' character ids, or "custom". */
  left: string;
  right: string;
  /** Your side's score for the hand, in duplicate points. */
  score: number;
  /** Whether your side declared, and if so whether the contract made. */
  declared: boolean;
  made: boolean;
}>;

export type PartnerStats = Readonly<{ partner: string; hands: number; average: number; declared: number; made: number }>;
/** Your record against one opponent: hands they sat against you, and your side's average score a hand. */
export type OpponentStats = Readonly<{ opponent: string; hands: number; average: number }>;

const storageKey = "contractplay.partnerResults";
/** Plenty for years of solo play, and still small in storage. */
export const MAX_PARTNER_RESULTS = 2000;

const sameSide = (a: Seat, b: Seat): boolean => (["north", "south"].includes(a)) === (["north", "south"].includes(b));

function isResult(value: unknown): value is PartnerResult {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.handId === "string" && typeof entry.partner === "string" && typeof entry.left === "string" && typeof entry.right === "string" &&
    typeof entry.score === "number" && Number.isFinite(entry.score) && typeof entry.declared === "boolean" && typeof entry.made === "boolean";
}

export function loadPartnerResults(storage: Pick<Storage, "getItem">): PartnerResult[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isResult) : [];
  } catch { return []; }
}

/** The result of a finished hand for the player in `userSeat`; undefined when it was not played out to a score or no seat was a named bot. */
export function partnerResultOf(handId: string, game: GameState, userSeat: Seat, cast: Readonly<{ partner: string; left: string; right: string }>): PartnerResult | undefined {
  if (game.phase !== "complete" || !game.score || !game.contract || ![cast.partner, cast.left, cast.right].some((id) => botCharacter(id))) return undefined;
  const nsScore = game.score.score;
  const declared = sameSide(userSeat, game.contract.declarer);
  return { handId, partner: cast.partner, left: cast.left, right: cast.right, score: sameSide(userSeat, "north") ? nsScore : -nsScore,
    declared, made: declared && game.score.undertricks === 0 };
}

/** Adds or replaces this hand's result, keeping the newest entries. */
export function recordPartnerResult(storage: Pick<Storage, "getItem" | "setItem">, result: PartnerResult): PartnerResult[] {
  const results = [...loadPartnerResults(storage).filter((entry) => entry.handId !== result.handId), result].slice(-MAX_PARTNER_RESULTS);
  try { storage.setItem(storageKey, JSON.stringify(results)); } catch { /* the result just won't be kept */ }
  return results;
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
