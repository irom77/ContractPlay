import { MAX_MESSAGE_BYTES, MAX_TABLE_NAME, PROTOCOL_VERSION, cleanName } from "@contractplay/protocol";
import type { TableStyle } from "@contractplay/protocol";
import { ID_ALPHABET, LISTED_ID_LENGTH, UNLISTED_ID_LENGTH, lobbyOf } from "./lobby-object.js";

// The entry module may only export handlers and Durable Object classes.
export { LobbyObject } from "./lobby-object.js";
export { TableObject } from "./table-object.js";

const TABLE_ID = new RegExp(`^([${ID_ALPHABET}]{${LISTED_ID_LENGTH}}|[${ID_ALPHABET}]{${UNLISTED_ID_LENGTH}})$`);
const STYLES: readonly unknown[] = ["SAYC", "2/1"] satisfies TableStyle[];

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
  const { name: rawName, style, listed } = body as Record<string, unknown>;
  const name = cleanName(rawName, MAX_TABLE_NAME);
  if (name === undefined || !STYLES.includes(style) || typeof listed !== "boolean") return bad();
  // the raw address goes over the internal binding only; the lobby keeps just a salted hash of it
  const address = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const result = await lobbyOf(env).createTable({ name, style: style as TableStyle, listed }, address);
  return "error" in result ? Response.json(result, { status: 429 }) : Response.json(result, { status: 201 });
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
    const socket = /^\/api\/tables\/([^/]+)\/ws$/.exec(path);
    if (socket) return connectTable(request, env, socket[1]!);
    if (path.startsWith("/api/")) return Response.json({ error: "not found" }, { status: 404 });
    return env.ASSETS.fetch(request);
  }
} satisfies ExportedHandler<Env>;
