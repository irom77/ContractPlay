import { TRAIT_PRESETS } from "@contractplay/core";
import type { OwnCharacter, StorageLike } from "@contractplay/persistence";
import { afterEach, expect, it, vi } from "vitest";
import { loadOwnCharacters, saveOwnCharacters } from "../ownCharacters.js";
import { CharacterLimitError, syncCharacters, uploadCharacters } from "./charactersSync.js";

const account = { playerId: "account-player", displayName: "Owner" };
const character = (id: string, updatedAt: number, extra: Partial<OwnCharacter> = {}): OwnCharacter =>
  ({ id, name: "Gentle Gina", blurb: "", skill: "advanced", traits: TRAIT_PRESETS.normal, updatedAt, ...extra });
function storageWith(characters: OwnCharacter[]): StorageLike {
  const data = new Map<string, string>();
  const storage: StorageLike = { getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: k => void data.delete(k) };
  saveOwnCharacters(storage, characters);
  return storage;
}
/** A service holding `remote` (newer edits win, at most `cap` live), recording each batch it is sent. */
function service(remote: OwnCharacter[], cap = 24) {
  const posted: string[][] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    expect(url).toBe("/api/account/characters");
    expect(new Headers(init?.headers).get("X-Expected-Player-ID")).toBe(account.playerId);
    if (init?.method === "POST") {
      const sent = (JSON.parse(init.body as string) as { characters: OwnCharacter[] }).characters;
      posted.push(sent.map(entry => `${entry.id}@${entry.updatedAt}`));
      const live = new Set(remote.filter(entry => !entry.deleted).map(entry => entry.id));
      for (const entry of sent) if (entry.deleted) live.delete(entry.id); else live.add(entry.id);
      if (live.size > cap) return Response.json({ error: "too-many-characters" }, { status: 409 });
      for (const entry of sent) {
        expect(entry.owner).toBeUndefined();
        const at = remote.findIndex(known => known.id === entry.id);
        if (at < 0) remote.push(entry); else if (remote[at]!.updatedAt < entry.updatedAt) remote[at] = entry;
      }
    }
    return Response.json({ characters: remote });
  }));
  return posted;
}
afterEach(() => vi.unstubAllGlobals());

it("sends what the account lacks or holds an older edit of, and keeps the account's list", async () => {
  const storage = storageWith([character("own-aaaaaa", 1), character("own-bbbbbb", 9, { name: "Newer" })]);
  const posted = service([character("own-zzzzzz", 0), character("own-bbbbbb", 2)]);
  const kept = await syncCharacters(storage, account);
  expect(posted).toEqual([["own-aaaaaa@1", "own-bbbbbb@9"]]);
  expect(kept.map(entry => entry.id)).toEqual(["own-zzzzzz", "own-bbbbbb", "own-aaaaaa"]);
  expect(loadOwnCharacters(storage).find(entry => entry.id === "own-bbbbbb")?.name).toBe("Newer");
  expect(loadOwnCharacters(storage).every(entry => entry.owner === account.playerId)).toBe(true);
  await syncCharacters(storage, account);
  expect(posted).toHaveLength(1);
});

it("a deletion on the account removes the local copy", async () => {
  const storage = storageWith([character("own-aaaaaa", 1)]);
  const posted = service([character("own-aaaaaa", 5, { deleted: true })]);
  await syncCharacters(storage, account);
  expect(posted).toEqual([]);
  expect(loadOwnCharacters(storage)).toEqual([{ ...character("own-aaaaaa", 5, { deleted: true }), owner: account.playerId }]);
});

it("leaves another account's characters alone", async () => {
  const storage = storageWith([character("own-theirs", 1, { owner: "someone-else" })]);
  const posted = service([]);
  await syncCharacters(storage, account);
  expect(posted).toEqual([]);
  expect(loadOwnCharacters(storage).map(entry => entry.id)).toEqual(["own-theirs"]);
});

it("uploads an edit", async () => {
  const storage = storageWith([character("own-aaaaaa", 3)]);
  const posted = service([character("own-aaaaaa", 1)]);
  await uploadCharacters(storage, account, [character("own-aaaaaa", 3)]);
  expect(posted).toEqual([["own-aaaaaa@3"]]);
  expect(loadOwnCharacters(storage)[0]?.owner).toBe(account.playerId);
});

it("never sends another account's character", async () => {
  const storage = storageWith([character("own-theirs", 1, { owner: "someone-else" })]);
  service([]);
  await uploadCharacters(storage, account, [character("own-theirs", 2, { owner: "someone-else" })]);
  expect(vi.mocked(fetch).mock.calls.filter(([, init]) => init?.method === "POST")).toEqual([]);
});

it("over the account's limit, still takes the account's list and sends what fits", async () => {
  const storage = storageWith([character("own-aaaaaa", 9, { name: "Edited" }), character("own-newone", 5), character("own-gone00", 7, { deleted: true })]);
  const posted = service([character("own-aaaaaa", 1), character("own-gone00", 1), character("own-zzzzzz", 0)], 2);
  await expect(syncCharacters(storage, account)).rejects.toBeInstanceOf(CharacterLimitError);
  // The new character didn't fit; the edit and the deletion of characters the account holds went up.
  expect(posted).toEqual([["own-aaaaaa@9", "own-newone@5", "own-gone00@7"], ["own-aaaaaa@9", "own-gone00@7"]]);
  const kept = loadOwnCharacters(storage);
  expect(kept.map(entry => entry.id)).toEqual(["own-aaaaaa", "own-gone00", "own-zzzzzz", "own-newone"]);
  expect(kept.find(entry => entry.id === "own-newone")?.owner).toBeUndefined();
});
