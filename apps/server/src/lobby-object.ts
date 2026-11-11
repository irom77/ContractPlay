import { DurableObject } from "cloudflare:workers";
import type { TableStyle, TableSummary } from "@contractplay/protocol";

export const MAX_LISTED_TABLES = 100;
/** Most tables, listed and unlisted together. */
export const MAX_TABLES = 500;
export const ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Listed tables get short ids; an unlisted table's id is all that protects it, so it is longer. */
export const LISTED_ID_LENGTH = 6, UNLISTED_ID_LENGTH = 12;
const LISTED = "listed:";
const UNLISTED = "unlisted:";

/** A lobby entry; `summary` is missing while the table is being created (the id is reserved). */
type Entry = { listed: boolean; summary?: TableSummary };

export type NewTable = { name: string; style: TableStyle; listed: boolean };

/** `length` characters from a 32-letter alphabet; 256 is a multiple of 32, so `byte % 32` is uniform. */
function randomTableId(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

/** The single lobby: every live table by id, listed or not. Only listed tables are shown and capped. */
export class LobbyObject extends DurableObject<Env> {
  /** The caps; a field so tests can lower them instead of creating hundreds of tables. */
  limits = { listed: MAX_LISTED_TABLES, total: MAX_TABLES };

  async list(): Promise<TableSummary[]> {
    const entries = await this.ctx.storage.list<Entry>({ prefix: LISTED });
    return [...entries.values()].flatMap((entry) => (entry.summary ? [entry.summary] : []));
  }

  async createTable(input: NewTable): Promise<{ id: string } | { error: "too-many-tables" }> {
    const listed = (await this.ctx.storage.list({ prefix: LISTED })).size;
    const unlisted = (await this.ctx.storage.list({ prefix: UNLISTED })).size;
    if ((input.listed && listed >= this.limits.listed) || listed + unlisted >= this.limits.total) return { error: "too-many-tables" };
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
