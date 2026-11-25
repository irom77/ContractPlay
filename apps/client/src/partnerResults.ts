import { botCharacter } from "@contractplay/bots";
import { SEATS, type GameState, type Seat } from "@contractplay/core";
import type { SeatInfo } from "@contractplay/protocol";
import { isBotResult, isOwnCharacterId, MAX_BOT_RESULTS, type BotResult, type OwnCharacter } from "@contractplay/persistence";
import { rosterCharacter } from "./ownCharacters.js";

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

/** A seat entry with a record: a named cast member or one of the player's own characters (not "custom" or "human"). */
const isCharacter = (id: string): boolean => !!botCharacter(id) || isOwnCharacterId(id);

/**
 * The result of a finished hand for the player in `userSeat`; undefined when it was not played out to a score or no seat
 * was a named bot or one of the player's own characters. Own characters are recorded with their name at the time; one
 * this device no longer holds counts as a custom bot, as it played.
 */
export function partnerResultOf(handId: string, game: GameState, userSeat: Seat, cast: Readonly<{ partner: string; left: string; right: string }>,
  extra: Readonly<{ online?: true; at?: number }> = {}, own: readonly OwnCharacter[] = []): PartnerResult | undefined {
  const entry = (id: string): string => isOwnCharacterId(id) && !rosterCharacter(id, own) ? "custom" : id;
  cast = { partner: entry(cast.partner), left: entry(cast.left), right: entry(cast.right) };
  if (game.phase !== "complete" || !game.score || !game.contract || ![cast.partner, cast.left, cast.right].some(isCharacter)) return undefined;
  const names = Object.fromEntries([cast.partner, cast.left, cast.right].filter(isOwnCharacterId).map((id) => [id, rosterCharacter(id, own)!.name]));
  const nsScore = game.score.score;
  const declared = sameSide(userSeat, game.contract.declarer);
  return { handId, partner: cast.partner, left: cast.left, right: cast.right, score: sameSide(userSeat, "north") ? nsScore : -nsScore,
    declared, made: declared && game.score.undertricks === 0, ...extra, ...(Object.keys(names).length ? { names } : {}) };
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
    if (!isCharacter(result.partner)) continue;
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
      if (!isCharacter(opponent)) continue;
      const stats = byOpponent.get(opponent) ?? { hands: 0, total: 0 };
      stats.hands += 1;
      stats.total += result.score;
      byOpponent.set(opponent, stats);
    }
  }
  return [...byOpponent].map(([opponent, stats]) => ({ opponent, hands: stats.hands, average: Math.round(stats.total / stats.hands) }))
    .sort((a, b) => b.hands - a.hands || b.average - a.average);
}

/** A seat entry's name: the cast member's, the live character's, or a deleted character's last recorded name. */
export function castMemberName(id: string, own: readonly OwnCharacter[], results: readonly PartnerResult[]): string {
  const character = rosterCharacter(id, own);
  if (character) return character.name;
  if (!isOwnCharacterId(id)) return id;
  const named = [...results].reverse().find((result) => result.names?.[id] !== undefined);
  return `${named?.names?.[id] ?? "Your character"} (deleted)`;
}

/** Whether an own character's skill or dials changed after some of the hands in its record. */
export function editedSince(id: string, own: readonly OwnCharacter[], results: readonly PartnerResult[]): boolean {
  const edited = own.find((character) => character.id === id)?.playEditedAt;
  return edited !== undefined && results.some((result) => [result.partner, result.left, result.right].includes(id) && (result.at === undefined || result.at < edited));
}

/** " · edited since some of these hands" for an own character that plays differently now, or nothing. */
export const editedNote = (id: string, own: readonly OwnCharacter[], results: readonly PartnerResult[]): string =>
  editedSince(id, own, results) ? " · edited since some of these hands" : "";

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
