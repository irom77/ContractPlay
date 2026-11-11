import { MAX_MESSAGE_BYTES, MAX_TABLE_NAME, PROTOCOL_VERSION, cleanName } from "@contractplay/protocol";
import type { TableStyle } from "@contractplay/protocol";
import { lobbyOf } from "./lobby-object.js";

// The entry module may only export handlers and Durable Object classes.
export { LobbyObject } from "./lobby-object.js";
export { TableObject } from "./table-object.js";

const TABLE_ID = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;
const STYLES: readonly unknown[] = ["SAYC", "2/1"] satisfies TableStyle[];

async function createTable(request: Request, env: Env): Promise<Response> {
  const bad = () => Response.json({ error: "bad-request" }, { status: 400 });
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_MESSAGE_BYTES) return bad();
  let body: unknown;
  try { body = JSON.parse(text); } catch { return bad(); }
  if (typeof body !== "object" || body === null) return bad();
  const { name: rawName, style, listed } = body as Record<string, unknown>;
  const name = cleanName(rawName, MAX_TABLE_NAME);
  if (name === undefined || !STYLES.includes(style) || typeof listed !== "boolean") return bad();
  const result = await lobbyOf(env).createTable({ name, style: style as TableStyle, listed });
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
  if (!TABLE_ID.test(id)) return goneSocket();
  return env.TABLES.get(env.TABLES.idFromName(id)).fetch(request);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === "/api/health") return Response.json({ ok: true, protocol: PROTOCOL_VERSION });
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
