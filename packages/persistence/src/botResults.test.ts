import { describe, expect, it } from "vitest";
import { botResultFields, isBotResult } from "./botResults.js";

const withGina = { handId: "h1", partner: "own-abc123", left: "tess", right: "custom", score: 50, declared: false, made: false,
  names: { "own-abc123": "Gentle Gina" } };

describe("bot results with own characters", () => {
  it("accepts own characters with their names", () => {
    expect(isBotResult(withGina)).toBe(true);
    expect(botResultFields(withGina).names).toEqual({ "own-abc123": "Gentle Gina" });
  });

  it("rejects names for seats that are not own characters", () => {
    expect(isBotResult({ ...withGina, names: { tess: "Timid Tess" } })).toBe(false);
    expect(isBotResult({ ...withGina, names: { "own-zzz999": "Ghost" } })).toBe(false);
    expect(isBotResult({ ...withGina, names: { "own-abc123": "" } })).toBe(false);
    expect(isBotResult({ ...withGina, names: [] })).toBe(false);
  });
});
