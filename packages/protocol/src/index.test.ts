import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, cleanName, parseClientMessage, type ClientMessage } from "./index.js";

const secret = "a".repeat(32);
const valid: ClientMessage[] = [
  { type: "hello", version: PROTOCOL_VERSION, secret, name: "Ann" },
  { type: "sit", seat: "north" },
  { type: "leave" },
  { type: "setBot", seat: "east", skill: "expert" },
  { type: "clearSeat", seat: "west" },
  { type: "deal" },
  { type: "act", handNumber: 1, revision: 4, action: { type: "bid", seat: "south", bid: "1notrump" } },
  { type: "act", handNumber: 1, revision: 5, action: { type: "bid", seat: "south", bid: "pass" } },
  { type: "act", handNumber: 2, revision: 9, action: { type: "play", seat: "west", card: { suit: "hearts", rank: "T" } } },
  { type: "handToBot", seat: "south" },
  { type: "resume" },
  { type: "autoPlay" },
  { type: "takeBack" },
  { type: "cancelHand" }
];
const parse = (v: unknown) => parseClientMessage(JSON.stringify(v));

describe("parseClientMessage", () => {
  it.each(valid)("round-trips %j", (m) => expect(parse(m)).toEqual(m));

  it("rejects non-JSON, arrays, and non-objects", () => {
    expect(parseClientMessage("nope")).toBeUndefined();
    expect(parse([])).toBeUndefined();
    expect(parse(null)).toBeUndefined();
    expect(parse("sit")).toBeUndefined();
  });

  it("rejects unknown types, missing fields and wrong field types", () => {
    expect(parse({ type: "explode" })).toBeUndefined();
    expect(parse({ type: "sit" })).toBeUndefined();
    expect(parse({ type: "sit", seat: 3 })).toBeUndefined();
    expect(parse({ type: "setBot", seat: "east", skill: "godlike" })).toBeUndefined();
    expect(parse({ type: "hello", version: "1", secret, name: "Ann" })).toBeUndefined();
    expect(parse({ type: "hello", version: 1, secret, name: 7 })).toBeUndefined();
    expect(parse({ type: "act", handNumber: "1", revision: 1, action: { type: "bid", seat: "north", bid: "pass" } })).toBeUndefined();
  });

  it("rejects bad seats, bids, cards and secrets", () => {
    expect(parse({ type: "sit", seat: "up" })).toBeUndefined();
    const act = (action: unknown) => parse({ type: "act", handNumber: 1, revision: 1, action });
    expect(act({ type: "bid", seat: "north", bid: "8clubs" })).toBeUndefined();
    expect(act({ type: "bid", seat: "north", bid: "0clubs" })).toBeUndefined();
    expect(act({ type: "play", seat: "north", card: { suit: "spades", rank: "1" } })).toBeUndefined();
    expect(act({ type: "play", seat: "north", card: { suit: "stars", rank: "A" } })).toBeUndefined();
    expect(act({ type: "play", seat: "up", card: { suit: "spades", rank: "A" } })).toBeUndefined();
    expect(act({ type: "other", seat: "north" })).toBeUndefined();
    expect(parse({ type: "hello", version: 1, secret: "a".repeat(10), name: "Ann" })).toBeUndefined();
    expect(parse({ type: "hello", version: 1, secret: "a".repeat(129), name: "Ann" })).toBeUndefined();
    expect(parse({ type: "hello", version: 1, secret: "a".repeat(31) + "!", name: "Ann" })).toBeUndefined();
  });

  it("rejects an invalid player name in hello", () => {
    expect(parse({ type: "hello", version: 1, secret, name: "   " })).toBeUndefined();
    expect(parse({ type: "hello", version: 1, secret, name: "x".repeat(21) })).toBeUndefined();
  });

  it("rejects messages over the byte limit, counting UTF-8 bytes", () => {
    const pad = (s: string) => JSON.stringify({ type: "leave", pad: s });
    expect(parseClientMessage(pad("x".repeat(MAX_MESSAGE_BYTES)))).toBeUndefined();
    // 2000 two-byte characters: fewer than 4096 chars but more than 4096 bytes.
    const multi = pad("é".repeat(2100));
    expect(multi.length).toBeLessThan(MAX_MESSAGE_BYTES);
    expect(new TextEncoder().encode(multi).length).toBeGreaterThan(MAX_MESSAGE_BYTES);
    expect(parseClientMessage(multi)).toBeUndefined();
    expect(parseClientMessage(pad("x".repeat(100)))).toEqual({ type: "leave" });
  });
});

describe("cleanName", () => {
  it("trims, strips control characters and collapses whitespace", () => {
    expect(cleanName("  Ann\u0000  B ", 20)).toBe("Ann B");
  });
  it("rejects empty, too long and non-string values", () => {
    expect(cleanName("", 20)).toBeUndefined();
    expect(cleanName(" \u0001 ", 20)).toBeUndefined();
    expect(cleanName("x".repeat(21), 20)).toBeUndefined();
    expect(cleanName("x".repeat(20), 20)).toBe("x".repeat(20));
    expect(cleanName(5, 20)).toBeUndefined();
  });
  it("removes zero-width and bidirectional format characters", () => {
    expect(cleanName("An\u200Bn \u202Eevil", 20)).toBe("Ann evil");
    expect(cleanName("\u200B\u202E\u2066\uFEFF", 20)).toBeUndefined();
    expect(cleanName(" \u200B \u202E ", 20)).toBeUndefined();
  });
  it("rejects lone surrogates", () => {
    expect(cleanName("Ann\uD83D", 20)).toBeUndefined();
    expect(cleanName("\uDE00Ann", 20)).toBeUndefined();
  });
  it("keeps non-Latin names and emoji; a zero-width joiner sequence loses its joiner", () => {
    expect(cleanName("Zoë Łukasz", 20)).toBe("Zoë Łukasz");
    expect(cleanName("Андрей 山田 أحمد", 20)).toBe("Андрей 山田 أحمد");
    expect(cleanName("Ann \u{1F642}\u{1F0CF}", 20)).toBe("Ann \u{1F642}\u{1F0CF}");
    expect(cleanName("\u{1F469}\u200D\u{1F4BB}", 20)).toBe("\u{1F469}\u{1F4BB}");
  });
});
