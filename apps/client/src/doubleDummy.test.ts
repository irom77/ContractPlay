import { deal } from "@contractplay/core";
import { describe, expect, it } from "vitest";
import { serializeDdsDeal } from "./doubleDummy.js";

describe("serializeDdsDeal", () => {
  it("writes a valid deal clockwise from North, with ranks high to low and PBN suit order", () => {
    expect(serializeDdsDeal({
      north: [
        { suit: "spades", rank: "A" }, { suit: "spades", rank: "2" },
        { suit: "hearts", rank: "K" }, { suit: "diamonds", rank: "Q" },
        { suit: "clubs", rank: "J" }
      ],
      east: [], south: [], west: []
    })).toBe("N:A2.K.Q.J ... ... ...");
  });

  it("serializes all four hands from a valid bridge deal", () => {
    const serialized = serializeDdsDeal(deal());
    expect(serialized.startsWith("N:")).toBe(true);
    expect(serialized.split(" ")).toHaveLength(4);
    expect(serialized.match(/[2-9TJQKA]/g)).toHaveLength(52);
  });
});
