import { TRAIT_PRESETS } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { isOwnCharacter, ownCharacterFields, type OwnCharacter } from "./ownCharacters.js";

const gina: OwnCharacter = { id: "own-abc123", name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced",
  traits: { ...TRAIT_PRESETS.normal, doubles: "cautious" }, updatedAt: 5 };

describe("own characters", () => {
  it("accepts a full character", () => {
    expect(isOwnCharacter(gina)).toBe(true);
    expect(isOwnCharacter({ ...gina, deleted: true, owner: "p1", playEditedAt: 3 })).toBe(true);
  });

  it("rejects a bad character", () => {
    const withoutLeads: Record<string, string> = { ...gina.traits };
    delete withoutLeads.leads;
    for (const bad of [{ id: "tess" }, { id: "own-a" }, { name: " Gina" }, { name: "x".repeat(25) }, { blurb: "x".repeat(81) },
      { blurb: "bell\u0007" }, { skill: "master" }, { traits: withoutLeads }, { traits: { ...gina.traits, leads: "wild" } },
      { traits: { ...gina.traits, luck: "bold" } }, { updatedAt: -1 }, { deleted: false }, { playEditedAt: 1.5 }]) {
      expect(isOwnCharacter({ ...gina, ...bad }), JSON.stringify(bad)).toBe(false);
    }
    expect(isOwnCharacter(null)).toBe(false);
  });

  it("drops the owner", () => {
    expect(ownCharacterFields({ ...gina, owner: "p1", extra: 1 } as never)).toEqual(gina);
  });
});
