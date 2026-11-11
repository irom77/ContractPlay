import { describe, expect, it } from "vitest";
import { newTable, send, sendOk } from "./test-helpers.js";

describe("seats", () => {
  it("makes the first sitter host and refuses a taken seat or a second seat", () => {
    const a = sendOk(newTable(), "alice", { type: "sit", seat: "north" }, 5);
    expect(a.host).toBe("alice");
    expect(a.revision).toBe(1);
    expect(send(a, "bob", { type: "sit", seat: "north" })).toEqual({ state: a, refused: "seat-taken" });
    expect(send(a, "alice", { type: "sit", seat: "east" }).refused).toBe("already-seated");
    const b = sendOk(a, "bob", { type: "sit", seat: "south" }, 6);
    expect(b.host).toBe("alice");
    expect(send(b, "bob", { type: "sit", seat: "west" }).refused).toBe("already-seated");
  });

  it("never uses the player id as a display name", () => {
    const named = { ...newTable(), names: { alice: "Alice" } };
    expect(sendOk(named, "alice", { type: "sit", seat: "north" }).seats.north).toMatchObject({ name: "Alice" });
    expect(sendOk(named, "secret-hash-id", { type: "sit", seat: "east" }).seats.east).toMatchObject({ name: "Player" });
  });

  it("lets a seated player set and clear bots; unseated players cannot", () => {
    const a = sendOk(newTable(), "alice", { type: "sit", seat: "north" });
    const refused = send(a, "zed", { type: "setBot", seat: "east", skill: "expert" });
    expect(refused.refused).toBe("not-seated");
    expect(refused.state).toBe(a);
    const b = sendOk(a, "alice", { type: "setBot", seat: "east", skill: "expert" });
    expect(b.seats.east).toEqual({ kind: "bot", skill: "expert" });
    expect(send(b, "zed", { type: "sit", seat: "east" }).refused).toBe("seat-taken");
    expect(send(b, "alice", { type: "setBot", seat: "north", skill: "expert" }).refused).toBe("not-allowed");
    const c = sendOk(b, "alice", { type: "clearSeat", seat: "east" });
    expect(c.seats.east).toEqual({ kind: "empty" });
    expect(c.revision).toBe(3);
  });

  it("lets only the host clear a present human, or anyone when that human is away", () => {
    let t = sendOk(newTable(), "alice", { type: "sit", seat: "north" }, 1);
    t = sendOk(t, "bob", { type: "sit", seat: "east" }, 2);
    t = sendOk(t, "cy", { type: "sit", seat: "south" }, 3);
    expect(send(t, "bob", { type: "clearSeat", seat: "south" }).refused).toBe("not-allowed");
    const away = { ...t, awaySince: { cy: 9 } };
    expect(send(away, "bob", { type: "clearSeat", seat: "south" }).state.seats.south).toEqual({ kind: "empty" });
    const cleared = sendOk(t, "alice", { type: "clearSeat", seat: "south" });
    expect(cleared.seats.south).toEqual({ kind: "empty" });
    expect(send(t, "alice", { type: "clearSeat", seat: "west" }).refused).toBe("not-allowed");
  });

  it("passes host to the earliest sitter when the host leaves", () => {
    let t = sendOk(newTable(), "alice", { type: "sit", seat: "north" }, 10);
    t = sendOk(t, "cy", { type: "sit", seat: "south" }, 30);
    t = sendOk(t, "bob", { type: "sit", seat: "east" }, 20);
    const left = sendOk(t, "alice", { type: "leave" });
    expect(left.host).toBe("bob");
    expect(left.seats.north.kind).toBe("empty");
    const rest = sendOk(sendOk(left, "bob", { type: "leave" }), "cy", { type: "leave" });
    expect(rest.host).toBeUndefined();
    expect("host" in rest).toBe(false);
    expect(send(rest, "cy", { type: "leave" }).refused).toBe("not-seated");
  });

  it("bumps the revision once per accepted change and never mutates", () => {
    const start = newTable();
    const frozen = JSON.stringify(start);
    const a = sendOk(start, "alice", { type: "sit", seat: "north" });
    const b = sendOk(a, "alice", { type: "setBot", seat: "east", skill: "beginner" });
    const c = sendOk(b, "alice", { type: "leave" });
    expect([a.revision, b.revision, c.revision]).toEqual([1, 2, 3]);
    expect(JSON.stringify(start)).toBe(frozen);
    expect(send(c, "alice", { type: "leave" }).state).toBe(c);
  });
});
