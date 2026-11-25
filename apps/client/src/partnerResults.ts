import { botCharacter } from "@contractplay/bots";
import type { GameState, Seat } from "@contractplay/core";

/**
 * Results with each named bot partner, kept apart from the hand history (which holds only the latest hands) so they
 * build up over time. One entry per finished hand, replaced if the hand is taken back and finished again.
 */
export type PartnerResult = Readonly<{
  handId: string;
  /** The partner's character id. */
  partner: string;
  /** The opponents' character ids ("custom" for a custom bot), kept for results against them later. */
  left: string;
  right: string;
  /** Your side's score for the hand, in duplicate points. */
  score: number;
  /** Whether your side declared, and if so whether the contract made. */
  declared: boolean;
  made: boolean;
}>;

export type PartnerStats = Readonly<{ partner: string; hands: number; average: number; declared: number; made: number }>;

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

/** The result of a finished hand for the player in `userSeat`, or undefined when the hand was not played out to a score. */
export function partnerResultOf(handId: string, game: GameState, userSeat: Seat, cast: Readonly<{ partner: string; left: string; right: string }>): PartnerResult | undefined {
  if (game.phase !== "complete" || !game.score || !game.contract || !botCharacter(cast.partner)) return undefined;
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

/** "12 hands together, +85 a hand", or "No hands together yet". */
export function partnerSummary(stats: PartnerStats | undefined): string {
  if (!stats) return "No hands together yet";
  const average = stats.average > 0 ? `+${stats.average}` : `${stats.average}`;
  return `${stats.hands} ${stats.hands === 1 ? "hand" : "hands"} together, ${average} a hand`;
}
