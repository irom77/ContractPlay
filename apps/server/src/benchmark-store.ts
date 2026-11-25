import { BENCHMARK_ROTATION_VERSION, GLICKO_2_VERSION, benchmarkProfileVersionId, isLeaderboardEligible } from "@contractplay/benchmark";
import type { BenchmarkProfileSnapshot, BenchmarkTableAssignment, RatedObservation, RatingPeriodResult, RatingSnapshot, RatingState } from "@contractplay/benchmark";
import { SEATS } from "@contractplay/core";
import type { Contract, GameAction } from "@contractplay/core";
import type { DuplicateSession, DuplicateSessionBoard } from "@contractplay/table";

export const BENCHMARK_SCHEMA_VERSION = 1;
export const MAX_BENCHMARK_BOARDS = 32;
export const MAX_BENCHMARK_PROFILES = 32;
export const MAX_BENCHMARK_TABLES = 8;
export const MAX_BENCHMARK_PAGE = 50;
const MAX_ACTIVE_JOBS = 8;
const PENDING_SCORE_TRANSFORM_VERSION = "pending-calibration";
const pageSize = (limit: number) => Number.isSafeInteger(limit) ? Math.min(MAX_BENCHMARK_PAGE, Math.max(1, limit)) : MAX_BENCHMARK_PAGE;

export type BenchmarkProfileKey = Pick<BenchmarkProfileSnapshot, "profileId" | "version">;
export type StoredBenchmarkProfile = Readonly<{
  profile: BenchmarkProfileSnapshot;
  status: "active" | "retired";
  createdAt: number;
  retiredAt: number | null;
}>;
type ProfileRow = Omit<StoredBenchmarkProfile, "profile" | "status"> & { snapshotJson: string };
const profileColumns = "snapshot_json AS snapshotJson, created_at AS createdAt, retired_at AS retiredAt";
function readProfile({ snapshotJson, retiredAt, createdAt }: ProfileRow): StoredBenchmarkProfile {
  return { profile: JSON.parse(snapshotJson) as BenchmarkProfileSnapshot, status: retiredAt === null ? "active" : "retired", retiredAt, createdAt };
}

export type BenchmarkImport = Readonly<{ id: string; boardCount: number; createdAt: number }>;
const importColumns = "id, board_count AS boardCount, created_at AS createdAt";

export type BenchmarkCohortInput = Readonly<{
  name: string;
  profiles: readonly BenchmarkProfileKey[];
  boardCount: number;
  maxTables: number;
  biddingStyle: BenchmarkProfileSnapshot["biddingStyle"];
  scoring: DuplicateSession["scoring"];
  rotationSeed: number;
  importId: string | null;
  intervalMinutes: number | null;
}>;
export type BenchmarkCohort = BenchmarkCohortInput & Readonly<{
  id: string; createdAt: number; updatedAt: number; retiredAt: number | null;
}>;
type CohortRow = Pick<BenchmarkCohort, "id" | "createdAt" | "updatedAt" | "retiredAt"> & { configJson: string };
const cohortColumns = "id, config_json AS configJson, created_at AS createdAt, updated_at AS updatedAt, retired_at AS retiredAt";
function readCohort({ configJson, ...row }: CohortRow): BenchmarkCohort {
  return { ...JSON.parse(configJson) as BenchmarkCohortInput, ...row };
}

export type BenchmarkJobStatus = "queued" | "running" | "paused" | "cancelled" | "completed" | "failed";
export type BenchmarkJobAction = "pause" | "resume" | "cancel";
export type BenchmarkClaim = Readonly<{ token: string; now: number }>;
export type BenchmarkJob = Readonly<{
  id: string;
  cohortId: string;
  cohort: BenchmarkCohortInput;
  profiles: readonly BenchmarkProfileSnapshot[];
  status: BenchmarkJobStatus;
  schemaVersion: number;
  roundIndex: number;
  rotationVersion: string;
  algorithmVersion: string;
  scoreTransformVersion: string;
  claimExpiresAt: number | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
}>;
type JobRow = Omit<BenchmarkJob, "cohort" | "profiles"> & { cohortJson: string; profilesJson: string };
const jobColumns = `id, cohort_id AS cohortId, cohort_json AS cohortJson, profiles_json AS profilesJson, status,
  schema_version AS schemaVersion, round_index AS roundIndex, rotation_version AS rotationVersion,
  algorithm_version AS algorithmVersion, score_transform_version AS scoreTransformVersion, claim_expires_at AS claimExpiresAt,
  created_at AS createdAt, updated_at AS updatedAt, completed_at AS completedAt`;
function readJob({ cohortJson, profilesJson, ...row }: JobRow): BenchmarkJob {
  return { ...row, cohort: JSON.parse(cohortJson) as BenchmarkCohortInput, profiles: JSON.parse(profilesJson) as BenchmarkProfileSnapshot[] };
}

export type BenchmarkBoardResultInput = Readonly<{
  jobId: string;
  tableIndex: number;
  boardIndex: number;
  actions: readonly GameAction[];
  contract: Contract | null;
  tricks: number | null;
  nsScore: number;
  completedAt: number;
}>;
export type BenchmarkResultSummary = Omit<BenchmarkBoardResultInput, "actions" | "contract"> & Readonly<{
  boardNumber: number;
  ewScore: number;
  releasedAt: number;
}>;
export type BenchmarkResult = BenchmarkBoardResultInput & BenchmarkResultSummary & Readonly<{
  board: DuplicateSessionBoard;
  assignment: BenchmarkTableAssignment;
}>;
type BoardRow = Omit<DuplicateSessionBoard, "deal"> & { dealJson: string };
type ResultRow = BenchmarkResultSummary & Omit<BoardRow, "number"> & { actionsJson: string; contractJson: string | null; seatsJson: string };
const resultColumns = `r.job_id AS jobId, r.table_index AS tableIndex, r.board_index AS boardIndex,
  b.board_number AS boardNumber, r.tricks, r.ns_score AS nsScore, -r.ns_score AS ewScore, r.completed_at AS completedAt, r.released_at AS releasedAt`;

type RatingPeriodRow = {
  id: string; ratedAt: number; algorithmVersion: RatingPeriodResult["algorithmVersion"]; scoreTransformVersion: string; observationsJson: string;
};
type RatingRow = RatingState & { competitorId: string };
type RatingArchiveRow = RatingRow & Omit<RatingPeriodRow, "observationsJson" | "id"> & { jobId: string };
export type BenchmarkRating = RatingArchiveRow & RatingSnapshot;
const ratingColumns = `s.competitor_id AS competitorId, s.rating, s.deviation, s.volatility, s.sample_boards AS sampleBoards`;
const ratingArchiveColumns = `${ratingColumns}, p.job_id AS jobId, p.rated_at AS ratedAt,
  p.algorithm_version AS algorithmVersion, p.score_transform_version AS scoreTransformVersion`;

const selectedProfiles = (config: string) => `FROM json_each(${config}, '$.profiles') AS member
  JOIN benchmark_profile_versions p ON p.profile_id = json_extract(member.value, '$.profileId')
    AND p.version = json_extract(member.value, '$.version')
  WHERE p.retired_at IS NULL AND json_extract(p.snapshot_json, '$.biddingStyle') = json_extract(${config}, '$.biddingStyle')`;
function validCohort(config: string): string {
  return `json_array_length(${config}, '$.profiles') BETWEEN 4 AND ${MAX_BENCHMARK_PROFILES}
    AND (SELECT COUNT(DISTINCT json_array(p.profile_id, p.version)) ${selectedProfiles(config)}) = json_array_length(${config}, '$.profiles')
    AND (json_extract(${config}, '$.importId') IS NULL OR EXISTS (
      SELECT 1 FROM benchmark_imports WHERE id = json_extract(${config}, '$.importId')
        AND board_count = json_extract(${config}, '$.boardCount')))`;
}
function serializeCohort(input: BenchmarkCohortInput): string {
  return JSON.stringify({ ...input, profiles: input.profiles.map(({ profileId, version }) => ({ profileId, version })) });
}
const transitions: Record<BenchmarkJobAction, { from: string; to: BenchmarkJobStatus }> = {
  pause: { from: "'queued', 'running'", to: "paused" },
  resume: { from: "'paused'", to: "queued" },
  cancel: { from: "'queued', 'running', 'paused'", to: "cancelled" }
};
const activeStatuses = "'queued', 'running', 'paused'";
const ownsClaim = "j.status = 'running' AND j.claim_token = ?3 AND j.claim_expires_at > ?4";

/** The queue, immutable configuration snapshots, and benchmark-only archive. */
export class BenchmarkStore {
  constructor(private readonly db: D1Database) {}

  async addProfileVersion(profile: BenchmarkProfileSnapshot, now: number): Promise<"created" | "existing" | "conflict"> {
    const { profileId, version, skill, aggression, biddingStyle, engineVersion } = profile;
    const snapshotJson = JSON.stringify({ profileId, version, skill, aggression, biddingStyle, engineVersion });
    const [, inserted, stored] = await this.db.batch<ProfileRow>([
      this.db.prepare("INSERT INTO benchmark_profiles (id) VALUES (?) ON CONFLICT DO NOTHING").bind(profileId),
      this.db.prepare(`INSERT INTO benchmark_profile_versions (profile_id, version, snapshot_json, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`).bind(profileId, version, snapshotJson, now),
      this.db.prepare(`SELECT ${profileColumns} FROM benchmark_profile_versions WHERE profile_id = ? AND version = ?`).bind(profileId, version)
    ]);
    if (inserted?.meta.changes) return "created";
    return stored?.results[0]?.snapshotJson === snapshotJson ? "existing" : "conflict";
  }

  async retireProfileVersion({ profileId, version }: BenchmarkProfileKey, now: number): Promise<boolean> {
    const { meta } = await this.db.prepare(`UPDATE benchmark_profile_versions SET retired_at = COALESCE(retired_at, ?)
      WHERE profile_id = ? AND version = ?`).bind(now, profileId, version).run();
    return meta.changes === 1;
  }

  async getProfile({ profileId, version }: BenchmarkProfileKey): Promise<StoredBenchmarkProfile | null> {
    const row = await this.db.prepare(`SELECT ${profileColumns} FROM benchmark_profile_versions WHERE profile_id = ? AND version = ?`)
      .bind(profileId, version).first<ProfileRow>();
    return row && readProfile(row);
  }

  async listProfiles(limit = 25): Promise<StoredBenchmarkProfile[]> {
    const { results } = await this.db.prepare(`SELECT ${profileColumns} FROM benchmark_profile_versions
      ORDER BY created_at DESC, profile_id, version LIMIT ?`).bind(pageSize(limit)).all<ProfileRow>();
    return results.map(readProfile);
  }

  /** The ID is a hash of the already validated board facts. A retry leaves the existing import intact. */
  async putImport(id: string, boards: readonly DuplicateSessionBoard[], now: number): Promise<{ import: BenchmarkImport; created: boolean }> {
    const [inserted, stored] = await this.db.batch<BenchmarkImport>([
      this.db.prepare(`INSERT INTO benchmark_imports (id, board_count, boards_json, created_at)
        VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`).bind(id, boards.length, JSON.stringify(boards), now),
      this.db.prepare(`SELECT ${importColumns} FROM benchmark_imports WHERE id = ?`).bind(id)
    ]);
    return { import: stored!.results[0]!, created: inserted?.meta.changes === 1 };
  }

  async listImports(limit = 25): Promise<BenchmarkImport[]> {
    const { results } = await this.db.prepare(`SELECT ${importColumns} FROM benchmark_imports ORDER BY created_at DESC, id LIMIT ?`)
      .bind(pageSize(limit)).all<BenchmarkImport>();
    return results;
  }

  async getImportBoards(id: string): Promise<DuplicateSessionBoard[] | null> {
    const value = await this.db.prepare("SELECT boards_json FROM benchmark_imports WHERE id = ?").bind(id).first<string>("boards_json");
    return value === null ? null : JSON.parse(value) as DuplicateSessionBoard[];
  }

  async createCohort(id: string, input: BenchmarkCohortInput, now: number): Promise<boolean> {
    const { meta } = await this.db.prepare(`INSERT INTO benchmark_cohorts (id, config_json, created_at, updated_at)
      SELECT ?2, ?1, ?3, ?3 WHERE ${validCohort("?1")} ON CONFLICT DO NOTHING`).bind(serializeCohort(input), id, now).run();
    return meta.changes === 1;
  }

  async updateCohort(id: string, input: BenchmarkCohortInput, now: number): Promise<boolean> {
    const { meta } = await this.db.prepare(`UPDATE benchmark_cohorts SET config_json = ?1, updated_at = ?3
      WHERE id = ?2 AND retired_at IS NULL AND ${validCohort("?1")}`).bind(serializeCohort(input), id, now).run();
    return meta.changes === 1;
  }

  async retireCohort(id: string, now: number): Promise<boolean> {
    const { meta } = await this.db.prepare(`UPDATE benchmark_cohorts SET retired_at = COALESCE(retired_at, ?1),
      updated_at = CASE WHEN retired_at IS NULL THEN ?1 ELSE updated_at END WHERE id = ?2`).bind(now, id).run();
    return meta.changes === 1;
  }

  async getCohort(id: string): Promise<BenchmarkCohort | null> {
    const row = await this.db.prepare(`SELECT ${cohortColumns} FROM benchmark_cohorts WHERE id = ?`).bind(id).first<CohortRow>();
    return row && readCohort(row);
  }

  async listCohorts(limit = 25): Promise<BenchmarkCohort[]> {
    const { results } = await this.db.prepare(`SELECT ${cohortColumns} FROM benchmark_cohorts ORDER BY updated_at DESC, id LIMIT ?`)
      .bind(pageSize(limit)).all<CohortRow>();
    return results.map(readCohort);
  }

  /** Re-check current eligibility in the same transaction that snapshots the roster and queues the job. */
  async startJob({ id, cohortId, roundIndex, now, scoreTransformVersion = PENDING_SCORE_TRANSFORM_VERSION }: {
    id: string; cohortId: string; roundIndex: number; now: number; scoreTransformVersion?: string;
  }): Promise<BenchmarkJob | null> {
    const [, stored] = await this.db.batch<JobRow>([
      this.db.prepare(`INSERT INTO benchmark_jobs (id, cohort_id, cohort_json, profiles_json, import_id,
          schema_version, round_index, rotation_version, algorithm_version, score_transform_version, status, created_at, updated_at)
        SELECT ?1, c.id, c.config_json, (SELECT json_group_array(json(snapshot_json)) FROM (
          SELECT p.snapshot_json ${selectedProfiles("c.config_json")} ORDER BY CAST(member.key AS INTEGER)
        )), json_extract(c.config_json, '$.importId'), ?5, ?3, ?6, ?7, ?8, 'queued', ?4, ?4
        FROM benchmark_cohorts c WHERE c.id = ?2 AND c.retired_at IS NULL AND ${validCohort("c.config_json")}
          AND (SELECT COUNT(*) FROM benchmark_jobs WHERE status IN (${activeStatuses})) < ?9
        ON CONFLICT DO NOTHING`).bind(id, cohortId, roundIndex, now, BENCHMARK_SCHEMA_VERSION, BENCHMARK_ROTATION_VERSION,
        GLICKO_2_VERSION, scoreTransformVersion, MAX_ACTIVE_JOBS),
      this.db.prepare(`SELECT ${jobColumns} FROM benchmark_jobs WHERE id = ? AND cohort_id = ? AND round_index = ?`).bind(id, cohortId, roundIndex)
    ]);
    const row = stored?.results[0];
    return row ? readJob(row) : null;
  }

  async getJob(id: string): Promise<BenchmarkJob | null> {
    const row = await this.db.prepare(`SELECT ${jobColumns} FROM benchmark_jobs WHERE id = ?`).bind(id).first<JobRow>();
    return row && readJob(row);
  }

  async listJobs(limit = 25): Promise<BenchmarkJob[]> {
    const { results } = await this.db.prepare(`SELECT ${jobColumns} FROM benchmark_jobs ORDER BY created_at DESC, id LIMIT ?`)
      .bind(pageSize(limit)).all<JobRow>();
    return results.map(readJob);
  }

  async changeJobStatus(id: string, action: BenchmarkJobAction, now: number): Promise<BenchmarkJob | null> {
    const { from, to } = transitions[action];
    const [, stored] = await this.db.batch<JobRow>([
      this.db.prepare(`UPDATE benchmark_jobs SET status = ?1, claim_token = NULL, claim_expires_at = NULL,
        completed_at = CASE WHEN ?1 = 'cancelled' THEN ?2 ELSE NULL END, updated_at = ?2
        WHERE id = ?3 AND status IN (${from})`).bind(to, now, id),
      this.db.prepare(`SELECT ${jobColumns} FROM benchmark_jobs WHERE id = ? AND status = ?`).bind(id, to)
    ]);
    const row = stored?.results[0];
    return row ? readJob(row) : null;
  }

  async claimNextJob(token: string, now: number, leaseMs: number): Promise<BenchmarkJob | null> {
    const row = await this.db.prepare(`UPDATE benchmark_jobs SET status = 'running', claim_token = ?1, claim_expires_at = ?2, updated_at = ?3
      WHERE id = (SELECT id FROM benchmark_jobs WHERE status = 'queued' OR (status = 'running' AND claim_expires_at <= ?3)
        ORDER BY created_at, id LIMIT 1) RETURNING ${jobColumns}`).bind(token, now + leaseMs, now).first<JobRow>();
    return row && readJob(row);
  }

  async releaseJobClaim(id: string, token: string, now: number): Promise<boolean> {
    const { meta } = await this.db.prepare(`UPDATE benchmark_jobs SET status = 'queued', claim_token = NULL, claim_expires_at = NULL,
      updated_at = ?3 WHERE id = ?1 AND claim_token = ?2 AND claim_expires_at > ?3`).bind(id, token, now).run();
    return meta.changes === 1;
  }

  async finishJob(id: string, token: string, status: "completed" | "failed", now: number): Promise<boolean> {
    const { meta } = await this.db.prepare(`UPDATE benchmark_jobs SET status = ?3, claim_token = NULL, claim_expires_at = NULL,
      completed_at = ?4, updated_at = ?4 WHERE id = ?1 AND claim_token = ?2 AND claim_expires_at > ?4 AND (?3 = 'failed' OR (
        (SELECT COUNT(*) FROM benchmark_boards WHERE job_id = ?1) = json_extract(cohort_json, '$.boardCount')
        AND (SELECT COUNT(*) FROM benchmark_table_assignments WHERE job_id = ?1) >= 2
        AND NOT EXISTS (SELECT 1 FROM benchmark_boards b WHERE b.job_id = ?1 AND NOT EXISTS (
          SELECT 1 FROM benchmark_results r WHERE r.job_id = b.job_id AND r.board_index = b.board_index AND r.released_at IS NOT NULL
        ))
      ))`).bind(id, token, status, now).run();
    return meta.changes === 1;
  }

  /** A job's full rotation is committed before any of its results can be recorded. */
  async putTableAssignments(id: string, assignments: readonly BenchmarkTableAssignment[], claim: BenchmarkClaim): Promise<void> {
    const job = await this.getJob(id);
    if (!job || assignments.length < 2 || assignments.length > job.cohort.maxTables) return;
    const roster = new Map(job.profiles.map((profile) => [benchmarkProfileVersionId(profile), profile]));
    const snapshots: BenchmarkTableAssignment[] = [];
    for (const assignment of assignments) {
      const keys = SEATS.map((seat) => benchmarkProfileVersionId(assignment[seat]));
      if (new Set(keys).size !== SEATS.length) return;
      const [north, east, south, west] = keys.map((key) => roster.get(key));
      if (!north || !east || !south || !west) return;
      snapshots.push({ north, east, south, west });
    }
    await this.db.prepare(`INSERT INTO benchmark_table_assignments (job_id, table_index, seats_json)
      SELECT j.id, entry.key, entry.value FROM benchmark_jobs j, json_each(?2) entry
      WHERE j.id = ?1 AND ${ownsClaim}
        AND NOT EXISTS (SELECT 1 FROM benchmark_table_assignments WHERE job_id = ?1)`)
      .bind(id, JSON.stringify(snapshots), claim.token, claim.now).run();
  }

  async listTableAssignments(id: string): Promise<BenchmarkTableAssignment[]> {
    const { results } = await this.db.prepare(`SELECT seats_json AS seatsJson FROM benchmark_table_assignments
      WHERE job_id = ? ORDER BY table_index LIMIT ?`).bind(id, MAX_BENCHMARK_TABLES).all<{ seatsJson: string }>();
    return results.map(({ seatsJson }) => JSON.parse(seatsJson) as BenchmarkTableAssignment);
  }

  /** A job's first valid generated or imported board set becomes its permanent source. */
  async putJobBoards(id: string, generatedBoards: readonly DuplicateSessionBoard[], claim: BenchmarkClaim): Promise<void> {
    await this.db.prepare(`WITH source AS (
        SELECT j.id, COALESCE(i.boards_json, ?2) AS boards_json, json_extract(j.cohort_json, '$.boardCount') AS board_count
        FROM benchmark_jobs j LEFT JOIN benchmark_imports i ON j.import_id = i.id
        WHERE j.id = ?1 AND ${ownsClaim}
      ) INSERT INTO benchmark_boards (job_id, board_index, board_number, dealer, vulnerability, deal_json)
      SELECT source.id, entry.key, json_extract(entry.value, '$.number'), json_extract(entry.value, '$.dealer'),
        json_extract(entry.value, '$.vulnerability'), json_extract(entry.value, '$.deal')
      FROM source, json_each(source.boards_json) entry WHERE json_array_length(source.boards_json) = source.board_count
        AND NOT EXISTS (SELECT 1 FROM benchmark_boards WHERE job_id = ?1)`)
      .bind(id, JSON.stringify(generatedBoards), claim.token, claim.now).run();
  }

  async listJobBoards(id: string): Promise<DuplicateSessionBoard[]> {
    const { results } = await this.db.prepare(`SELECT board_number AS number, dealer, vulnerability, deal_json AS dealJson
      FROM benchmark_boards WHERE job_id = ? ORDER BY board_index LIMIT ?`).bind(id, MAX_BENCHMARK_BOARDS).all<BoardRow>();
    return results.map(({ dealJson, ...board }) => ({ ...board, deal: JSON.parse(dealJson) as DuplicateSessionBoard["deal"] }));
  }

  /** Admit a board once for play under the current lease, before the coordinator sends it to the tables. */
  async startBoard(id: string, boardIndex: number, claim: BenchmarkClaim): Promise<boolean> {
    const { meta } = await this.db.prepare(`UPDATE benchmark_boards SET started_at = COALESCE(started_at, ?4)
      WHERE job_id = ?1 AND board_index = ?2
        AND EXISTS (SELECT 1 FROM benchmark_jobs j WHERE j.id = ?1 AND ${ownsClaim})
        AND (SELECT COUNT(*) FROM benchmark_table_assignments WHERE job_id = ?1) >= 2
        AND (?2 = 0 OR EXISTS (SELECT 1 FROM benchmark_results r
          WHERE r.job_id = ?1 AND r.board_index = ?2 - 1 AND r.released_at IS NOT NULL))`)
      .bind(id, boardIndex, claim.token, claim.now).run();
    return meta.changes === 1;
  }

  /** Results stay private until every table assigned to the job has returned a result on the same board. */
  async recordResult(result: BenchmarkBoardResultInput): Promise<boolean> {
    const { jobId, tableIndex, boardIndex, actions, contract, tricks, nsScore, completedAt } = result;
    const [inserted] = await this.db.batch([
      this.db.prepare(`INSERT INTO benchmark_results (job_id, table_index, board_index, actions_json, contract_json, tricks, ns_score, completed_at)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8 FROM benchmark_jobs j
        JOIN benchmark_boards b ON b.job_id = j.id AND b.board_index = ?3
        WHERE j.id = ?1 AND j.status IN (${activeStatuses}) AND b.started_at IS NOT NULL
        ON CONFLICT DO NOTHING`).bind(jobId, tableIndex, boardIndex, JSON.stringify(actions), contract && JSON.stringify(contract), tricks, nsScore, completedAt),
      this.db.prepare(`UPDATE benchmark_results SET released_at = (
          SELECT MAX(completed_at) FROM benchmark_results WHERE job_id = ?1 AND board_index = ?2
        ) WHERE job_id = ?1 AND board_index = ?2 AND released_at IS NULL
        AND (SELECT COUNT(*) FROM benchmark_results WHERE job_id = ?1 AND board_index = ?2)
          = (SELECT COUNT(*) FROM benchmark_table_assignments WHERE job_id = ?1)`).bind(jobId, boardIndex)
    ]);
    return inserted?.meta.changes === 1;
  }

  async listPublicResults(limit = 25): Promise<BenchmarkResultSummary[]> {
    const { results } = await this.db.prepare(`SELECT ${resultColumns} FROM benchmark_results r
      JOIN benchmark_boards b ON b.job_id = r.job_id AND b.board_index = r.board_index
      WHERE r.released_at IS NOT NULL ORDER BY r.released_at DESC, r.job_id, r.board_index, r.table_index LIMIT ?`)
      .bind(pageSize(limit)).all<BenchmarkResultSummary>();
    return results;
  }

  getPublicResult(jobId: string, tableIndex: number, boardIndex: number): Promise<BenchmarkResult | null> {
    return this.readReleasedResult(jobId, tableIndex, boardIndex, true);
  }

  /** Internal archive read. Imported deals and play stay available here after the duplicate field finishes. */
  getReleasedResult(jobId: string, tableIndex: number, boardIndex: number): Promise<BenchmarkResult | null> {
    return this.readReleasedResult(jobId, tableIndex, boardIndex, false);
  }

  private async readReleasedResult(jobId: string, tableIndex: number, boardIndex: number, generatedOnly: boolean): Promise<BenchmarkResult | null> {
    const row = await this.db.prepare(`SELECT ${resultColumns}, b.dealer, b.vulnerability, b.deal_json AS dealJson,
      r.actions_json AS actionsJson, r.contract_json AS contractJson, t.seats_json AS seatsJson
      FROM benchmark_results r JOIN benchmark_boards b ON b.job_id = r.job_id AND b.board_index = r.board_index
      JOIN benchmark_table_assignments t ON t.job_id = r.job_id AND t.table_index = r.table_index
      JOIN benchmark_jobs j ON j.id = r.job_id
      WHERE r.job_id = ?1 AND r.table_index = ?2 AND r.board_index = ?3 AND r.released_at IS NOT NULL
        AND (?4 = 0 OR j.import_id IS NULL)`)
      .bind(jobId, tableIndex, boardIndex, generatedOnly ? 1 : 0).first<ResultRow>();
    if (!row) return null;
    const { actionsJson, contractJson, seatsJson, dealJson, dealer, vulnerability, ...summary } = row;
    return { ...summary, actions: JSON.parse(actionsJson) as GameAction[], contract: contractJson ? JSON.parse(contractJson) as Contract : null,
      board: { number: summary.boardNumber, dealer, vulnerability, deal: JSON.parse(dealJson) as DuplicateSessionBoard["deal"] },
      assignment: JSON.parse(seatsJson) as BenchmarkTableAssignment };
  }

  /** The period and every rating become visible together. Only the transaction that creates the period can add rows to it. */
  async commitRatingPeriod(jobId: string, result: RatingPeriodResult, now: number): Promise<{ result: RatingPeriodResult; ratedAt: number } | null> {
    const id = crypto.randomUUID();
    const { algorithmVersion, scoreTransformVersion, observations, ratings } = result;
    const [, , periods, snapshots] = await this.db.batch<RatingPeriodRow | RatingRow>([
      this.db.prepare(`INSERT INTO benchmark_rating_periods (id, job_id, algorithm_version, score_transform_version, rated_at, observations_json)
        SELECT ?1, j.id, ?3, ?4, ?5, ?6 FROM benchmark_jobs j WHERE j.id = ?2 AND j.status = 'completed' ON CONFLICT DO NOTHING`)
        .bind(id, jobId, algorithmVersion, scoreTransformVersion, now, JSON.stringify(observations)),
      this.db.prepare(`INSERT INTO benchmark_rating_snapshots (period_id, competitor_id, position, rating, deviation, volatility, sample_boards)
        SELECT p.id, json_extract(entry.value, '$.competitorId'), entry.key, json_extract(entry.value, '$.rating'),
          json_extract(entry.value, '$.deviation'), json_extract(entry.value, '$.volatility'), json_extract(entry.value, '$.sampleBoards')
        FROM benchmark_rating_periods p, json_each(?2) entry WHERE p.id = ?1`).bind(id, JSON.stringify(ratings)),
      this.db.prepare(`SELECT id, rated_at AS ratedAt, algorithm_version AS algorithmVersion, score_transform_version AS scoreTransformVersion,
        observations_json AS observationsJson FROM benchmark_rating_periods WHERE job_id = ? AND algorithm_version = ?`).bind(jobId, algorithmVersion),
      this.db.prepare(`SELECT ${ratingColumns} FROM benchmark_rating_snapshots s JOIN benchmark_rating_periods p ON p.id = s.period_id
        WHERE p.job_id = ? AND p.algorithm_version = ? ORDER BY s.position`).bind(jobId, algorithmVersion)
    ]);
    const period = periods?.results[0] as RatingPeriodRow | undefined;
    if (!period) return null;
    return { ratedAt: period.ratedAt, result: { algorithmVersion: period.algorithmVersion, scoreTransformVersion: period.scoreTransformVersion,
      observations: JSON.parse(period.observationsJson) as RatedObservation[],
      ratings: (snapshots!.results as RatingRow[]).map((rating) => ({ ...rating, eligible: isLeaderboardEligible(rating) })) } };
  }

  async listRatingHistory(competitorId: string, limit = 25): Promise<BenchmarkRating[]> {
    const { results } = await this.db.prepare(`SELECT ${ratingArchiveColumns} FROM benchmark_rating_snapshots s
      JOIN benchmark_rating_periods p ON p.id = s.period_id WHERE s.competitor_id = ?
      ORDER BY p.rated_at DESC, p.id DESC LIMIT ?`).bind(competitorId, pageSize(limit)).all<RatingArchiveRow>();
    return results.map((rating) => ({ ...rating, eligible: isLeaderboardEligible(rating) }));
  }

  /** Use the latest algorithm/transform series so ratings with different meanings never compete on one list. */
  async listLeaderboard(limit = 25): Promise<BenchmarkRating[]> {
    const { results } = await this.db.prepare(`WITH series AS (
      SELECT algorithm_version, score_transform_version FROM benchmark_rating_periods ORDER BY rated_at DESC, id DESC LIMIT 1
    ), ranked AS (
      SELECT ${ratingArchiveColumns}, ROW_NUMBER() OVER(PARTITION BY s.competitor_id ORDER BY p.rated_at DESC, p.id DESC) AS sequence
      FROM benchmark_rating_snapshots s JOIN benchmark_rating_periods p ON p.id = s.period_id
      JOIN series ON series.algorithm_version = p.algorithm_version AND series.score_transform_version = p.score_transform_version
    )
    SELECT competitorId, rating, deviation, volatility, sampleBoards, jobId, ratedAt, algorithmVersion, scoreTransformVersion
    FROM ranked WHERE sequence = 1 ORDER BY (sampleBoards >= 20 AND deviation < 100) DESC, rating DESC, competitorId LIMIT ?`)
      .bind(pageSize(limit)).all<RatingArchiveRow>();
    return results.map((rating) => ({ ...rating, eligible: isLeaderboardEligible(rating) }));
  }
}
