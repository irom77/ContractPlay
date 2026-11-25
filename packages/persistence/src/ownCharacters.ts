import { cleanName, isBotTraits, isOwnCharacterId, MAX_CHARACTER_NAME, TRAIT_LEVELS, TRAIT_NAMES, type BotTraits, type SkillLevel } from "@contractplay/core";
export { isBotTraits, isOwnCharacterId, MAX_CHARACTER_NAME } from "@contractplay/core";

/**
 * A player's own bot character: a name, a description, a skill, and a setting on each trait dial. Kept in the browser and,
 * for signed-in players, on the account; never shared. A deleted character stays as a tombstone (`deleted`) with a newer
 * `updatedAt`, so the deletion reaches the player's other devices.
 */
export type OwnCharacter = Readonly<{
  id: string;
  name: string;
  blurb: string;
  skill: SkillLevel;
  traits: BotTraits;
  /** When it last changed (milliseconds): the latest edit wins between devices. */
  updatedAt: number;
  /** When its skill or a dial last changed, so its record can say it played differently before. */
  playEditedAt?: number;
  deleted?: true;
  /** The account this device's copy was synced with: a local partition, never server authority. */
  owner?: string;
}>;

/** The most own characters a player keeps. */
export const MAX_OWN_CHARACTERS = 12;
export const MAX_CHARACTER_BLURB = 80;
/** Characters and tombstones kept per player. */
export const MAX_STORED_CHARACTERS = 100;

const SKILLS: readonly unknown[] = ["beginner", "intermediate", "advanced", "expert"];
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const time = (value: unknown): boolean => Number.isSafeInteger(value) && (value as number) >= 0;

export function isOwnCharacter(value: unknown): value is OwnCharacter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return isOwnCharacterId(entry.id) && typeof entry.name === "string" && cleanName(entry.name, MAX_CHARACTER_NAME) === entry.name &&
    typeof entry.blurb === "string" && [...entry.blurb].length <= MAX_CHARACTER_BLURB && !CONTROL.test(entry.blurb) &&
    SKILLS.includes(entry.skill) && isBotTraits(entry.traits) && time(entry.updatedAt) &&
    (entry.playEditedAt === undefined || time(entry.playEditedAt)) && (entry.deleted === undefined || entry.deleted === true) &&
    (entry.owner === undefined || typeof entry.owner === "string");
}

/** Just the character's own fields, without the device's owner tag or anything else. */
export function ownCharacterFields(character: OwnCharacter): OwnCharacter {
  const traits = Object.fromEntries((Object.keys(character.traits) as (keyof BotTraits)[]).map((name) => [name, character.traits[name]])) as BotTraits;
  return { id: character.id, name: character.name, blurb: character.blurb, skill: character.skill, traits, updatedAt: character.updatedAt,
    ...(character.playEditedAt === undefined ? {} : { playEditedAt: character.playEditedAt }), ...(character.deleted ? { deleted: true } : {}) };
}
