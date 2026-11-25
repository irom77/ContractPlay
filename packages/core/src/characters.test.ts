import { AGGRESSIONS } from "./bots.js";
import { describe, expect, it } from "vitest";
import { BOT_CHARACTERS, botCharacter } from "./characters.js";

describe("bot characters", () => {
  it("has one character for every skill level and temperament", () => {
    const combos = new Set(BOT_CHARACTERS.map((c) => `${c.skill}/${c.aggression}`));
    expect(combos.size).toBe(12);
    for (const skill of ["beginner", "intermediate", "advanced", "expert"]) for (const aggression of AGGRESSIONS) expect(combos.has(`${skill}/${aggression}`)).toBe(true);
  });

  it("has unique ids and names", () => {
    expect(new Set(BOT_CHARACTERS.map((c) => c.id)).size).toBe(BOT_CHARACTERS.length);
    expect(new Set(BOT_CHARACTERS.map((c) => c.name)).size).toBe(BOT_CHARACTERS.length);
  });

  it("finds a character by id", () => {
    expect(botCharacter("bea")).toMatchObject({ name: "Bold Bea", skill: "advanced", aggression: "aggressive" });
    expect(botCharacter("nobody")).toBeUndefined();
    expect(botCharacter(undefined)).toBeUndefined();
  });
});
