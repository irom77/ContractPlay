import { analysisBoard, parseBaseline, profileDiagnostics, recordAnalysis } from "./benchmark-double-dummy.js";
import { benchmarkOf } from "./benchmark-object.js";
import { benchmarkProfileVersionId, createBenchmarkProfile } from "@contractplay/benchmark";
import { BOT_CHARACTERS, cardId, cleanName, SEATS } from "@contractplay/core";
import { parsePbn } from "@contractplay/pbn";
import type { DuplicateSessionBoard } from "@contractplay/table";
import { benchmarkAdminAccess, hash } from "./auth.js";
import { BenchmarkStore, MAX_BENCHMARK_BOARDS, MAX_BENCHMARK_PAGE, MAX_BENCHMARK_PROFILES, MAX_BENCHMARK_TABLES } from "./benchmark-store.js";
import type { BenchmarkCohortInput, BenchmarkJobAction, BenchmarkProfileKey } from "./benchmark-store.js";
import { isRecord, readLimited } from "./deal-input.js";

const MAX_CONFIG_BYTES = 16_384;
const MAX_PBN_BYTES = 128_000;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const IMPORT_ID = /^[a-f0-9]{64}$/;
export const ADMIN_BENCHMARK_PATH = "/api/admin/benchmarks";
export const PUBLIC_BENCHMARK_PATH = "/api/benchmarks";

const headers = { "Cache-Control": "no-store" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
const empty = (status: number) => new Response(null, { status, headers });
const badRequest = () => json({ error: "bad-request" }, 400);
const notFound = () => json({ error: "not-found" }, 404);
const conflict = () => json({ error: "conflict" }, 409);
const methodNotAllowed = (allow: string) => new Response(null, { status: 405, headers: { ...headers, Allow: allow } });

const isId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
const isStyle = (value: unknown): value is BenchmarkCohortInput["biddingStyle"] => value === "SAYC" || value === "2/1";
const intBetween = (value: unknown, low: number, high: number): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= low && value <= high;
const pathIndex = (value: string, high: number) => /^\d+$/.test(value) && intBetween(Number(value), 0, high);
const jobAction = (value: string | undefined): value is BenchmarkJobAction => value === "pause" || value === "resume" || value === "cancel";

async function configBody(request: Request): Promise<Record<string, unknown> | undefined> {
  const text = await readLimited(request, MAX_CONFIG_BYTES);
  try {
    const value: unknown = text ? JSON.parse(text) : null;
    return isRecord(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function profileKey(profileId: unknown, version: unknown): BenchmarkProfileKey | undefined {
  return isId(profileId) && isId(version) ? { profileId, version } : undefined;
}

function cohortInput(data: Record<string, unknown> | undefined): BenchmarkCohortInput | undefined {
  if (!data) return undefined;
  const name = cleanName(data.name, 80);
  const { profiles, boardCount, maxTables, biddingStyle, scoring, rotationSeed, importId = null, intervalMinutes = null } = data;
  if (!name || !Array.isArray(profiles) || profiles.length < 4 || profiles.length > MAX_BENCHMARK_PROFILES
    || !intBetween(boardCount, 1, MAX_BENCHMARK_BOARDS) || !intBetween(maxTables, 2, MAX_BENCHMARK_TABLES)
    || !isStyle(biddingStyle) || (scoring !== "imps" && scoring !== "matchpoints")
    || !intBetween(rotationSeed, 0, 0xFFFFFFFF)
    || (importId !== null && (typeof importId !== "string" || !IMPORT_ID.test(importId)))
    || (intervalMinutes !== null && (!intBetween(intervalMinutes, 5, Math.floor(Number.MAX_SAFE_INTEGER / 60_000)) || intervalMinutes % 5 !== 0))) return undefined;
  const keys: BenchmarkProfileKey[] = [];
  for (const item of profiles) {
    const key = isRecord(item) ? profileKey(item.profileId, item.version) : undefined;
    if (!key) return undefined;
    keys.push(key);
  }
  if (new Set(keys.map(benchmarkProfileVersionId)).size !== keys.length) return undefined;
  return { name, profiles: keys, boardCount, maxTables, biddingStyle, scoring, rotationSeed, importId, intervalMinutes };
}

function parseBenchmarkBoards(input: string): DuplicateSessionBoard[] | undefined {
  const { boards } = parsePbn(input);
  if (boards.length < 1 || boards.length > MAX_BENCHMARK_BOARDS) return undefined;
  const parsed: DuplicateSessionBoard[] = [];
  const numbers = new Set<number>();
  for (const board of boards) {
    const { tags, deal, dealer, vulnerability, diagnostics } = board;
    const facts = (tag: string) => tags.filter(({ name }) => name.toLowerCase() === tag);
    const numberTag = facts("board");
    const value = numberTag[0]?.value.trim() ?? "";
    const number = Number(value);
    if (numberTag.length !== 1 || !/^\d+$/.test(value) || !intBetween(number, 1, Number.MAX_SAFE_INTEGER) || numbers.has(number)
      || facts("dealer").length !== 1 || facts("vulnerable").length !== 1 || facts("deal").length !== 1
      || !deal || !dealer || !SEATS.includes(dealer) || (vulnerability !== "None" && vulnerability !== "NS" && vulnerability !== "EW" && vulnerability !== "Both")
      || diagnostics.some(({ severity }) => severity === "error")) return undefined;
    numbers.add(number);
    parsed.push({ number, deal, dealer, vulnerability });
  }
  return parsed;
}

async function importsRoute(request: Request, store: BenchmarkStore, limit: number | undefined): Promise<Response> {
  if (request.method === "GET") return json({ imports: await store.listImports(limit) });
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  const text = await readLimited(request, MAX_PBN_BYTES);
  if (text === undefined) return json({ error: "upload-too-large" }, 413);
  let boards: DuplicateSessionBoard[] | undefined;
  try { boards = parseBenchmarkBoards(text); } catch { return badRequest(); }
  if (!boards) return badRequest();

  // Rank spelling and tags can differ without changing the board facts or their source ID.
  const fingerprint = boards.map(({ number, deal, dealer, vulnerability }) => ({
    number, dealer, vulnerability, cards: SEATS.map((seat) => deal[seat].map(cardId).sort())
  }));
  const stored = await store.putImport(await hash(JSON.stringify(fingerprint)), boards, Date.now());
  return json(stored.import, stored.created ? 201 : 200);
}

async function profilesAdminRoute(request: Request, store: BenchmarkStore, tail: string[], limit: number | undefined): Promise<Response> {
  if (tail.length === 0) {
    if (request.method === "GET") return json({ profiles: await store.listProfiles(limit) });
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    const data = await configBody(request);
    if (!data) return badRequest();
    const { skill, aggression, biddingStyle, version, engineVersion } = data;
    const bot = BOT_CHARACTERS.find((bot) => bot.skill === skill && bot.aggression === aggression);
    if (!bot || !isStyle(biddingStyle) || !isId(version) || !isId(engineVersion)) return badRequest();
    const profile = createBenchmarkProfile({ skill: bot.skill, aggression: bot.aggression, biddingStyle, version, engineVersion });
    const result = await store.addProfileVersion(profile, Date.now());
    if (result === "conflict") return conflict();
    return json(await store.getProfile(profile), result === "created" ? 201 : 200);
  }
  const key = tail.length === 2 ? profileKey(tail[0], tail[1]) : undefined;
  if (!key) return notFound();
  if (request.method === "DELETE") return await store.retireProfileVersion(key, Date.now()) ? empty(204) : notFound();
  if (request.method !== "GET") return methodNotAllowed("GET, DELETE");
  const profile = await store.getProfile(key);
  return profile ? json(profile) : notFound();
}

async function cohortsRoute(request: Request, store: BenchmarkStore, tail: string[], limit: number | undefined): Promise<Response> {
  const [id] = tail;
  if (tail.length === 0) {
    if (request.method === "GET") return json({ cohorts: await store.listCohorts(limit) });
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    const input = cohortInput(await configBody(request));
    if (!input) return badRequest();
    const newId = crypto.randomUUID();
    if (!await store.createCohort(newId, input, Date.now())) return conflict();
    return json(await store.getCohort(newId), 201);
  }
  if (tail.length !== 1 || !isId(id)) return notFound();
  if (request.method === "DELETE") return await store.retireCohort(id, Date.now()) ? empty(204) : notFound();
  if (request.method !== "GET" && request.method !== "PUT") return methodNotAllowed("GET, PUT, DELETE");
  const cohort = await store.getCohort(id);
  if (!cohort) return notFound();
  if (request.method === "GET") return json(cohort);
  const input = cohortInput(await configBody(request));
  if (!input) return badRequest();
  if (!await store.updateCohort(id, input, Date.now())) return conflict();
  return json(await store.getCohort(id));
}

async function jobsRoute(request: Request, env: Env, store: BenchmarkStore, tail: string[], limit: number | undefined): Promise<Response> {
  if (tail.length === 0) {
    if (request.method === "GET") return json({ jobs: await store.listJobs(limit) });
    if (request.method !== "POST") return methodNotAllowed("GET, POST");
    const data = await configBody(request);
    const { id = crypto.randomUUID(), cohortId } = data ?? {};
    if (!isId(id) || !isId(cohortId) || data?.roundIndex !== undefined) return badRequest();
    const job = await benchmarkOf(env).enqueue({ id, cohortId });
    return job ? json(job, 201) : conflict();
  }
  const [id, action] = tail;
  if (!isId(id) || tail.length > 2 || (tail.length === 2 && !jobAction(action))) return notFound();
  const expected = action ? "POST" : "GET";
  if (request.method !== expected) return methodNotAllowed(expected);
  const job = await store.getJob(id);
  if (!job) return notFound();
  if (!jobAction(action)) return json(job);
  const changed = await benchmarkOf(env)[action](id);
  return changed ? json(changed) : conflict();
}

async function publicRoute(request: Request, db: D1Database, store: BenchmarkStore, path: string[], limit: number | undefined): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const [resource, ...tail] = path;
  if (tail.length === 0) {
    if (resource === "profiles") return json({ profiles: await store.listProfiles(limit) });
    if (resource === "leaderboard") return json({ ratings: await store.listLeaderboard(limit) });
    if (resource === "results") return json({ results: await store.listPublicResults(limit) });
    return notFound();
  }
  if (resource === "profiles" && (tail.length === 2 || (tail.length === 3 && (tail[2] === "ratings" || tail[2] === "diagnostics" || tail[2] === "metrics")))) {
    const key = profileKey(tail[0], tail[1]);
    const profile = key && await store.getProfile(key);
    if (!profile) return notFound();
    if (tail[2] === "diagnostics") return json(await profileDiagnostics(db, profile.profile.profileId, profile.profile.version));
    if (tail[2] === "metrics") return json(await store.getProfileMetrics(benchmarkProfileVersionId(profile.profile)));
    return tail.length === 2 ? json(profile) : json({ ratings: await store.listRatingHistory(benchmarkProfileVersionId(profile.profile), limit) });
  }
  if (resource === "results" && tail.length === 3) {
    const [jobId, tableIndex, boardIndex] = tail as [string, string, string];
    if (!isId(jobId) || !pathIndex(tableIndex, MAX_BENCHMARK_TABLES - 1) || !pathIndex(boardIndex, MAX_BENCHMARK_BOARDS - 1)) return notFound();
    const result = await store.getPublicResult(jobId, Number(tableIndex), Number(boardIndex));
    if (result) return json(result);
  }
  return notFound();
}

export async function benchmarkRoute(request: Request, env: Env, admin: boolean): Promise<Response> {
  try {
    if (admin) {
      const access = await benchmarkAdminAccess(request, env);
      if (access === "unauthenticated") return json({ error: access }, 401);
      if (access === "forbidden") return json({ error: access }, 403);
    }
    const url = new URL(request.url);
    const prefix = admin ? ADMIN_BENCHMARK_PATH : PUBLIC_BENCHMARK_PATH;
    const path = url.pathname.slice(prefix.length + 1).split("/");
    const limits = url.searchParams.getAll("limit");
    if (limits.length > 1 || (limits[0] !== undefined && (!/^\d+$/.test(limits[0]) || !intBetween(Number(limits[0]), 1, MAX_BENCHMARK_PAGE)))) {
      return badRequest();
    }
    const limit = limits[0] === undefined ? undefined : Number(limits[0]);
    const store = new BenchmarkStore(env.DB);
    if (!admin) return await publicRoute(request, env.DB, store, path, limit);

    const [resource, ...tail] = path;
    if (resource === "profiles") return await profilesAdminRoute(request, store, tail, limit);
    if (resource === "cohorts") return await cohortsRoute(request, store, tail, limit);
    if (resource === "jobs" && tail.length === 4 && tail[1] === "boards" && tail[3] === "double-dummy") {
      const [id, , index] = tail;
      if (!isId(id) || !index || !pathIndex(index, MAX_BENCHMARK_BOARDS - 1)) return notFound();
      if (request.method === "GET") {
        const board = await analysisBoard(env.DB, id, Number(index));
        return board ? json(board) : notFound();
      }
      if (request.method !== "POST") return methodNotAllowed("GET, POST");
      const baseline = parseBaseline(await configBody(request));
      if (!baseline) return badRequest();
      const status = await recordAnalysis(env.DB, id, Number(index), baseline);
      if (status === "missing") return notFound();
      if (status === "conflict") return conflict();
      return json({ analyzed: true }, status === "created" ? 201 : 200);
    }
    if (resource === "jobs" && tail.length === 4 && tail[1] === "results") {
      const [id, , tableIndex, boardIndex] = tail;
      if (!isId(id) || !tableIndex || !boardIndex || !pathIndex(tableIndex, MAX_BENCHMARK_TABLES - 1)
        || !pathIndex(boardIndex, MAX_BENCHMARK_BOARDS - 1)) return notFound();
      if (request.method !== "GET") return methodNotAllowed("GET");
      const result = await store.getReleasedResult(id, Number(tableIndex), Number(boardIndex));
      return result ? json(result) : notFound();
    }
    if (resource === "jobs") return await jobsRoute(request, env, store, tail, limit);
    if (resource === "imports" && tail.length === 0) return await importsRoute(request, store, limit);
    return notFound();
  } catch {
    return json({ error: "unavailable" }, 503);
  }
}
