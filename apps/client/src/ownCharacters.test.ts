import { TRAIT_PRESETS } from "@contractplay/core";
import type { OwnCharacter } from "@contractplay/persistence";
import { describe, expect, it } from "vitest";
import { applyCharacters, charactersFor, checkDraft, createCharacter, deleteCharacter, liveCharacters, loadOwnCharacters, ownCharactersKey, rosterCharacter,
  saveOwnCharacters, startingPoints, updateCharacter, type CharacterDraft } from "./ownCharacters.js";

const memory = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
const gina: OwnCharacter = { id: "own-abc123", name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced",
  traits: { ...TRAIT_PRESETS.normal, doubles: "cautious" }, updatedAt: 5 };
const draft: CharacterDraft = { name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced", traits: gina.traits };

describe("own characters in the browser", () => {
  it("keeps only well-formed characters", () => {
    const stored = [gina, { ...gina, id: "own-def456", traits: { ...gina.traits, leads: "wild" } }, { ...gina, id: "own-ghi789", name: "x".repeat(200) }, { ...gina, name: "Copy" }];
    expect(loadOwnCharacters(memory({ [ownCharactersKey]: JSON.stringify(stored) }))).toEqual([gina]);
    expect(loadOwnCharacters(memory({ [ownCharactersKey]: "{oops" }))).toEqual([]);
    const storage = memory();
    saveOwnCharacters(storage, [gina]);
    expect(loadOwnCharacters(storage)).toEqual([gina]);
  });

  it("creates up to twelve", () => {
    let list: OwnCharacter[] = [];
    for (let index = 0; index < 12; index += 1) list = createCharacter(list, { ...draft, name: `Bot ${index}` }, index);
    expect(new Set(list.map((character) => character.id)).size).toBe(12);
    expect(list.every((character) => /^own-[a-z0-9]{10}$/.test(character.id))).toBe(true);
    expect(() => createCharacter(list, draft, 99)).toThrow();
    expect(createCharacter(deleteCharacter(list, list[0]!.id, 50), draft, 99)).toHaveLength(13);
  });

  it("marks play edits but not name edits", () => {
    const renamed = updateCharacter([gina], gina.id, { ...draft, name: "Gina", blurb: "Kind." }, 7)[0]!;
    expect(renamed).toMatchObject({ name: "Gina", blurb: "Kind.", updatedAt: 7 });
    expect(renamed.playEditedAt).toBeUndefined();
    const harder = updateCharacter([renamed], gina.id, { ...draft, skill: "expert" }, 8)[0]!;
    expect(harder.playEditedAt).toBe(8);
    expect(updateCharacter([harder], gina.id, { ...draft, skill: "expert", name: "G" }, 9)[0]!.playEditedAt).toBe(8);
    expect(updateCharacter([gina], gina.id, { ...draft, traits: { ...draft.traits, leads: "bold" } }, 10)[0]!.playEditedAt).toBe(10);
  });

  it("deletes as a tombstone", () => {
    const list = deleteCharacter([gina], gina.id, 9);
    expect(liveCharacters(list)).toEqual([]);
    expect(list[0]).toMatchObject({ id: gina.id, deleted: true, updatedAt: 9 });
  });

  it("looks up cast and own characters", () => {
    expect(rosterCharacter("tess", [])?.name).toBe("Timid Tess");
    expect(rosterCharacter(gina.id, [gina])).toMatchObject({ name: "Gentle Gina", skill: "advanced", traits: gina.traits });
    expect(rosterCharacter(gina.id, deleteCharacter([gina], gina.id, 9))).toBeUndefined();
    expect(rosterCharacter("custom", [gina])).toBeUndefined();
  });

  it("checks drafts", () => {
    expect(checkDraft({ ...draft, name: "  Gina  " })).toEqual({ draft: { ...draft, name: "Gina" } });
    expect(checkDraft({ ...draft, name: "" })).toEqual({ error: "Give your character a name of up to 24 characters." });
    expect(checkDraft({ ...draft, name: "x".repeat(25) })).toEqual({ error: "Give your character a name of up to 24 characters." });
    expect(checkDraft({ ...draft, blurb: "x".repeat(81) })).toEqual({ error: "Keep the description to 80 characters." });
  });

  it("starts from a preset or a cast member", () => {
    expect(startingPoints.slice(0, 3).map((point) => point.label)).toEqual(["Normal bot", "Conservative bot", "Aggressive bot"]);
    expect(startingPoints.find((point) => point.label === "Bold Bea")?.draft).toEqual({ name: "Bold Bea", blurb: "Competes on every hand.", skill: "advanced", traits: TRAIT_PRESETS.aggressive });
  });

  it("never stamps an edit older than the one it replaces", () => {
    const ahead = { ...gina, updatedAt: 100 };
    expect(updateCharacter([ahead], gina.id, { ...draft, skill: "expert" }, 50)[0]).toMatchObject({ updatedAt: 101, playEditedAt: 101 });
    expect(deleteCharacter([ahead], gina.id, 50)[0]!.updatedAt).toBe(101);
  });

  it("trims old deletions but never a live character", () => {
    const live = { ...gina, updatedAt: 0 };
    const deletions = Array.from({ length: 120 }, (_, index) => ({ ...gina, id: `own-dead${String(index).padStart(3, "0")}`, deleted: true as const, updatedAt: 10 + index }));
    const kept = saveOwnCharacters(memory(), [live, ...deletions]);
    expect(kept[0]).toEqual(live);
    expect(kept).toHaveLength(100);
    expect(kept.at(-1)!.updatedAt).toBe(129);
  });

  it("shows each account only its own characters and ones not yet synced", () => {
    const mine = { ...gina, id: "own-mine00", owner: "a" };
    const theirs = { ...gina, id: "own-their0", owner: "b" };
    const unsynced = { ...gina, id: "own-local0" };
    expect(charactersFor([mine, theirs, unsynced], "a")).toEqual([mine, unsynced]);
    expect(charactersFor([mine, theirs, unsynced], undefined)).toEqual([unsynced]);
    // A change puts in only what changed, keeping everyone else's characters and anything a sync just brought.
    const edited = { ...mine, name: "Mine" };
    const made = { ...gina, id: "own-new000" };
    expect(applyCharacters([mine, theirs, unsynced], [edited, made])).toEqual([edited, theirs, unsynced, made]);
  });
});
