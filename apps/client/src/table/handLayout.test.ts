import { describe, expect, it } from "vitest";
import { defaultHandLayout, fanCardStyle, fanPosition } from "./handLayout.js";

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
