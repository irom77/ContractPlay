import { AGGRESSIONS, type Aggression, type Seat, type SkillLevel } from "@contractplay/core";
import { BOT_CHARACTERS, botCharacter, type BotCharacter } from "@contractplay/bots";

export type SoloOpponents = "bots" | "manual";
export type SoloScoring = "rubber" | "single";
/** A bot character's id, or "custom" for a bot that takes the setup's own skill and aggressiveness. */
export type CastChoice = string;
/** Who sits where around the player: partner, left-hand opponent (next to call) and right-hand opponent. */
export type BotCast = Readonly<{ partner: CastChoice; left: CastChoice; right: CastChoice }>;
export const CAST_ROLES = ["partner", "left", "right"] as const;
export type CastRole = typeof CAST_ROLES[number];
/** How the next solo hand is set up; the lobby's Play panel writes it and solo reads it. */
export type SoloSetup = Readonly<{ opponents: SoloOpponents; seat: Seat; botSkill: SkillLevel; biddingStyle: "SAYC" | "2/1"; botAggression: Aggression; cast: BotCast; scoring: SoloScoring }>;

export const customCast: BotCast = { partner: "custom", left: "custom", right: "custom" };
export const defaultSoloSetup: SoloSetup = { opponents: "bots", seat: "north", botSkill: "beginner", biddingStyle: "SAYC", botAggression: "normal", cast: customCast, scoring: "rubber" };

const setupKey = "contractplay.soloSetup";
/** Scoring keeps the key it had before the rest of the setup was remembered. */
const scoringKey = "contractplay.scoring";
const seats: readonly Seat[] = ["north", "east", "south", "west"];
const skills: readonly SkillLevel[] = ["beginner", "intermediate", "advanced", "expert"];

function read(storage: Pick<Storage, "getItem">, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

const castChoices: readonly CastChoice[] = ["custom", ...BOT_CHARACTERS.map((character) => character.id)];

function readCast(value: unknown): BotCast {
  const stored = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { partner: pick(stored.partner, castChoices, "custom"), left: pick(stored.left, castChoices, "custom"), right: pick(stored.right, castChoices, "custom") };
}

/** Where each cast role sits for a player in this seat. */
export function castRoleOf(seat: Seat, userSeat: Seat): CastRole | undefined {
  const turn = (seats.indexOf(seat) - seats.indexOf(userSeat) + 4) % 4;
  return turn === 1 ? "left" : turn === 2 ? "partner" : turn === 3 ? "right" : undefined;
}

/** The character sitting in this seat, if it is a cast character rather than a custom bot (or the player). */
export function castCharacterAt(cast: BotCast, seat: Seat, userSeat: Seat): BotCharacter | undefined {
  const role = castRoleOf(seat, userSeat);
  return role ? botCharacter(cast[role]) : undefined;
}

/** The skill and aggressiveness of the bot in this seat: its character's, or the setup's own for a custom bot. */
export function botSettingsAt(setup: Pick<SoloSetup, "cast" | "botSkill" | "botAggression">, seat: Seat, userSeat: Seat): { skill: SkillLevel; aggression: Aggression } {
  const character = castCharacterAt(setup.cast, seat, userSeat);
  return character ? { skill: character.skill, aggression: character.aggression } : { skill: setup.botSkill, aggression: setup.botAggression };
}

/** Whether any seat is a custom bot, so the setup's own skill and aggressiveness still matter. */
export const castHasCustom = (cast: BotCast): boolean => CAST_ROLES.some((role) => !botCharacter(cast[role]));

function pick<T>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? value as T : fallback;
}

/** Reads the stored setup; any missing or unreadable field takes its default. */
export function loadSoloSetup(storage: Pick<Storage, "getItem">): SoloSetup {
  let stored: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(read(storage, setupKey) ?? "{}");
    if (parsed && typeof parsed === "object") stored = parsed as Record<string, unknown>;
  } catch { /* unreadable: defaults */ }
  return {
    opponents: pick<SoloOpponents>(stored.opponents, ["bots", "manual"], defaultSoloSetup.opponents),
    seat: pick(stored.seat, seats, defaultSoloSetup.seat),
    botSkill: pick(stored.botSkill, skills, defaultSoloSetup.botSkill),
    biddingStyle: pick<"SAYC" | "2/1">(stored.biddingStyle, ["SAYC", "2/1"], defaultSoloSetup.biddingStyle),
    botAggression: pick(stored.botAggression, AGGRESSIONS, defaultSoloSetup.botAggression),
    cast: readCast(stored.cast),
    scoring: read(storage, scoringKey) === "single" ? "single" : "rubber"
  };
}

/** Whether any setup has been remembered yet (it has not for hands started before setups were remembered). */
export function soloSetupStored(storage: Pick<Storage, "getItem">): boolean {
  return read(storage, setupKey) !== null;
}

export function saveSoloSetup(storage: Pick<Storage, "setItem">, setup: SoloSetup): void {
  const { scoring, ...rest } = setup;
  try {
    storage.setItem(setupKey, JSON.stringify(rest));
    storage.setItem(scoringKey, scoring);
  } catch { /* the choice just won't be remembered */ }
}
