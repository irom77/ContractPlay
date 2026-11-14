import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import migration from "../migrations/0001_auth.sql?raw";
import { AuthStore } from "./auth-store.js";

const store = new AuthStore(env.DB);
const now = 1_000;
const link = (hash: string, guestPlayerId?: string) => store.insertMagicLink({
  tokenHash: hash, email: "test@example.com", displayName: "Test", expiresAt: now + 100,
  ...(guestPlayerId ? { guestPlayerId } : {})
});
const redeem = (tokenHash: string, sessionHash: string, at = now) => store.redeemMagicLink({
  tokenHash, sessionHash, now: at, sessionExpiresAt: now + 500
});

beforeAll(async () => {
  await env.DB.exec(migration.replace(/\n/g, " "));
});
beforeEach(async () => {
  await env.DB.batch(["online_hands", "sessions", "magic_links", "account_player_identities", "accounts"]
    .map((table) => env.DB.prepare(`DELETE FROM ${table}`)));
});

describe("AuthStore", () => {
  it("normalizes unique account emails and generates stable primary player IDs", async () => {
    const a = await store.getOrCreateAccount(" Test@Example.com ", "Test", now);
    const b = await store.getOrCreateAccount("test@example.com", "Other", now);
    expect(b).toEqual(a);
    expect(a.primaryPlayerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.findAccountByEmail(" TEST@example.com ")).toEqual(a);
    expect(await store.playerIdsForAccount(a.id)).toEqual([a.primaryPlayerId]);
  });

  it("links multiple guest identities without changing the account primary", async () => {
    await link("first", "guest-one");
    const account = await redeem("first", "session-one");
    expect(account?.primaryPlayerId).toBe("guest-one");
    await link("second", "guest-two");
    const again = await redeem("second", "session-two");
    expect(again).toEqual(account);
    expect(await store.playerIdsForAccount(account!.id)).toEqual(["guest-one", "guest-two"]);
  });

  it("consumes a valid link once even for concurrent redemptions", async () => {
    await link("once");
    const result = await Promise.all([redeem("once", "a"), redeem("once", "b")]);
    expect(result.filter(Boolean)).toHaveLength(1);
    expect((await env.DB.prepare("SELECT * FROM sessions").all()).results).toHaveLength(1);
  });

  it("rejects replay even when the caller repeats the same session hash", async () => {
    await link("repeat");
    expect(await redeem("repeat", "same-session")).not.toBeNull();
    expect(await redeem("repeat", "same-session")).toBeNull();
  });

  it("rejects missing and expired links without creating accounts or sessions", async () => {
    await link("old");
    expect(await redeem("old", "expired", now + 100)).toBeNull();
    expect(await redeem("missing", "unknown")).toBeNull();
    expect((await env.DB.prepare("SELECT * FROM accounts").all()).results).toHaveLength(0);
  });

  it("returns only unexpired, unrevoked sessions and revokes one device", async () => {
    await link("one");
    const account = await redeem("one", "session");
    await link("two");
    await redeem("two", "other");
    expect(await store.findSession("session", now)).toEqual(account);
    expect(await store.findSession("session", now + 500)).toBeNull();
    await store.revokeSession("session", now);
    expect(await store.findSession("session", now)).toBeNull();
    expect(await store.findSession("other", now)).toEqual(account);
  });

  it("rolls back token consumption when a guest already belongs to another account", async () => {
    const owner = await store.getOrCreateAccount("owner@example.com", "Owner", now, "guest");
    await link("conflict", "guest");
    await expect(redeem("conflict", "conflict-session")).rejects.toThrow();
    expect(await store.findAccountByEmail("test@example.com")).toBeNull();
    expect(await store.playerIdsForAccount(owner.id)).toEqual(["guest"]);
    expect((await env.DB.prepare("SELECT consumed_at FROM magic_links WHERE token_hash = ?").bind("conflict").first())?.consumed_at).toBeNull();
  });

  it("upserts hands idempotently, bounds retention to 25, and isolates accounts", async () => {
    const a = await store.getOrCreateAccount("a@example.com", "A", now);
    const b = await store.getOrCreateAccount("b@example.com", "B", now);
    for (let i = 0; i < 27; i++) await store.upsertHands(a.id, [{ id: `hand-${i}`, completedAt: i, data: { title: `Hand ${i}` } }]);
    await store.upsertHands(a.id, [{ id: "hand-26", completedAt: 26, data: { title: "Updated" } }]);
    const hands = await store.listHands(a.id);
    expect(hands).toHaveLength(25);
    expect(hands[0]).toEqual({ id: "hand-26", completedAt: 26, data: { title: "Updated" } });
    expect(hands.at(-1)?.id).toBe("hand-2");
    expect(await store.listHands(b.id)).toEqual([]);
  });
});
