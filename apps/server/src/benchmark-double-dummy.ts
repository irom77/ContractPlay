import { SEATS, scoreContract, partnership } from "@contractplay/core";
import type { Contract, Vulnerability } from "@contractplay/core";
import type { BenchmarkTableAssignment } from "@contractplay/benchmark";
import type { DuplicateSessionBoard } from "@contractplay/table";
import { isRecord } from "./deal-input.js";

const source = "bridge-dds-1.4.0";
const maxTableResults = 128;
// DDS uses S,H,D,C,NT for rows and N,E,S,W for columns.
const strains = ["spades", "hearts", "diamonds", "clubs", "notrump"] as const;
type Baseline = Readonly<{ source: typeof source; parNS: number; tricks: number[][] }>;

export function parseBaseline(input: unknown): Baseline | null {
  if (!isRecord(input) || input.source !== source || typeof input.parNS !== "number" ||
    !Number.isSafeInteger(input.parNS) || Math.abs(input.parNS) > 7600 || input.parNS % 10 !== 0 ||
    !Array.isArray(input.tricks) || input.tricks.length !== 5 ||
    !input.tricks.every((row) => Array.isArray(row) && row.length === 4 &&
      row.every((n: unknown) => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 13))) return null;
  return { source, parNS: input.parNS, tricks: input.tricks as number[][] };
}

export function diagnosticOutcome(baseline: Baseline, contract: Contract | null, tricks: number | null, vulnerability: Vulnerability) {
  if (!contract) return { auctionGap: Math.abs(baseline.parNS), declarerShortfall: null, defenseTricksPrevented: null };
  if (tricks === null) throw new Error("A completed contract requires a trick result");
  const optimum = baseline.tricks[strains.indexOf(contract.strain)]![SEATS.indexOf(contract.declarer)]!;
  const auctionScore = scoreContract(contract, optimum, vulnerability).score;
  const shortfall = optimum - tricks;
  return { auctionGap: Math.abs(auctionScore - baseline.parNS), declarerShortfall: shortfall, defenseTricksPrevented: shortfall };
}

export async function analysisBoard(db: D1Database, job: string, index: number) {
  const row = await db.prepare(`SELECT b.board_number AS number, b.dealer, b.vulnerability, b.deal_json AS deal,
    d.baseline_id AS analyzed FROM benchmark_boards b JOIN benchmark_jobs j ON j.id = b.job_id
    LEFT JOIN benchmark_dd_baselines d ON d.job_id=b.job_id AND d.board_index=b.board_index
    WHERE b.job_id=? AND b.board_index=? AND j.status='completed'`).bind(job, index)
    .first<{ number: number; dealer: DuplicateSessionBoard["dealer"]; vulnerability: Vulnerability; deal: string | null; analyzed: string | null }>();
  if (!row) return null;
  if (row.analyzed) return { analyzed: true };
  if (!row.deal) return null;
  return { analyzed: false, board: { number: row.number, dealer: row.dealer, vulnerability: row.vulnerability, deal: JSON.parse(row.deal) } };
}

type TableRow = { tableIndex: number; contract: string | null; tricks: number | null;
  assignments: string; finishedAt: number; vulnerability: Vulnerability };

export async function recordAnalysis(db: D1Database, job: string, index: number, baseline: Baseline) {
  const { results } = await db.prepare(`SELECT r.table_index AS tableIndex, r.contract_json AS contract, r.tricks,
    t.seats_json AS assignments, r.completed_at AS finishedAt, b.vulnerability
    FROM benchmark_results r JOIN benchmark_boards b ON r.job_id=b.job_id AND r.board_index=b.board_index
    JOIN benchmark_table_assignments t ON r.job_id=t.job_id AND r.table_index=t.table_index
    JOIN benchmark_jobs j ON r.job_id=j.id
    WHERE r.job_id=? AND r.board_index=? AND j.status='completed' AND r.released_at IS NOT NULL
    ORDER BY r.table_index LIMIT 8`).bind(job, index).all<TableRow>();
  if (!results.length) return "missing";
  const rows = results.flatMap((result) => {
    const contract = result.contract ? JSON.parse(result.contract) as Contract : null;
    const assignments = JSON.parse(result.assignments) as BenchmarkTableAssignment;
    const { auctionGap, declarerShortfall, defenseTricksPrevented } = diagnosticOutcome(baseline, contract, result.tricks, result.vulnerability);
    return SEATS.map((seat) => ({
      tableIndex: result.tableIndex, profileId: assignments[seat].profileId, version: assignments[seat].version,
      finishedAt: result.finishedAt, auctionGap, declarerShortfall: contract?.declarer === seat ? declarerShortfall : null,
      defenseExcess: contract && defenseTricksPrevented !== null && partnership(seat) !== partnership(contract.declarer) ? defenseTricksPrevented : null
    }));
  });
  const id = crypto.randomUUID();
  const board = await db.batch<{ source: string; parNS: number; tricks: string }>([
    db.prepare(`INSERT INTO benchmark_dd_baselines (job_id, board_index, baseline_id, source, par_ns, tricks_json)
      SELECT job_id, board_index, ?3, ?4, ?5, ?6 FROM benchmark_boards WHERE job_id=?1 AND board_index=?2 AND deal_json IS NOT NULL
      ON CONFLICT DO NOTHING`).bind(job, index, id, source, baseline.parNS, JSON.stringify(baseline.tricks)),
    db.prepare(`INSERT INTO benchmark_dd_metrics
      (baseline_id, table_index, profile_id, version, finished_at, auction_gap, declarer_shortfall, defense_excess)
      SELECT b.baseline_id, value->>'$.tableIndex', value->>'$.profileId', value->>'$.version',
        value->>'$.finishedAt', value->>'$.auctionGap', value->>'$.declarerShortfall', value->>'$.defenseExcess'
      FROM benchmark_dd_baselines b, json_each(?2) WHERE b.baseline_id=?1`).bind(id, JSON.stringify(rows)),
    db.prepare(`SELECT source, par_ns AS parNS, tricks_json AS tricks FROM benchmark_dd_baselines
      WHERE job_id=? AND board_index=?`).bind(job, index)
  ]);
  const saved = board[2]?.results[0];
  if (!saved) return "missing";
  if (saved.source !== source || saved.parNS !== baseline.parNS || saved.tricks !== JSON.stringify(baseline.tricks)) return "conflict";
  return board[0]!.meta.changes ? "created" : "existing";
}

export async function profileDiagnostics(db: D1Database, profile: string, version: string) {
  const row = await db.prepare(`WITH sample AS (SELECT auction_gap, declarer_shortfall, defense_excess FROM benchmark_dd_metrics
    WHERE profile_id=?1 AND version=?2 ORDER BY finished_at DESC, baseline_id, table_index LIMIT ?3)
    SELECT COUNT(*) AS count, AVG(auction_gap) AS meanGap, COUNT(declarer_shortfall) AS declarerCount,
      AVG(declarer_shortfall) AS meanShortfall, COUNT(defense_excess) AS defenseCount, AVG(defense_excess) AS meanExcess FROM sample`)
    .bind(profile, version, maxTableResults).first<{ count: number; meanGap: number | null; declarerCount: number;
      meanShortfall: number | null; defenseCount: number; meanExcess: number | null }>();
  return { source, maxTableResults, analyzedTableResults: row!.count,
    auction: { samples: row!.count, meanAbsoluteParGapPoints: row!.meanGap },
    declarer: { samples: row!.declarerCount, meanTricksBelowOptimum: row!.meanShortfall },
      defense: { samples: row!.defenseCount, meanTricksPreventedVsDoubleDummy: row!.meanExcess } };
}
