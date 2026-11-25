import { TRAIT_LEVELS, TRAIT_NAMES, type BotTraits } from "./bots.js";

export const MAX_CHARACTER_NAME = 24;

export const isOwnCharacterId = (value: unknown): value is string =>
  typeof value === "string" && /^own-[A-Za-z0-9_-]{6,40}$/.test(value);

/** Exactly the six dials, each a known setting. */
export function isBotTraits(value: unknown): value is BotTraits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === TRAIT_NAMES.length && TRAIT_NAMES.every((name) =>
    (TRAIT_LEVELS as readonly unknown[]).includes((value as Record<string, unknown>)[name])
  );
}
