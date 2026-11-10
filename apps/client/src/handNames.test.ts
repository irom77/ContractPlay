import { describe, expect, it } from "vitest";
import { createHandName, handNameFromId } from "./handNames.js";

describe("hand names", () => {
  it("creates a two-word name from the random source", () => {
    expect(createHandName(new Set(), () => 0)).toBe("Bold Finesse");
    expect(createHandName(new Set(), () => 0.999999)).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });

  it("skips names that are already taken", () => {
    const first = createHandName(new Set(), () => 0);
    const second = createHandName(new Set([first]), () => 0);
    expect(second).not.toBe(first);
  });

  it("derives the same name from the same hand id", () => {
    expect(handNameFromId("saved-hand")).toBe(handNameFromId("saved-hand"));
    expect(handNameFromId("saved-hand")).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});
