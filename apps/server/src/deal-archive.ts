import {
  applyAction, cardId, contractText, createGameState, rescoreRow, SEATS,
  type Deal, type GameAction, type GameState, type HandRecord, type Seat, type TravellerRow, type Vulnerability
} from "@contractplay/core";

/** A deal is offered as a replay only once it was first played at least this long ago. */
export const REPLAY_MIN_AGE_MS = 86_400_000;
/** The most results besides the original that a replay record holds. */
export const MAX_FIELD_RESULTS = 50;

export type ArchiveInput = Readonly<{ deal: Deal; dealer: Seat; vulnerability: Vulnerability; actions: readonly GameAction[];
  source: "solo" | "online"; playedAt: number; replayOf?: string }>;
export type ReplayDeal = Readonly<{ dealId: string; record: HandRecord }>;

const VULNERABILITIES: readonly Vulnerability[] = ["None", "NS", "EW", "Both"];

type DealRow = { id: string; deal_json: string; dealer: Seat; vulnerability: Vulnerability; first_played_at: number; original_actions_json: string };
type ResultRow = { vulnerability: Vulnerability; contract: string; declarer: Seat | null; tricks: number | null; ns_score: number };

/** One deal per set of hands and dealer: each seat's sorted card ids, then the dealer. */
const dealKey = (deal: Deal, dealer: Seat): string =>
  [...SEATS.map((seat) => deal[seat].map(cardId).sort().join(",")), dealer].join("|");

/** The finished game the actions lead to, or undefined when one is illegal or the hand is not over. */
function finishedGame(input: ArchiveInput): GameState | undefined {
  if (!SEATS.includes(input.dealer) || !VULNERABILITIES.includes(input.vulnerability)) return undefined;
  try {
    let state = createGameState(input);
    for (const action of input.actions) {
      const result = applyAction(state, action);
      if (!result.ok) return undefined;
      state = result.state;
    }
    return state.phase === "complete" || state.phase === "passed-out" ? state : undefined;
  } catch {
    return undefined;
  }
}

const travellerRow = (row: ResultRow): TravellerRow => ({
  contract: row.contract,
  ...(row.declarer === null ? {} : { declarer: row.declarer }),
  ...(row.tricks === null ? {} : { tricks: row.tricks }),
  nsScore: row.ns_score,
  multiplicity: 1,
  artificial: false
});

/** Identical rows merged into one with their count, in order of first appearance. */
function grouped(rows: readonly TravellerRow[]): TravellerRow[] {
  const groups = new Map<string, TravellerRow>();
  for (const row of rows) {
    const key = JSON.stringify([row.contract, row.declarer, row.tricks, row.nsScore]);
    const existing = groups.get(key);
    groups.set(key, existing ? { ...existing, multiplicity: existing.multiplicity + row.multiplicity } : row);
  }
  return [...groups.values()];
}

/** Anonymous archive of finished deals and every result played on them, in D1. */
export class DealArchive {
  constructor(private readonly db: D1Database) {}

  /** The deal id the result was stored under, or undefined when the actions are not a legal finished hand or `replayOf` names another deal. */
  async record(input: ArchiveInput): Promise<string | undefined> {
    const game = finishedGame(input);
    if (!game) return undefined;
    const key = dealKey(input.deal, input.dealer);
    const contract = game.contract;
    const result = [input.playedAt, input.source, input.vulnerability, contractText(contract), contract?.declarer ?? null,
      game.score?.tricksTaken ?? null, game.score?.score ?? 0, game.claim ? 1 : 0];
    const insertResult = `INSERT INTO deal_results (deal_id, played_at, source, vulnerability, contract, declarer, tricks, ns_score, claimed)
      SELECT id, ?, ?, ?, ?, ?, ?, ?, ? FROM archived_deals`;
    if (input.replayOf !== undefined) {
      const stored = await this.db.prepare(`${insertResult} WHERE id = ? AND deal_key = ?`).bind(...result, input.replayOf, key).run();
      return stored.meta.changes === 1 ? input.replayOf : undefined;
    }
    const [, , found] = await this.db.batch([
      this.db.prepare(`INSERT INTO archived_deals (id, deal_key, deal_json, dealer, vulnerability, first_played_at, original_actions_json)
        VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(deal_key) DO NOTHING`)
        .bind(crypto.randomUUID(), key, JSON.stringify(input.deal), input.dealer, input.vulnerability, input.playedAt, JSON.stringify(input.actions)),
      this.db.prepare(`${insertResult} WHERE deal_key = ?`).bind(...result, key),
      this.db.prepare("SELECT id FROM archived_deals WHERE deal_key = ?").bind(key)
    ]);
    return (found!.results[0] as { id: string } | undefined)?.id;
  }

  /** A random deal first played at least REPLAY_MIN_AGE_MS before `now`; its record's field is rescored to `vulnerability` when given, else to the deal's own. */
  async pickReplay(now: number, vulnerability?: Vulnerability, random: () => number = Math.random): Promise<ReplayDeal | undefined> {
    const cutoff = now - REPLAY_MIN_AGE_MS;
    const newest = await this.db.prepare("SELECT rowid FROM archived_deals WHERE first_played_at <= ? ORDER BY first_played_at DESC LIMIT 1")
      .bind(cutoff).first<{ rowid: number }>();
    if (!newest) return undefined;
    // The newest eligible row bounds the probe, so a probe from any start at or below it finds a row.
    const probe = 1 + Math.floor(random() * newest.rowid);
    const deal = await this.db.prepare("SELECT * FROM archived_deals WHERE rowid >= ? AND rowid <= ? AND first_played_at <= ? ORDER BY rowid LIMIT 1")
      .bind(probe, newest.rowid, cutoff).first<DealRow>();
    if (!deal) return undefined;
    // The original (earliest) result plus at most the MAX_FIELD_RESULTS most recent others, so reads stay bounded.
    const columns = "SELECT rowid, vulnerability, contract, declarer, tricks, ns_score FROM deal_results WHERE deal_id = ?";
    const [first, recent] = await this.db.batch<ResultRow & { rowid: number }>([
      this.db.prepare(`${columns} ORDER BY played_at, rowid LIMIT 1`).bind(deal.id),
      this.db.prepare(`${columns} AND rowid != (SELECT rowid FROM deal_results WHERE deal_id = ? ORDER BY played_at, rowid LIMIT 1)
        ORDER BY played_at DESC, rowid DESC LIMIT ?`).bind(deal.id, deal.id, MAX_FIELD_RESULTS)
    ]);
    const original = first!.results[0];
    if (!original) return undefined;
    const target = vulnerability ?? deal.vulnerability;
    const held = [original, ...recent!.results.reverse()];
    const rows = held.map((row) => row.vulnerability === target ? travellerRow(row) : rescoreRow(travellerRow(row), target));
    const rescored = rows.some((row, index) => row.nsScore !== held[index]!.ns_score);
    return {
      dealId: deal.id,
      record: {
        deal: JSON.parse(deal.deal_json) as Deal,
        dealer: deal.dealer,
        vulnerability: target,
        scoring: "IMP",
        event: "Replay",
        original: JSON.parse(deal.original_actions_json) as GameAction[],
        field: grouped(rows),
        replay: { dealId: deal.id, firstPlayedAt: deal.first_played_at, original: rows[0]!, rescored }
      }
    };
  }
}
