import { DurableObject } from "cloudflare:workers";
import { MAX_MESSAGE_BYTES, PROTOCOL_VERSION, parseClientMessage } from "@contractplay/protocol";
import type { ServerMessage, TableScoring, TableStyle, TableSummary } from "@contractplay/protocol";
import { BOT_PAUSE_MS, botToAct, botWake, canDeal, chooseBotAction, createTable, isReplayHand, nextWake, reduce, replayVulnerability, summaryOf, viewFor } from "@contractplay/table";
import type { Outcome, PlayerId, TableEvent, TableState } from "@contractplay/table";
import { lobbyOf } from "./lobby-object.js";
import { AuthStore } from "./auth-store.js";
import { DealArchive } from "./deal-archive.js";
import type { Account } from "./auth-store.js";

/** Only read on the internal TABLES binding; the Worker always removes public values. */
export const VERIFIED_ACCOUNT_HEADER = "X-ContractPlay-Account";
export type VerifiedAccount = Pick<Account, "id" | "primaryPlayerId" | "displayName">;

const STATE_KEY = "state";
const isFinished = (state: TableState): boolean => state.game?.phase === "complete" || state.game?.phase === "passed-out";
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
type Attachment = { ip: string; acceptedAt: number; account?: VerifiedAccount; player?: PlayerId; name?: string };
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
  async create(input: { id: string; name: string; style: TableStyle; scoring?: TableScoring; listed: boolean }): Promise<TableSummary | undefined> {
    if (await this.load()) return undefined;
    const state = createTable({ ...input, at: Date.now() });
    await this.save(state);
    return summaryOf(state);
  }

  /** Used only while the lobby is assembling a new multi-table duplicate session. */
  async bindSession(sessionId: string): Promise<TableSummary | undefined> {
    const state = await this.load();
    if (!state || state.sessionId || state.handNumber !== 0) return undefined;
    const bound = { ...state, scoring: "duplicate" as const, sessionId };
    await this.save(bound);
    return summaryOf(bound);
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/_admin/delete") {
      if (request.method !== "DELETE") return new Response("method not allowed", { status: 405 });
      return await this.deleteAdmin() ? new Response(null, { status: 204 }) : new Response(null, { status: 404 });
    }
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
    const verified = request.headers.get(VERIFIED_ACCOUNT_HEADER);
    const account = verified ? JSON.parse(verified) as VerifiedAccount : undefined;
    server.serializeAttachment({ ip, acceptedAt, ...(account ? { account } : {}) } satisfies Attachment);
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
    if (!parsed || parsed.type === "hello") return send(ws, { type: "refused", reason: "bad-message", view: await this.view(state, me.player) });
    if (parsed.type === "refresh") {
      await this.reportFinishedSessionHand(state);
      return send(ws, { type: "view", view: await this.view(state, me.player) });
    }
    const out = await this.dispatch({ type: "message", player: me.player, message: parsed, at: Date.now() });
    if (out.refused) send(ws, { type: "refused", reason: out.refused, view: await this.view(out.state, me.player) });
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
    // the only place the bot-pause floor applies: a wake still in the past here (a refused or
    // undecided bot action) must not fire the alarm again at once
    await this.arm(await this.load(), BOT_PAUSE_MS);
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
    if (parsed?.type !== "hello") return send(ws, { type: "refused", reason: "bad-message", view: await this.view(state, undefined) });
    const account = attachmentOf(ws)?.account;
    if ((account || parsed.expectedPlayerId !== undefined) && parsed.expectedPlayerId !== account?.primaryPlayerId) {
      send(ws, { type: "account-changed" });
      ws.close(1008, "account changed");
      return;
    }
    if (!account && parsed.secret === undefined) return send(ws, { type: "refused", reason: "bad-message", view: await this.view(state, undefined) });
    if (this.openSockets().filter((other) => other !== ws && identityOf(other)).length >= MAX_SOCKETS_PER_TABLE) {
      ws.close(1013, "too many connections");
      return;
    }
    let player: PlayerId;
    let name = parsed.name;
    if (account) {
      const linked = new Set(await new AuthStore(this.env.DB).playerIdsForAccount(account.id));
      linked.add(account.primaryPlayerId);
      // Re-read live state after the D1 lookup; only this table decides which linked IDs are seated.
      const current = await this.load();
      if (!current) return this.gone(ws);
      const seated = Object.values(current.seats).flatMap((seat) => seat.kind === "human" && linked.has(seat.player) ? [seat.player] : []);
      if (seated.length > 1) {
        send(ws, { type: "identity-conflict" });
        ws.close(1008, "identity conflict");
        return;
      }
      player = seated[0] ?? account.primaryPlayerId;
      name = account.displayName;
    } else {
      player = await playerIdOf(parsed.secret!);
    }
    ws.serializeAttachment({ ...attachmentOf(ws)!, player, name } satisfies Attachment);
    await this.dispatch({ type: "connect", player, name, at: Date.now() });
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
   * Sets the alarm for the earliest of: the state's next wake (a wake already past: `floorMs` from now);
   * RECONCILE_MS from now while connections are counted; and the earliest hello deadline of a pending
   * socket (the alarm closes overdue ones, so it cannot loop). Only `alarm()` passes a floor (one bot
   * pause, so a past wake it could not act on cannot busy-loop); any other event arms for the wake
   * itself, or now if it is past, so connection churn never moves a due or pending wake later.
   */
  private async arm(state: TableState | null, floorMs = 0): Promise<void> {
    const now = Date.now();
    const wake = state ? nextWake(state) : undefined;
    const backstop = state && Object.keys(state.connections).length > 0 ? now + RECONCILE_MS : Infinity;
    const hello = Math.min(...this.openSockets().flatMap((ws) => {
      const attachment = attachmentOf(ws);
      return attachment && attachment.player === undefined ? [Math.max(attachment.acceptedAt + HELLO_TIMEOUT_MS, now)] : [];
    }));
    const at = Math.min(wake === undefined ? Infinity : (wake > now ? wake : now + floorMs), backstop, hello);
    if (at === Infinity) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
  }

  /** Applies an event; on a change stores it, then sends every identified connection its own view. */
  private async dispatch(event: TableEvent, retries = 3): Promise<Outcome> {
    const state = (await this.load())!;
    let beforeReduce = state;
    if (state.sessionId && event.type === "message" && event.message.type === "deal") {
      const board = await this.env.SESSIONS.get(this.env.SESSIONS.idFromName(state.sessionId)).boardFor(state.id, state.handNumber);
      if (!board) return { state, refused: "not-ready" };
      beforeReduce = { ...state, sessionBoard: { ...board, index: state.handNumber } };
    } else if (event.type === "message" && event.message.type === "deal" && retries > 0 && isReplayHand(state) && canDeal(state, event.player)) {
      const replay = await this.pickReplay(state);
      // The archive read let other messages in; this event was judged against a state that is gone, so judge it again.
      // Identity, not revision: connect and disconnect change the state without bumping it, and every change goes through save.
      const fresh = await this.load();
      if (!fresh) return { state, expired: true };
      // Bounded: a busy table cannot starve the deal; after the last retry it is dealt fresh, without a replay.
      if (fresh !== state) return this.dispatch(event, retries - 1);
      if (replay) beforeReduce = { ...state, replayBoard: { ...replay, index: state.handNumber } };
    }
    const out = reduce(beforeReduce, event, secureRandom);
    if (out.expired) {
      await this.expire(state);
      return out;
    }
    if (out.state === state) return out;
    // A refusal hands back the state it was given, replay board included; nothing changed, so nothing is stored.
    if (out.state === beforeReduce) return { ...out, state };
    await this.save(out.state);
    await this.reportFinishedSessionHand(out.state);
    const sessionStatus = await this.sessionStatus(out.state);
    for (const ws of this.ctx.getWebSockets()) {
      const me = identityOf(ws);
      if (me) send(ws, { type: "view", view: viewFor(out.state, me.player, sessionStatus) });
    }
    const summary = summaryOf(out.state);
    if (JSON.stringify(summary) !== JSON.stringify(summaryOf(state))) {
      // the change is already stored and sent; a missed lobby update is repaired by the next change to the lobby row
      try {
        await this.lobby().update(summary);
      } catch {
        console.warn("table: lobby update failed; a later seat or score change will repair it");
      }
    }
    // after the broadcast, so archive latency never delays the result
    if (!isFinished(state) && isFinished(out.state)) await this.archiveFinishedHand(out.state);
    return out;
  }

  private async sessionStatus(state: TableState) {
    if (!state.sessionId) return undefined;
    try { return await this.env.SESSIONS.get(this.env.SESSIONS.idFromName(state.sessionId)).status(state.id); }
    catch { return undefined; }
  }

  /** A replay for the next hand, or undefined when none is eligible or the archive fails; a hand is never blocked on the archive. */
  private async pickReplay(state: TableState) {
    try { return await new DealArchive(this.env.DB).pickReplay(Date.now(), "online", replayVulnerability(state)); }
    catch (error) { console.warn("table: deal archive unavailable; dealing a fresh hand", error); return undefined; }
  }

  /** Stores a just-finished hand's result; duplicate session tables never write to the archive. */
  private async archiveFinishedHand(state: TableState): Promise<void> {
    const game = state.game;
    if (state.sessionId || !game) return;
    try {
      await new DealArchive(this.env.DB).record({
        deal: game.initialDeal, dealer: game.dealer, vulnerability: game.vulnerability, actions: game.history.actions,
        source: "online", playedAt: Date.now(), ...(state.replay ? { replayOf: state.replay.dealId } : {})
      });
    } catch (error) { console.warn("table: deal archive write failed; the hand is unaffected", error); }
  }

  private async reportFinishedSessionHand(state: TableState): Promise<void> {
    if (!state.sessionId || !state.handNumber || !state.game || (state.game.phase !== "complete" && state.game.phase !== "passed-out")) return;
    const nsScore = state.game.phase === "complete" ? state.game.score?.score ?? 0 : 0;
    try { await this.env.SESSIONS.get(this.env.SESSIONS.idFromName(state.sessionId)).report(state.id, state.handNumber - 1, nsScore); }
    catch { console.warn("table: session result report failed; a later refresh will retry"); }
  }

  private async view(state: TableState, player: PlayerId | undefined) {
    return viewFor(state, player, await this.sessionStatus(state));
  }

  /** Removes a table at an admin's request, including its lobby entry, alarm, storage, and sockets. */
  private async deleteAdmin(): Promise<boolean> {
    const state = await this.load();
    if (!state) return false;
    await this.expire(state, true);
    return true;
  }

  /** Removes the lobby entry first, so a failed removal leaves the table for the alarm's retry instead of a stale lobby row. */
  private async expire(state: TableState, closeSockets = false): Promise<void> {
    await this.lobby().remove(state.id);
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    this.state = null;
    if (closeSockets) {
      for (const ws of this.openSockets()) this.gone(ws);
    }
  }

  private lobby() {
    return lobbyOf(this.env);
  }
}
