import { BOT_CHARACTERS, botCharacter, type BotCharacter } from "@contractplay/bots";
import { cleanName, TRAIT_NAMES, TRAIT_PRESETS, type BotTraits, type SkillLevel } from "@contractplay/core";
import { isOwnCharacter, MAX_CHARACTER_BLURB, MAX_CHARACTER_NAME, MAX_OWN_CHARACTERS, MAX_STORED_CHARACTERS, type OwnCharacter } from "@contractplay/persistence";

/**
 * The player's own bot characters, kept in the browser (and, for a signed-in player, on the account: see
 * `online/charactersSync.ts`). Deleted characters stay as tombstones so the deletion reaches other devices.
 */
export const ownCharactersKey = "contractplay.ownCharacters";

/** What the editor fills in. */
export type CharacterDraft = Readonly<{ name: string; blurb: string; skill: SkillLevel; traits: BotTraits }>;

export function loadOwnCharacters(storage: Pick<Storage, "getItem">): OwnCharacter[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ownCharactersKey) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    return parsed.filter((entry): entry is OwnCharacter => {
      if (!isOwnCharacter(entry) || seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    });
  } catch { return []; }
}

/** Replaces the stored characters, trimming the oldest deletions (never a live character); returns what was kept, in its order. */
export function saveOwnCharacters(storage: Pick<Storage, "setItem">, list: readonly OwnCharacter[]): OwnCharacter[] {
  const room = Math.max(0, MAX_STORED_CHARACTERS - liveCharacters(list).length);
  const newest = new Set(list.filter((character) => character.deleted).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, room));
  const kept = list.filter((character) => !character.deleted || newest.has(character));
  try { storage.setItem(ownCharactersKey, JSON.stringify(kept)); } catch { /* the characters just won't be kept */ }
  return kept;
}

export const liveCharacters = (list: readonly OwnCharacter[]): OwnCharacter[] => list.filter((character) => !character.deleted);

/**
 * The characters this player may see and change on a shared device: the signed-in account's, and ones not yet synced to
 * any account (signed out, only those).
 */
const visibleTo = (playerId: string | undefined) => (character: OwnCharacter): boolean => character.owner === undefined || character.owner === playerId;
export const charactersFor = (list: readonly OwnCharacter[], playerId: string | undefined): OwnCharacter[] => list.filter(visibleTo(playerId));
/** The stored list with these created, edited or deleted characters put in; everything else stays as it is. */
export const applyCharacters = (list: readonly OwnCharacter[], changed: readonly OwnCharacter[]): OwnCharacter[] =>
  [...list.map((character) => changed.find((entry) => entry.id === character.id) ?? character),
    ...changed.filter((entry) => !list.some((character) => character.id === entry.id))];

/** A change's time: now, or just after the change it replaces if that was stamped by a clock running ahead. */
const stamp = (character: OwnCharacter, now: number): number => Math.max(now, character.updatedAt + 1);

/** The draft with its name cleaned and description trimmed, or what to fix. */
export function checkDraft(draft: CharacterDraft): { draft: CharacterDraft } | { error: string } {
  const name = cleanName(draft.name, MAX_CHARACTER_NAME);
  if (!name) return { error: `Give your character a name of up to ${MAX_CHARACTER_NAME} characters.` };
  const blurb = draft.blurb.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim();
  if ([...blurb].length > MAX_CHARACTER_BLURB) return { error: `Keep the description to ${MAX_CHARACTER_BLURB} characters.` };
  return { draft: { ...draft, name, blurb } };
}

const fields = (draft: CharacterDraft) => ({ name: draft.name, blurb: draft.blurb, skill: draft.skill, traits: { ...draft.traits } });

export function createCharacter(list: readonly OwnCharacter[], draft: CharacterDraft, now: number, random: () => number = Math.random): OwnCharacter[] {
  if (liveCharacters(list).length >= MAX_OWN_CHARACTERS) throw new Error(`At most ${MAX_OWN_CHARACTERS} characters`);
  let id: string;
  do id = `own-${Array.from({ length: 10 }, () => "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 36)]).join("")}`;
  while (list.some((character) => character.id === id));
  return [...list, { id, ...fields(draft), updatedAt: now }];
}

/** Saves an edit; a change of skill or any dial marks when its play changed, so its record can say so. */
export function updateCharacter(list: readonly OwnCharacter[], id: string, draft: CharacterDraft, now: number): OwnCharacter[] {
  return list.map((character) => {
    if (character.id !== id) return character;
    const playChanged = character.skill !== draft.skill || TRAIT_NAMES.some((name) => character.traits[name] !== draft.traits[name]);
    const at = stamp(character, now);
    return { ...character, ...fields(draft), updatedAt: at, ...(playChanged ? { playEditedAt: at } : {}) };
  });
}

export function deleteCharacter(list: readonly OwnCharacter[], id: string, now: number): OwnCharacter[] {
  return list.map((character) => character.id === id ? { ...character, deleted: true as const, updatedAt: stamp(character, now) } : character);
}

/** The entries of `next` that are new or changed since `before` (what an account upload needs to send). */
export const changedCharacters = (before: readonly OwnCharacter[], next: readonly OwnCharacter[]): OwnCharacter[] =>
  next.filter((character) => !before.includes(character));

/** A named cast member, or one of the player's live characters, as a bot to seat. */
export function rosterCharacter(id: string | undefined, own: readonly OwnCharacter[]): BotCharacter | undefined {
  const cast = botCharacter(id);
  if (cast) return cast;
  const character = own.find((entry) => entry.id === id && !entry.deleted);
  return character ? { id: character.id, name: character.name, skill: character.skill, aggression: "normal", blurb: character.blurb, traits: character.traits } : undefined;
}

/** Where a new character can start: a preset, or a copy of a cast member's settings. */
export const startingPoints: readonly { label: string; draft: CharacterDraft }[] = [
  { label: "Normal bot", draft: { name: "", blurb: "", skill: "intermediate", traits: TRAIT_PRESETS.normal } },
  { label: "Conservative bot", draft: { name: "", blurb: "", skill: "intermediate", traits: TRAIT_PRESETS.conservative } },
  { label: "Aggressive bot", draft: { name: "", blurb: "", skill: "intermediate", traits: TRAIT_PRESETS.aggressive } },
  ...BOT_CHARACTERS.map((character) => ({ label: character.name,
    draft: { name: character.name, blurb: character.blurb, skill: character.skill, traits: TRAIT_PRESETS[character.aggression] } }))
];
