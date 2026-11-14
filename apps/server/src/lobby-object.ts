import { DurableObject } from "cloudflare:workers";
import { createDeck, deal, shuffle } from "@contractplay/core";
import type { Vulnerability } from "@contractplay/core";
import { MAX_TABLE_NAME } from "@contractplay/protocol";
import type { TableScoring, TableStyle, TableSummary } from "@contractplay/protocol";

/** Listed and unlisted tables are capped separately, so neither kind can starve the other. */
export const MAX_LISTED_TABLES = 100, MAX_UNLISTED_TABLES = 400;
/** Most tables one client (by hashed IP) may create in a rolling hour. */
export const MAX_CREATES_PER_HOUR = 10;
const HOUR_MS = 3_600_000;
export const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Listed tables get short ids; an unlisted table's id is all that protects it, so it is longer. */
export const LISTED_ID_LENGTH = 6, UNLISTED_ID_LENGTH = 12;
const LISTED = "listed:";
const UNLISTED = "unlisted:";
/** `rate:<salted sha-256 of the client IP>` → times of that client's creations in the last hour. */
const RATE = "rate:";
/** 32 random bytes, made on first use and kept, mixed into every client-address hash. */
const SALT = "salt";
/** Most keys one storage.delete call accepts. */
const DELETE_BATCH = 128;

function secureRandom(): number { return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32; }

/** A lobby entry; `summary` is missing while the table is being created (the id is reserved). */
type Entry = { listed: boolean; summary?: TableSummary };

/** `scoring` is missing only from callers that predate rubber tables; the table then scores rubbers. */
export type NewTable = { name: string; style: TableStyle; scoring?: TableScoring; listed: boolean };

/** `length` characters from a 32-letter alphabet; 256 is a multiple of 32, so `byte % 32` is uniform. */
function randomTableId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

/** The single lobby: every live table by id, listed or not. Only listed tables are shown and capped. */
export class LobbyObject extends DurableObject<Env> {
  /** The caps; a field so tests can lower them instead of creating hundreds of tables. */
  limits = { listed: MAX_LISTED_TABLES, unlisted: MAX_UNLISTED_TABLES };

  async list(): Promise<TableSummary[]> {
    const entries = await this.ctx.storage.list<Entry>({ prefix: LISTED });
    return [...entries.values()].flatMap((entry) => (entry.summary ? [entry.summary] : []));
  }

  /** All live tables for administration, including unlisted tables. */
  async listAll(): Promise<(TableSummary & { listed: boolean })[]> {
    const entries = await Promise.all([
      this.ctx.storage.list<Entry>({ prefix: LISTED }),
      this.ctx.storage.list<Entry>({ prefix: UNLISTED })
    ]);
    return entries.flatMap((group) => [...group.values()].flatMap((entry) =>
      entry.summary ? [{ ...entry.summary, listed: entry.listed }] : []
    ));
  }

  /**
   * `address` is the client's IP (or "unknown"); it is only hashed with this deployment's salt and is
   * never stored, logged, or sent anywhere.
   */
  async createTable(input: NewTable, address: string): Promise<{ id: string } | { error: "too-many-tables" | "too-many-requests" }> {
    const client = await this.clientKey(address);
    const now = Date.now();
    const recent = await this.recentCreations(client, now);
    if (recent.length >= MAX_CREATES_PER_HOUR) return { error: "too-many-requests" };
    const prefix = input.listed ? LISTED : UNLISTED;
    const cap = input.listed ? this.limits.listed : this.limits.unlisted;
    if ((await this.ctx.storage.list({ prefix })).size >= cap) return { error: "too-many-tables" };
    // counted before the call out, so concurrent requests from one client cannot overshoot the limit
    await this.ctx.storage.put(RATE + client, [...recent, now]);
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = randomTableId(input.listed ? LISTED_ID_LENGTH : UNLISTED_ID_LENGTH);
      if (await this.entry(id)) continue;
      // reserve the id (and the listed slot) before the call out, so concurrent creates cannot overshoot the cap
      const key = (input.listed ? LISTED : UNLISTED) + id;
      await this.ctx.storage.put<Entry>(key, { listed: input.listed });
      let summary: TableSummary | undefined;
      try {
        summary = await this.env.TABLES.get(this.env.TABLES.idFromName(id)).create({ id, ...input });
      } catch (error) {
        await this.ctx.storage.delete(key);
        throw error;
      }
      if (!summary) {
        await this.ctx.storage.delete(key);
        continue;
      }
      await this.ctx.storage.put<Entry>(key, { listed: input.listed, summary });
      return { id };
    }
    throw new Error("could not allocate a table id");
  }

  /** Creates a fixed set of duplicate tables and a shared generated board set. */
  async createSession(input: { name: string; style: TableStyle; tableCount: number; boardCount: number; scoring: "matchpoints" | "imps"; listed: boolean }, address: string): Promise<{ sessionId: string; tableIds: string[] } | { error: string }> {
    if (!Number.isInteger(input.tableCount) || input.tableCount < 2 || input.tableCount > 8
      || !Number.isInteger(input.boardCount) || input.boardCount < 1 || input.boardCount > 32) return { error: "bad-request" };
    const sessionId = randomTableId(UNLISTED_ID_LENGTH);
    const tableIds: string[] = [];
    const prefix = input.name.trim().slice(0, Math.max(1, MAX_TABLE_NAME - 16));
    for (let i = 0; i < input.tableCount; i++) {
      const created = await this.createTable({ name: `${prefix} · ${i + 1}`, style: input.style, scoring: "duplicate", listed: input.listed }, address);
      if ("error" in created) {
        await this.rollbackTables(tableIds);
        return created;
      }
      tableIds.push(created.id);
    }
    const vulnerability: readonly Vulnerability[] = ["None", "NS", "EW", "Both", "NS", "EW", "Both", "None", "EW", "Both", "None", "NS", "Both", "None", "NS", "EW"];
    const boards = Array.from({ length: input.boardCount }, (_, index) => ({
      number: index + 1,
      deal: deal(shuffle(createDeck(), secureRandom)),
      dealer: (["north", "east", "south", "west"] as const)[index % 4]!,
      vulnerability: vulnerability[index % vulnerability.length]!
    }));
    const sessionStub = this.env.SESSIONS.get(this.env.SESSIONS.idFromName(sessionId));
    try {
      if (!(await sessionStub.create({ id: sessionId, tables: tableIds, boards, scoring: input.scoring }))) throw new Error("session id collision");
      const bound = await Promise.all(tableIds.map((id) => this.env.TABLES.get(this.env.TABLES.idFromName(id)).bindSession(sessionId)));
      if (bound.some((summary) => summary === undefined)) throw new Error("could not bind all tables to the session");
      for (const summary of bound) if (summary) await this.update(summary);
      return { sessionId, tableIds };
    } catch (error) {
      await sessionStub.deleteForRollback();
      await this.rollbackTables(tableIds);
      throw error;
    }
  }

  private async rollbackTables(ids: readonly string[]): Promise<void> {
    for (const id of ids) {
      await this.remove(id);
      await this.env.TABLES.get(this.env.TABLES.idFromName(id)).fetch("https://table/_admin/delete", { method: "DELETE" }).catch(() => undefined);
    }
  }

  /** Lowercase hex SHA-256 of the salt followed by the address. */
  private async clientKey(address: string): Promise<string> {
    const salt = await this.salt();
    const text = new TextEncoder().encode(address);
    const data = new Uint8Array(salt.length + text.length);
    data.set(salt);
    data.set(text, salt.length);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  /** This deployment's salt, generated and stored on first use. */
  private async salt(): Promise<Uint8Array> {
    const stored = await this.ctx.storage.get<Uint8Array>(SALT);
    if (stored) return stored;
    const salt = crypto.getRandomValues(new Uint8Array(32));
    await this.ctx.storage.put(SALT, salt);
    return salt;
  }

  /** The client's creation times within the last hour; drops every client's record that is older. */
  private async recentCreations(client: string, now: number): Promise<number[]> {
    const records = await this.ctx.storage.list<number[]>({ prefix: RATE });
    const stale = [...records].filter(([, times]) => times.every((t) => t <= now - HOUR_MS)).map(([key]) => key);
    for (let i = 0; i < stale.length; i += DELETE_BATCH) await this.ctx.storage.delete(stale.slice(i, i + DELETE_BATCH));
    return (records.get(RATE + client) ?? []).filter((t) => t > now - HOUR_MS);
  }

  /** Records a table's new summary; ignored for a table the lobby no longer holds. */
  async update(summary: TableSummary): Promise<void> {
    const found = await this.entry(summary.id);
    if (found) await this.ctx.storage.put<Entry>(found.key, { listed: found.entry.listed, summary });
  }

  async remove(id: string): Promise<void> {
    await this.ctx.storage.delete([LISTED + id, UNLISTED + id]);
  }

  private async entry(id: string): Promise<{ key: string; entry: Entry } | undefined> {
    for (const key of [LISTED + id, UNLISTED + id]) {
      const entry = await this.ctx.storage.get<Entry>(key);
      if (entry) return { key, entry };
    }
    return undefined;
  }
}

/** The stub of the one lobby. */
export const lobbyOf = (env: Env) => env.LOBBY.get(env.LOBBY.idFromName("lobby"));
