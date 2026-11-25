import { botCharacter, cleanName } from "@contractplay/core";
import { isOwnCharacterId, MAX_CHARACTER_NAME } from "./ownCharacters.js";

/**
 * One finished hand's result with or against named bots, solo or online. Results are kept apart from the hand history
 * (which holds only the latest hands) so they build up over time, and follow a signed-in player across devices.
 */
export type BotResult = Readonly<{
  /** The hand's id: solo play's own id, or `online-<table>-<hand>`. */
  handId: string;
  /** The partner's character id (the named cast or the player's own); "custom" for any other bot, "human" for a person. */
  partner: string;
  /** The opponents, on the player's left and right, the same way. */
  left: string;
  right: string;
  /** The player's side's score for the hand, in duplicate points. */
  score: number;
  /** Whether the player's side declared, and if so whether the contract made. */
  declared: boolean;
  made: boolean;
  /** Played at an online table; solo otherwise. */
  online?: true;
  /** When the hand finished (milliseconds); results recorded before it existed have none. */
  at?: number;
  /** Each own character's name at the time, by id, so a deleted character's results keep its name. */
  names?: Readonly<Record<string, string>>;
  /** The account this device's copy was synced with: a local partition, never server authority. */
  owner?: string;
}>;

/** Plenty for years of play, and still small in storage and on the account. */
export const MAX_BOT_RESULTS = 2000;

/** A seat's entry in a result: a named bot's id, or one of these. */
const isSeatEntry = (value: unknown): value is string => typeof value === "string" &&
  (value === "custom" || value === "human" || botCharacter(value) !== undefined || isOwnCharacterId(value));

/** Names only for own characters seated in this result. */
function isNames(value: unknown, seated: readonly unknown[]): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).every(([id, name]) => isOwnCharacterId(id) && seated.includes(id) &&
    typeof name === "string" && cleanName(name, MAX_CHARACTER_NAME) === name);
}

export function isBotResult(value: unknown): value is BotResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.handId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(entry.handId) &&
    isSeatEntry(entry.partner) && isSeatEntry(entry.left) && isSeatEntry(entry.right) &&
    Number.isSafeInteger(entry.score) && Math.abs(entry.score as number) <= 10_000 &&
    typeof entry.declared === "boolean" && typeof entry.made === "boolean" && (!entry.made || entry.declared) &&
    (entry.online === undefined || entry.online === true) &&
    (entry.at === undefined || (Number.isSafeInteger(entry.at) && (entry.at as number) >= 0)) &&
    (entry.names === undefined || isNames(entry.names, [entry.partner, entry.left, entry.right])) &&
    (entry.owner === undefined || typeof entry.owner === "string");
}

/** Just the result's own fields, without the device's owner tag or anything else. */
export function botResultFields(result: BotResult): BotResult {
  return { handId: result.handId, partner: result.partner, left: result.left, right: result.right, score: result.score, declared: result.declared, made: result.made,
    ...(result.online ? { online: true } : {}), ...(result.at === undefined ? {} : { at: result.at }),
    ...(result.names === undefined ? {} : { names: { ...result.names } }) };
}
