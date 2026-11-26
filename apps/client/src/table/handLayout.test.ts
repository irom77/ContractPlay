import { describe, expect, it } from "vitest";
import { defaultHandLayout, fanCardStyle, fanPosition, handLayoutMenuLabel, loadHandLayout, saveHandLayout } from "./handLayout.js";

describe("fan positions", () => {
  it("puts a full hand's outer cards at ±1 and its middle card at 0", () => {
    expect(fanPosition(0, 13)).toBe(-1);
    expect(fanPosition(6, 13)).toBe(0);
    expect(fanPosition(12, 13)).toBe(1);
  });

  it("keeps a short hand on the same curve, nearer the middle", () => {
    expect(fanPosition(0, 4)).toBeCloseTo(-0.25);
    expect(fanPosition(3, 4)).toBeCloseTo(0.25);
    expect(fanPosition(0, 1)).toBe(0);
  });

  it("styles cards only in the fan layout, which is the default", () => {
    expect(defaultHandLayout).toBe("fan");
    expect(fanCardStyle("fan", 12, 13)).toEqual({ "--fan-p": "1.0000" });
    expect(fanCardStyle("line", 12, 13)).toBeUndefined();
  });
});

describe("the remembered layout", () => {
  const memory = () => { const entries = new Map<string, string>(); return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); } }; };

  it("fans until the player chooses a line, and keeps that choice", () => {
    const storage = memory();
    expect(loadHandLayout(storage)).toBe("fan");
    saveHandLayout(storage, "line");
    expect(loadHandLayout(storage)).toBe("line");
    saveHandLayout(storage, "fan");
    expect(loadHandLayout(storage)).toBe("fan");
  });

  it("falls back to the fan when storage is missing or refuses", () => {
    expect(loadHandLayout(undefined)).toBe("fan");
    expect(loadHandLayout({ getItem: () => { throw new Error("blocked"); } })).toBe("fan");
    expect(() => saveHandLayout({ setItem: () => { throw new Error("full"); } }, "line")).not.toThrow();
  });

  it("names the menu entry for the layout it switches to", () => {
    expect(handLayoutMenuLabel("fan")).toBe("Lay cards in a line");
    expect(handLayoutMenuLabel("line")).toBe("Hold cards in a fan");
  });
});
