import { describe, expect, it } from "vitest";
import type { StorageLike } from "@contractplay/persistence";
import { loadIdentity, saveIdentity } from "./identity.js";

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  };
}

describe("online identity", () => {
  it("keeps the secret and updates the name when saved twice", () => {
    const storage = memoryStorage();
    const first = saveIdentity(storage, "Ann");
    const second = saveIdentity(storage, "Bea");
    expect(second.secret).toBe(first.secret);
    expect(second.name).toBe("Bea");
    expect(loadIdentity(storage)).toEqual(second);
  });

  it("generates a 32-byte base64url secret", () => {
    expect(saveIdentity(memoryStorage(), "Ann").secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("returns undefined for missing or corrupt storage", () => {
    const storage = memoryStorage();
    expect(loadIdentity(storage)).toBeUndefined();
    storage.setItem("contractplay.online", "{not json");
    expect(loadIdentity(storage)).toBeUndefined();
    storage.setItem("contractplay.online", JSON.stringify({ secret: 1, name: "x" }));
    expect(loadIdentity(storage)).toBeUndefined();
  });

  it("replaces a corrupt identity with a fresh one on save", () => {
    const storage = memoryStorage();
    storage.setItem("contractplay.online", "oops");
    expect(saveIdentity(storage, "Ann").secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});
