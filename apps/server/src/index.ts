import { MAX_MESSAGE_BYTES, MAX_TABLE_NAME, PROTOCOL_VERSION, TABLE_SCORINGS, cleanName } from "@contractplay/protocol";
import type { TableScoring, TableStyle } from "@contractplay/protocol";
import { RANKS, SEATS, SUITS } from "@contractplay/core";
import type { Card, Deal, Seat, Vulnerability } from "@contractplay/core";
import type { DuplicateSessionBoard } from "@contractplay/table";
import { ID_ALPHABET, LISTED_ID_LENGTH, UNLISTED_ID_LENGTH, lobbyOf } from "./lobby-object.js";

// The entry module may only export handlers and Durable Object classes.
export { LobbyObject } from "./lobby-object.js";
export { TableObject } from "./table-object.js";
export { SessionObject } from "./session-object.js";

const TABLE_ID = new RegExp(`^([${ID_ALPHABET}]{${LISTED_ID_LENGTH}}|[${ID_ALPHABET}]{${UNLISTED_ID_LENGTH}})$`);
const STYLES: readonly unknown[] = ["SAYC", "2/1"] satisfies TableStyle[];
const SESSION_BODY_BYTES = 128_000;
const VULNERABILITIES: readonly unknown[] = ["None", "NS", "EW", "Both"] satisfies Vulnerability[];

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Sanitizes uploaded deals: exactly thirteen distinct cards in each hand, all 52 cards unique. */
function importedBoards(value: unknown): DuplicateSessionBoard[] | undefined {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) return undefined;
  const boards: DuplicateSessionBoard[] = [];
  for (const raw of value) {
    if (!record(raw) || typeof raw.number !== "number" || !Number.isSafeInteger(raw.number) || raw.number < 1
      || !SEATS.includes(raw.dealer as Seat) || !VULNERABILITIES.includes(raw.vulnerability)) return undefined;
    if (!record(raw.deal)) return undefined;
    const seen = new Set<string>();
    const hands = {} as Record<Seat, Card[]>;
    for (const seat of SEATS) {
      const hand = raw.deal[seat];
      if (!Array.isArray(hand) || hand.length !== 13) return undefined;
      const cards: Card[] = [];
      for (const rawCard of hand) {
        if (!record(rawCard) || !SUITS.includes(rawCard.suit as Card["suit"])
          || !RANKS.includes(rawCard.rank as Card["rank"])) return undefined;
        const key = `${String(rawCard.suit)}:${String(rawCard.rank)}`;
        if (seen.has(key)) return undefined;
        seen.add(key);
        cards.push({ suit: rawCard.suit as Card["suit"], rank: rawCard.rank as Card["rank"] });
      }
      hands[seat] = cards;
    }
    if (seen.size !== 52) return undefined;
    boards.push({ number: raw.number, deal: hands as Deal, dealer: raw.dealer as Seat, vulnerability: raw.vulnerability as Vulnerability });
  }
  return boards;
}

/** The request body as text, or undefined once it is over `limit` bytes; never buffers more than `limit` bytes plus one chunk. */
async function readLimited(request: Request, limit: number): Promise<string | undefined> {
  const declared = request.headers.get("Content-Length");
  if (declared !== null && !(Number(declared) <= limit)) return undefined;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

async function createTable(request: Request, env: Env): Promise<Response> {
  const bad = () => Response.json({ error: "bad-request" }, { status: 400 });
  const text = await readLimited(request, MAX_MESSAGE_BYTES);
  if (text === undefined) return bad();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return bad(); }
  if (typeof body !== "object" || body === null) return bad();
  const { name: rawName, style, listed, scoring = "rubber" } = body as Record<string, unknown>;
  const name = cleanName(rawName, MAX_TABLE_NAME);
  if (name === undefined || !STYLES.includes(style) || typeof listed !== "boolean" || !(TABLE_SCORINGS as readonly unknown[]).includes(scoring)) return bad();
  // the raw address goes over the internal binding only; the lobby keeps just a salted hash of it
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const result = await lobbyOf(env).createTable({ name, style: style as TableStyle, scoring: scoring as TableScoring, listed }, address);
  return "error" in result ? Response.json(result, { status: 429 }) : Response.json(result, { status: 201 });
}

async function createSession(request: Request, env: Env): Promise<Response> {
  const text = await readLimited(request, SESSION_BODY_BYTES);
  if (text === undefined) return Response.json({ error: "bad-request" }, { status: 400 });
  let body: unknown;
  try { body = JSON.parse(text); } catch { return Response.json({ error: "bad-request" }, { status: 400 }); }
  if (typeof body !== "object" || body === null) return Response.json({ error: "bad-request" }, { status: 400 });
  const data = body as Record<string, unknown>;
  const name = cleanName(data.name, MAX_TABLE_NAME);
  const tableCount = typeof data.tableCount === "number" ? data.tableCount : NaN;
  const boardCount = typeof data.boardCount === "number" ? data.boardCount : NaN;
  const boards = data.boards === undefined ? undefined : importedBoards(data.boards);
  if (name === undefined || !STYLES.includes(data.style) || typeof data.listed !== "boolean"
    || !Number.isInteger(tableCount) || !Number.isInteger(boardCount)
    || tableCount < 2 || tableCount > 8 || boardCount < 1 || boardCount > 32
    || (data.boards !== undefined && (boards === undefined || boards.length !== boardCount))
    || (data.scoring !== "matchpoints" && data.scoring !== "imps")) return Response.json({ error: "bad-request" }, { status: 400 });
  const result = await lobbyOf(env).createSession({ name, style: data.style as TableStyle, listed: data.listed,
    tableCount, boardCount, scoring: data.scoring, ...(boards ? { boards } : {}) }, request.headers.get("CF-Connecting-IP") ?? "unknown");
  if ("error" in result) return Response.json(result, { status: result.error === "bad-request" ? 400 : 429 });
  return Response.json(result, { status: 201 });
}

/** A socket for an id that cannot exist: answers `gone` and closes. */
function goneSocket(): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.accept();
  server.send(JSON.stringify({ type: "gone" }));
  server.close(1000, "gone");
  return new Response(null, { status: 101, webSocket: client });
}

function connectTable(request: Request, env: Env, id: string): Response | Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected a WebSocket", { status: 426 });
  // ids are matched case-insensitively: a link typed in lower case still finds the table
  id = id.toUpperCase();
  if (!TABLE_ID.test(id)) return goneSocket();
  return env.TABLES.get(env.TABLES.idFromName(id)).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/health") return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
    if (path === "/admin" && (request.method === "GET" || request.method === "HEAD")) {
      return env.ASSETS.fetch(new Request(new URL("/", url), { method: request.method, headers: request.headers }));
    }
    if (path === "/api/admin/tables") {
      if (request.method === "GET") return Response.json({ tables: await lobbyOf(env).listAll() });
      return new Response("method not allowed", { status: 405 });
    }
    const adminTable = /^\/api\/admin\/tables\/([^/]+)$/.exec(path);
    if (adminTable) {
      if (request.method !== "DELETE") return new Response("method not allowed", { status: 405 });
      const rawId = adminTable[1]!.toUpperCase();
      if (!TABLE_ID.test(rawId)) return Response.json({ error: "bad-request" }, { status: 400 });
      const response = await env.TABLES.get(env.TABLES.idFromName(rawId)).fetch("https://table/_admin/delete", { method: "DELETE" });
      return response.status === 204 ? response : Response.json({ error: "not-found" }, { status: 404 });
    }
    if (path === "/api/tables") {
      if (request.method === "GET") return Response.json(await lobbyOf(env).list());
      if (request.method === "POST") return createTable(request, env);
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    if (path === "/api/sessions") {
      if (request.method === "POST") return createSession(request, env);
      return Response.json({ error: "method not allowed" }, { status: 405 });
    }
    const socket = /^\/api\/tables\/([^/]+)\/ws$/.exec(path);
    if (socket) return connectTable(request, env, socket[1]!);
    if (path.startsWith("/api/")) return Response.json({ error: "not found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
