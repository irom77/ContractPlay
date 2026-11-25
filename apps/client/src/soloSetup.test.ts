import { TRAIT_PRESETS } from "@contractplay/core";
import type { OwnCharacter } from "@contractplay/persistence";
import { describe, expect, it } from "vitest";
import { botSettingsAt, castCharacterAt, castHasCustom, castRoleOf, customCast, defaultSoloSetup, loadSoloSetup, saveSoloSetup } from "./soloSetup.js";

const memory = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
};
const broken = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("solo setup storage", () => {
  it("defaults to bots, North, Beginner, SAYC, Normal, rubber", () => {
    expect(loadSoloSetup(memory())).toEqual({ opponents: "bots", seat: "north", botSkill: "beginner", biddingStyle: "SAYC", botAggression: "normal", cast: customCast, scoring: "rubber" });
    expect(defaultSoloSetup).toEqual(loadSoloSetup(memory()));
  });

  it("round-trips every field", () => {
    const storage = memory();
    const setup = { opponents: "manual", seat: "west", botSkill: "expert", biddingStyle: "2/1", botAggression: "aggressive", cast: { partner: "bea", left: "custom", right: "tess" }, scoring: "single" } as const;
    saveSoloSetup(storage, setup);
    expect(loadSoloSetup(storage)).toEqual(setup);
    expect(storage.getItem("contractplay.scoring")).toBe("single");
  });

  it("keeps a scoring choice stored before this change", () => {
    expect(loadSoloSetup(memory({ "contractplay.scoring": "single" }))).toEqual({ ...defaultSoloSetup, scoring: "single" });
  });

  it("falls back field by field on bad stored values", () => {
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": '{"seat":"up","botSkill":"expert","opponents":7,"botAggression":"wild"}' })))
      .toEqual({ ...defaultSoloSetup, botSkill: "expert" });
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": '{"botAggression":"conservative"}' })))
      .toEqual({ ...defaultSoloSetup, botAggression: "conservative" });
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": '{"cast":{"partner":"kim","left":"nobody","right":3}}' })))
      .toEqual({ ...defaultSoloSetup, cast: { partner: "kim", left: "custom", right: "custom" } });
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": '{"cast":"bea"}' }))).toEqual(defaultSoloSetup);
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": "{not json" }))).toEqual(defaultSoloSetup);
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": "null" }))).toEqual(defaultSoloSetup);
  });

  it("ignores storage that throws", () => {
    expect(loadSoloSetup(broken)).toEqual(defaultSoloSetup);
    expect(() => saveSoloSetup(broken, defaultSoloSetup)).not.toThrow();
  });

  it("seats the cast around the player", () => {
    expect([castRoleOf("north", "south"), castRoleOf("west", "south"), castRoleOf("east", "south"), castRoleOf("south", "south")])
      .toEqual(["partner", "left", "right", undefined]);
    const cast = { partner: "bea", left: "tess", right: "custom" };
    expect(castCharacterAt(cast, "north", "south", [])?.name).toBe("Bold Bea");
    expect(castCharacterAt(cast, "west", "south", [])?.name).toBe("Timid Tess");
    expect(castCharacterAt(cast, "east", "south", [])).toBeUndefined();
    const setup = { cast, botSkill: "expert", botAggression: "normal" } as const;
    expect(botSettingsAt(setup, "north", "south", [])).toEqual({ skill: "advanced", aggression: "aggressive" });
    expect(botSettingsAt(setup, "west", "south", [])).toEqual({ skill: "beginner", aggression: "conservative" });
    // A custom bot, and the bot playing the player's own cards on auto play, take the setup's own settings.
    expect(botSettingsAt(setup, "east", "south", [])).toEqual({ skill: "expert", aggression: "normal" });
    expect(botSettingsAt(setup, "south", "south", [])).toEqual({ skill: "expert", aggression: "normal" });
    expect(castHasCustom(cast, [])).toBe(true);
    expect(castHasCustom({ partner: "bea", left: "tess", right: "kim" }, [])).toBe(false);
  });

  const gina: OwnCharacter = { id: "own-abc123", name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced",
    traits: { ...TRAIT_PRESETS.normal, doubles: "cautious" }, updatedAt: 5 };
  const withGina = { partner: gina.id, left: "tess", right: "custom" };

  it("keeps an own character in the cast", () => {
    const storage = memory();
    saveSoloSetup(storage, { ...defaultSoloSetup, cast: withGina });
    expect(loadSoloSetup(storage).cast).toEqual(withGina);
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": '{"cast":{"partner":"own-!"}}' })).cast).toEqual(customCast);
  });

  it("an own character plays with its own dials", () => {
    const setup = { cast: withGina, botSkill: "expert", botAggression: "aggressive" } as const;
    expect(castCharacterAt(withGina, "north", "south", [gina])?.name).toBe("Gentle Gina");
    expect(botSettingsAt(setup, "north", "south", [gina])).toEqual({ skill: "advanced", aggression: "normal", traits: gina.traits });
    expect(castHasCustom({ ...withGina, right: "kim" }, [gina])).toBe(false);
  });

  it("a missing own character plays as the custom bot", () => {
    const setup = { cast: withGina, botSkill: "expert", botAggression: "aggressive" } as const;
    expect(castCharacterAt(withGina, "north", "south", [])).toBeUndefined();
    expect(botSettingsAt(setup, "north", "south", [{ ...gina, deleted: true }])).toEqual({ skill: "expert", aggression: "aggressive" });
    expect(castHasCustom({ ...withGina, right: "kim" }, [])).toBe(true);
  });
});
