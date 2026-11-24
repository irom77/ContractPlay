import { SEATS } from "@contractplay/core";
import type { Bid, GameAction, Seat, Vulnerability } from "@contractplay/core";
import { hash, authRequestAllowed } from "./auth.js";
import { AuthStore } from "./auth-store.js";
import { DealArchive } from "./deal-archive.js";
import { isRecord, parseCard, parseDeal, readLimited } from "./deal-input.js";

const HOUR = 3_600_000;
const RESULT_BODY_BYTES = 64_000;
const RESULTS_PER_HOUR = 120;
const REPLAYS_PER_HOUR = 60;
const VULNERABILITIES: readonly unknown[] = ["None", "NS", "EW", "Both"] satisfies Vulnerability[];
const BID = /^(pass|double|redouble|[1-7](clubs|diamonds|hearts|spades|notrump))$/;

const json = (body: unknown, status: number) => Response.json(body, { status });

/** The actions with known shapes only (the archive then checks legality), or undefined for anything malformed. */
function parseActions(value: unknown): GameAction[] | undefined {
  if (!Array.isArray(value) || value.length > 400) return undefined;
  const actions: GameAction[] = [];
  for (const raw of value) {
    if (!isRecord(raw) || !SEATS.includes(raw.seat as Seat)) return undefined;
    const seat = raw.seat as Seat;
    if (raw.type === "bid" && typeof raw.bid === "string" && BID.test(raw.bid)) actions.push({ type: "bid", seat, bid: raw.bid as Bid });
    else if (raw.type === "play" && parseCard(raw.card)) actions.push({ type: "play", seat, card: parseCard(raw.card)! });
    else if (raw.type === "claim" && typeof raw.tricks === "number" && Number.isInteger(raw.tricks)) actions.push({ type: "claim", seat, tricks: raw.tricks });
    else return undefined;
  }
  return actions;
}

async function rateAllowed(request: Request, env: Env, scope: string, limit: number): Promise<boolean> {
  const key = await hash(`deals:${scope}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`);
  return new AuthStore(env.DB).admitAuthAttempt(key, Date.now(), HOUR, limit);
}

async function replay(request: Request, env: Env): Promise<Response> {
  const vulnerability = new URL(request.url).searchParams.get("vulnerability");
  if (vulnerability !== null && !VULNERABILITIES.includes(vulnerability)) return json({ error: "bad-request" }, 400);
  if (!await rateAllowed(request, env, "replay", REPLAYS_PER_HOUR)) return json({ error: "too-many-requests" }, 429);
  const picked = await new DealArchive(env.DB).pickReplay(Date.now(), (vulnerability ?? undefined) as Vulnerability | undefined);
  return picked ? json(picked, 200) : new Response(null, { status: 204 });
}

async function results(request: Request, env: Env): Promise<Response> {
  const invalid = () => json({ error: "invalid-hand" }, 400);
  const text = await readLimited(request, RESULT_BODY_BYTES);
  if (text === undefined) return invalid();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return invalid(); }
  if (!isRecord(body)) return invalid();
  const deal = parseDeal(body.deal);
  const actions = parseActions(body.actions);
  if (!deal || !actions || !SEATS.includes(body.dealer as Seat) || !VULNERABILITIES.includes(body.vulnerability)
    || (body.replayOf !== undefined && typeof body.replayOf !== "string")) return invalid();
  if (!await rateAllowed(request, env, "results", RESULTS_PER_HOUR)) return json({ error: "too-many-requests" }, 429);
  const dealId = await new DealArchive(env.DB).record({ deal, dealer: body.dealer as Seat, vulnerability: body.vulnerability as Vulnerability,
    actions, source: "solo", playedAt: Date.now(), ...(body.replayOf === undefined ? {} : { replayOf: body.replayOf }) });
  return dealId === undefined ? invalid() : json({ dealId }, 201);
}

export async function dealRoute(request: Request, env: Env): Promise<Response> {
  if (!authRequestAllowed(request, env)) return json({ error: "forbidden" }, 403);
  const path = new URL(request.url).pathname;
  try {
    if (request.method === "GET" && path === "/api/deals/replay") return await replay(request, env);
    if (request.method === "POST" && path === "/api/deals/results") return await results(request, env);
    return json({ error: "not found" }, 404);
  } catch (error) {
    console.warn("deal archive unavailable", error);
    return json({ error: "unavailable" }, 503);
  }
}
