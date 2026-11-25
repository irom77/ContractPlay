import { isOwnCharacter, MAX_STORED_CHARACTERS, ownCharacterFields, type OwnCharacter, type StorageLike } from "@contractplay/persistence";
import { loadOwnCharacters, saveOwnCharacters } from "../ownCharacters.js";
import type { AccountSession } from "./auth.js";

const path = "/api/account/characters";
const queues = new WeakMap<StorageLike, Promise<unknown>>();

/** The account already holds as many characters as it can; the ones that didn't fit stay on this device. */
export class CharacterLimitError extends Error {
  constructor() { super("Your account holds as many characters as it can"); }
}

async function request(account: AccountSession, body?: { characters: readonly OwnCharacter[] }): Promise<OwnCharacter[]> {
  const response = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin",
    headers: { "X-Expected-Player-ID": account.playerId, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  if (response.status === 409 && body) throw new CharacterLimitError();
  if (!response.ok) throw new Error("Characters are unavailable");
  const result: unknown = await response.json();
  if (!result || typeof result !== "object" || !("characters" in result) || !Array.isArray(result.characters)
    || !result.characters.every(isOwnCharacter)) throw new Error("Invalid characters");
  return result.characters as OwnCharacter[];
}

/** This account's characters, or ones made on this device before any account synced them. */
const belongsTo = (character: OwnCharacter, account: AccountSession) => character.owner === undefined || character.owner === account.playerId;

/** Local characters of this account that the account lacks, or holds an older edit of. */
function unsent(storage: StorageLike, account: AccountSession, remote: readonly OwnCharacter[]): OwnCharacter[] {
  const known = new Map(remote.map((character) => [character.id, character.updatedAt]));
  return loadOwnCharacters(storage).filter((character) => belongsTo(character, account) && character.updatedAt > (known.get(character.id) ?? -1));
}

/** Keeps the account's characters (tagged as its own) with other accounts' on this device, reloaded at commit time. */
function merge(storage: StorageLike, account: AccountSession, remote: readonly OwnCharacter[]): OwnCharacter[] {
  const others = loadOwnCharacters(storage).filter((character) => !belongsTo(character, account));
  // Edits made while the request was out stay, to go up with the next sync.
  const later = unsent(storage, account, remote);
  const merged = remote.map((character) => later.find((entry) => entry.id === character.id) ?? { ...character, owner: account.playerId });
  return saveOwnCharacters(storage, [...others, ...merged, ...later.filter((entry) => !remote.some((character) => character.id === entry.id))]);
}

function queued<T>(storage: StorageLike, work: () => Promise<T>): Promise<T> {
  const pending = (queues.get(storage) ?? Promise.resolve()).catch(() => {}).then(work);
  queues.set(storage, pending);
  return pending;
}

/**
 * Brings this device's own characters and the account's together: sends the ones the account lacks or holds an older
 * edit of, then keeps the account's list, deletions included. Called with the bot results sync.
 */
export function syncCharacters(storage: StorageLike, account: AccountSession): Promise<OwnCharacter[]> {
  return queued(storage, async () => {
    let remote = await request(account);
    const missing = unsent(storage, account, remote).slice(-MAX_STORED_CHARACTERS).map(ownCharacterFields);
    if (!missing.length) return merge(storage, account, remote);
    try {
      remote = await request(account, { characters: missing });
    } catch (error) {
      if (!(error instanceof CharacterLimitError)) throw error;
      // Still send edits and deletions of characters the account holds, and take its list; new ones wait on this device.
      const held = missing.filter((character) => remote.some((entry) => entry.id === character.id));
      if (held.length) remote = await request(account, { characters: held }).catch(() => remote);
      merge(storage, account, remote);
      throw error;
    }
    return merge(storage, account, remote);
  });
}

/** Sends characters just created, edited or deleted; the local copy is already saved, and a failure is retried by the next sync. */
export function uploadCharacters(storage: StorageLike, account: AccountSession, changed: readonly OwnCharacter[]): Promise<OwnCharacter[]> {
  // Never another account's character, even one shown by mistake.
  const mine = changed.filter((character) => belongsTo(character, account)).map(ownCharacterFields);
  if (!mine.length) return Promise.resolve(loadOwnCharacters(storage));
  return queued(storage, async () => merge(storage, account, await request(account, { characters: mine })));
}
