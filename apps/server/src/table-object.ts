import { DurableObject } from "cloudflare:workers";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientMessage } from "@contractplay/protocol";
import type { ServerMessage, TableStyle, TableSummary } from "@contractplay/protocol";
import { BOT_PAUSE_MS, botToAct, botWake, chooseBotAction, createTable, nextWake, reduce, summaryOf, viewFor } from "@contractplay/table";
import type { Outcome, PlayerId, TableEvent, TableState } from "@contractplay/table";
import { lobbyOf } from "./lobby-object.js";

const STATE_KEY = "state";
/** Most open sockets one table accepts that have completed `hello`. */
export const MAX_SOCKETS_PER_TABLE = 32;
/** Most open sockets one table holds that have not completed `hello` yet. */
export const MAX_PENDING_SOCKETS = 16;
/** Most sockets one client IP may hold on one table that have not completed `hello` yet. */
export const MAX_PENDING_PER_IP = 2;
/** Most open sockets one table accepts from one client IP, pending and identified together. */
export const MAX_SOCKETS_PER_IP = 8;
/** A socket that has not completed `hello` this long after it was accepted is closed. */
export const HELLO_TIMEOUT_MS = 10_000;
/**
 * While connections are counted, the alarm fires at least this often, so counts left by sockets
 * lost in a restart are reconciled (and the table can expire) even if no client comes back.
 */
const RECONCILE_MS = 3_600_000;

/**
 * Kept on each socket so it survives hibernation: the client IP (used only for the per-IP cap; it
 * never reaches the table state, a client, the lobby, or a log), when the socket was accepted, and,
 * once `hello` completed, the player and name.
 */
type Attachment = { ip: string; acceptedAt: number; player?: PlayerId; name?: string };
type Identity = { player: PlayerId; name: string };

/** A float in [0, 1) from the platform's cryptographic source; deals must not be predictable. */
function secureRandom(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

/** Player id: lowercase hex SHA-256 of the device secret. */
async function playerIdOf(secret: string): Promise<PlayerId> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const attachmentOf = (ws: WebSocket): Attachment | undefined => (ws.deserializeAttachment() as Attachment | null) ?? undefined;

/** The socket's player once `hello` completed. */
function identityOf(ws: WebSocket): Identity | undefined {
  const attachment = attachmentOf(ws);
  return attachment?.player === undefined ? undefined : { player: attachment.player, name: attachment.name ?? "" };
}

function send(ws: WebSocket, message: ServerMessage): void {
  try { ws.send(JSON.stringify(message)); } catch { /* socket already closing */ }
}

/** The raw `version` of a first frame that claims to be a hello, read before full validation. */
function helloVersion(text: string): unknown {
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data === "object" && data !== null && (data as { type?: unknown }).type === "hello") return (data as { version?: unknown }).version;
  } catch { /* not JSON */ }
  return undefined;
}

/**
 * One table: stores its state, runs every event through `reduce`, and sends each connection
 * `viewFor` its own player. No table rules live here.
 */
export class TableObject extends DurableObject<Env> {
  /** undefined: not read from storage yet; null: no such table. */
  private state: TableState | null | undefined;

  /** Creates the table; undefined when one already exists under this id. */
  async create(input: { id: string; name: string; style: TableStyle; listed: boolean }): Promise<TableSummary | undefined> {
    if (await this.load()) return undefined;
    const state = createTable({ ...input, at: Date.now() });
    await this.save(state);
    return summaryOf(state);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("expected a WebSocket", { status: 426 });
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    const open = this.openSockets();
    const pending = open.filter((ws) => !identityOf(ws));
    const fromIp = open.filter((ws) => attachmentOf(ws)?.ip === ip).length;
    const pendingFromIp = pending.filter((ws) => attachmentOf(ws)?.ip === ip).length;
    if (pending.length >= MAX_PENDING_SOCKETS || open.length - pending.length >= MAX_SOCKETS_PER_TABLE
      || fromIp >= MAX_SOCKETS_PER_IP || pendingFromIp >= MAX_PENDING_PER_IP) {
      return Response.json({ error: "too-many-connections" }, { status: 429 });
    }
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const acceptedAt = Date.now();
    server.serializeAttachment({ ip, acceptedAt } satisfies Attachment);
    // only ever bring the alarm earlier for the new hello deadline, so a connection never delays a due wake
    const deadline = acceptedAt + HELLO_TIMEOUT_MS;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || deadline < current) await this.ctx.storage.setAlarm(deadline);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return this.closeSocket(ws, 1003, "text frames only");
    if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) return this.closeSocket(ws, 1009, "message too big");
    const me = identityOf(ws);
    if (!me) return this.hello(ws, message);
    const state = await this.load();
    if (!state) return this.gone(ws);
    const parsed = parseClientMessage(message);
    if (!parsed || parsed.type === "hello") return send(ws, { type: "refused", reason: "bad-message", view: viewFor(state, me.player) });
    const out = await this.dispatch({ type: "message", player: me.player, message: parsed, at: Date.now() });
    if (out.refused) send(ws, { type: "refused", reason: out.refused, view: viewFor(out.state, me.player) });
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    await this.reconcile(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.reconcile(ws);
  }

  /**
   * Closes sockets past their hello deadline, reconciles connection counts, makes at most one bot
   * decision, and only once it is due (to stay within the per-invocation CPU limit), then a tick,
   * then re-arms.
   */
  async alarm(): Promise<void> {
    const now = Date.now();
    for (const ws of this.openSockets()) {
      const attachment = attachmentOf(ws);
      if (attachment && attachment.player === undefined && now >= attachment.acceptedAt + HELLO_TIMEOUT_MS) ws.close(1008, "hello timeout");
    }
    const state = await this.load();
    if (state) {
      await this.reconcile();
      const current = await this.load();
      const due = current ? botWake(current) : undefined;
      if (current && botToAct(current) !== undefined && due !== undefined && Date.now() >= due) {
        const action = await chooseBotAction(current);
        if (action) await this.dispatch({ type: "bot", revision: current.revision, action, at: Date.now() });
      }
      if (await this.load()) await this.dispatch({ type: "tick", at: Date.now() });
    }
    await this.arm(await this.load());
  }

  private openSockets(): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => ws.readyState === WebSocket.READY_STATE_OPEN);
  }

  /** The first frame on a socket: version check, table check, then identify the player and connect. */
  private async hello(ws: WebSocket, message: string): Promise<void> {
    const version = helloVersion(message);
    if (version !== undefined && version !== PROTOCOL_VERSION) {
      send(ws, { type: "reload" });
      ws.close(1000, "reload");
      return;
    }
    const state = await this.load();
    if (!state) return this.gone(ws);
    const parsed = parseClientMessage(message);
    if (parsed?.type !== "hello") return send(ws, { type: "refused", reason: "bad-message", view: viewFor(state, undefined) });
    if (this.openSockets().filter((other) => other !== ws && identityOf(other)).length >= MAX_SOCKETS_PER_TABLE) {
      ws.close(1013, "too many connections");
      return;
    }
    const player = await playerIdOf(parsed.secret);
    ws.serializeAttachment({ ...attachmentOf(ws)!, player, name: parsed.name } satisfies Attachment);
    await this.dispatch({ type: "connect", player, name: parsed.name, at: Date.now() });
  }

  private gone(ws: WebSocket): void {
    send(ws, { type: "gone" });
    ws.close(1000, "gone");
  }

  private async closeSocket(ws: WebSocket, code: number, reason: string): Promise<void> {
    ws.close(code, reason);
    await this.reconcile(ws);
  }

  /**
   * Brings connection counts in line with the open sockets: a `disconnect` for each counted
   * connection that has no open socket. Covers closes, errors, and sockets lost in a restart.
   */
  private async reconcile(closing?: WebSocket): Promise<void> {
    const state = await this.load();
    if (!state) return;
    const open = new Map<PlayerId, number>();
    for (const ws of this.ctx.getWebSockets()) {
      const me = identityOf(ws);
      if (ws === closing || ws.readyState !== WebSocket.READY_STATE_OPEN || !me) continue;
      open.set(me.player, (open.get(me.player) ?? 0) + 1);
    }
    for (const [player, counted] of Object.entries(state.connections)) {
      for (let n = open.get(player) ?? 0; n < counted; n++) await this.dispatch({ type: "disconnect", player, at: Date.now() });
    }
  }

  private async load(): Promise<TableState | null> {
    if (this.state === undefined) {
      this.state = (await this.ctx.storage.get<TableState>(STATE_KEY)) ?? null;
      // a fresh instance: sockets lost in a restart never reported their close
      if (this.state) await this.reconcile();
    }
    return this.state;
  }

  /** Stores the state, then sets the alarm for its next wake. */
  private async save(state: TableState): Promise<void> {
    this.state = state;
    await this.ctx.storage.put(STATE_KEY, state);
    await this.arm(state);
  }

  /**
   * Sets the alarm for the earliest of: the state's next wake, never sooner than one bot pause from
   * now (no busy loop on a past wake); RECONCILE_MS from now while connections are counted; and the
   * earliest hello deadline of a pending socket (the alarm closes overdue ones, so it cannot loop).
   */
  private async arm(state: TableState | null): Promise<void> {
    const now = Date.now();
    const wake = state ? nextWake(state) : undefined;
    const backstop = state && Object.keys(state.connections).length > 0 ? now + RECONCILE_MS : Infinity;
    const hello = Math.min(...this.openSockets().flatMap((ws) => {
      const attachment = attachmentOf(ws);
      return attachment && attachment.player === undefined ? [Math.max(attachment.acceptedAt + HELLO_TIMEOUT_MS, now)] : [];
    }));
    const at = Math.min(wake === undefined ? Infinity : Math.max(wake, now + BOT_PAUSE_MS), backstop, hello);
    if (at === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** Applies an event; on a change stores it, then sends every identified connection its own view. */
  private async dispatch(event: TableEvent): Promise<Outcome> {
    const state = (await this.load())!;
    const out = reduce(state, event, secureRandom);
    if (out.expired) {
      await this.expire(state);
      return out;
    }
    if (out.state === state) return out;
    await this.save(out.state);
    for (const ws of this.ctx.getWebSockets()) {
      const me = identityOf(ws);
      if (me) send(ws, { type: "view", view: viewFor(out.state, me.player) });
    }
    const summary = summaryOf(out.state);
    if (JSON.stringify(summary) !== JSON.stringify(summaryOf(state))) await this.lobby().update(summary);
    return out;
  }

  /** Removes the lobby entry first, so a failed removal leaves the table for the alarm's retry instead of a stale lobby row. */
  private async expire(state: TableState): Promise<void> {
    await this.lobby().remove(state.id);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.state = null;
  }

  private lobby() {
    return lobbyOf(this.env);
  }
}
