import { describe, expect, it } from "vitest";
import { defaultSoloSetup, loadSoloSetup, saveSoloSetup } from "./soloSetup.js";

const memory = (entries: Record<string, string> = {}) => {
  const map = new Map(Object.entries(entries));
  return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); } };
};
const broken = { getItem: (): string | null => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };

describe("solo setup storage", () => {
  it("defaults to bots, North, Beginner, SAYC, Normal, rubber", () => {
    expect(loadSoloSetup(memory())).toEqual({ opponents: "bots", seat: "north", botSkill: "beginner", biddingStyle: "SAYC", botAggression: "normal", scoring: "rubber" });
    expect(defaultSoloSetup).toEqual(loadSoloSetup(memory()));
  });

  it("round-trips every field", () => {
    const storage = memory();
    const setup = { opponents: "manual", seat: "west", botSkill: "expert", biddingStyle: "2/1", botAggression: "aggressive", scoring: "single" } as const;
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
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": "{not json" }))).toEqual(defaultSoloSetup);
    expect(loadSoloSetup(memory({ "contractplay.soloSetup": "null" }))).toEqual(defaultSoloSetup);
  });

  it("ignores storage that throws", () => {
    expect(loadSoloSetup(broken)).toEqual(defaultSoloSetup);
    expect(() => saveSoloSetup(broken, defaultSoloSetup)).not.toThrow();
  });
});
