import { DurableObject } from "cloudflare:workers";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientMessage } from "@contractplay/protocol";
import type { ServerMessage, TableStyle, TableSummary } from "@contractplay/protocol";
import { BOT_PAUSE_MS, botToAct, chooseBotAction, createTable, nextWake, reduce, summaryOf, viewFor } from "@contractplay/table";
import type { Outcome, PlayerId, TableEvent, TableState } from "@contractplay/table";
import { lobbyOf } from "./lobby-object.js";

const STATE_KEY = "state";

/** Kept on each socket so the player survives hibernation; absent until the socket's `hello`. */
type Attachment = { player: PlayerId; name: string };

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
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return this.closeSocket(ws, 1003, "text frames only");
    if (new TextEncoder().encode(message).length > MAX_MESSAGE_BYTES) return this.closeSocket(ws, 1009, "message too big");
    const me = attachmentOf(ws);
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

  /** One bot decision per invocation (to stay within the per-invocation CPU limit), then a tick, then re-arm. */
  async alarm(): Promise<void> {
    const state = await this.load();
    if (!state) return;
    if (botToAct(state) !== undefined) {
      const action = await chooseBotAction(state);
      if (action) await this.dispatch({ type: "bot", revision: state.revision, action, at: Date.now() });
    }
    if (!(await this.load())) return;
    await this.dispatch({ type: "tick", at: Date.now() });
    const after = await this.load();
    if (after) await this.arm(after);
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
    const player = await playerIdOf(parsed.secret);
    ws.serializeAttachment({ player, name: parsed.name } satisfies Attachment);
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
      const me = attachmentOf(ws);
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

  /** Sets the alarm for the state's next wake, never sooner than one bot pause from now (no busy loop on a past wake). */
  private async arm(state: TableState): Promise<void> {
    const wake = nextWake(state);
    if (wake === undefined) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(Math.max(wake, Date.now() + BOT_PAUSE_MS));
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
      const me = attachmentOf(ws);
      if (me) send(ws, { type: "view", view: viewFor(out.state, me.player) });
    }
    const summary = summaryOf(out.state);
    if (JSON.stringify(summary) !== JSON.stringify(summaryOf(state))) await this.lobby().update(summary);
    return out;
  }

  private async expire(state: TableState): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.state = null;
    await this.lobby().remove(state.id);
  }

  private lobby() {
    return lobbyOf(this.env);
  }
}
