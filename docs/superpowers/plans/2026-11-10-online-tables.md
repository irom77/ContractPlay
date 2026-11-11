# Online Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Online bridge tables hosted on Cloudflare where humans pick seats, fill the rest with humans or bots, and play hand after hand with hidden cards kept on the service.

**Architecture:** A platform-neutral `packages/table` holds all table behaviour as immutable transitions (`reduce`) and the single redaction function (`viewFor`). `apps/server` is a thin Cloudflare Worker: one Durable Object per table stores the state, moves WebSocket messages, and sets alarms; one lobby object lists tables; the same Worker serves the built client. The client gains a lobby and an online table screen that reuse a table component extracted from `App.tsx`.

**Tech Stack:** TypeScript, pnpm workspaces, Vitest, React 19 + Vite, Cloudflare Workers with SQLite-backed Durable Objects and WebSocket hibernation, Wrangler, `@cloudflare/vitest-pool-workers`.

**Spec:** [`docs/superpowers/specs/2026-11-10-online-tables-design.md`](../specs/2026-11-10-online-tables-design.md)

## Global Constraints

- `packages/core`, `packages/bots`, `packages/protocol`, and `packages/table` stay platform-neutral: no DOM, Node-only, or Cloudflare APIs. Only `apps/server` imports Cloudflare types.
- Table state is immutable; every transition returns a new state, and every game action is validated by `applyAction` from `@contractplay/core` before it is recorded.
- All outgoing game data is built by `viewFor`. No other code serializes hands, auctions, or played cards to a client.
- A client never advances the game locally; it shows a call or card only after the service's next view.
- Solo play is unchanged and must work with no network. Existing tests keep passing unmodified, except imports moved by the Task 6 extraction.
- New packages follow `packages/bots`: `"type": "module"`, `tsconfig.json` + `tsconfig.build.json`, `build` = `tsc -p tsconfig.build.json`, `typecheck` = `tsc --noEmit`, exports from `dist`. TS target lacks ES2023 (`findLastIndex`, `toSorted`).
- Values from the spec: display name 1–20 characters; table name 1–40; messages over 4096 bytes refused; at most 100 listed tables; bot pause 1000 ms; extra 2000 ms after a completed trick; idle handover after 120 000 ms; host passes on after 600 000 ms away; table deleted after 24 h with no human connected; protocol version 1.
- Cloudflare free plan. Before using any Wrangler, Durable Object, or `vitest-pool-workers` option, check its current documentation (context7: `cloudflare workers`); do not rely on memory for config keys.
- Do not commit secrets. Do not deploy, change GitHub Pages, or touch DNS without the owner's confirmation (Task 10).
- Update `TODO.md`, `TODO-archive.md`, `CHANGES.md` (`## Unreleased`), and `README.md` as items land; do not claim checks that were not run. Verification for every task: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Review Focus

- One player with two open tabs or devices sharing the secret: both get views; closing one must not mark the seat away. (Task 4)
- An action accepted just before a disconnect, then resent after reconnect: answered with the current view, applied once, no error shown. (Tasks 3, 8)
- Human declarer handed to a bot while dummy is a bot or a human: the stand-in plays both hands; a human dummy can never play a card. (Task 3, 4)
- A passed-out hand: totals unchanged, dealer and vulnerability still advance, Deal is offered again. (Task 3)
- Opening a link to a table that was deleted or never existed: a clear "This table no longer exists" and a way back to the lobby, not a blank or spinning screen. (Tasks 5, 9)

---

## File Structure

```text
packages/protocol/src/index.ts        Message and view types, PROTOCOL_VERSION, limits, parseClientMessage, cleanName
packages/table/src/state.ts           TableState, SeatState, createTable, constants
packages/table/src/seats.ts           sit, leave, setBot, clearSeat, host rules
packages/table/src/hand.ts            deal, act, bot turns, scoring totals, rotation
packages/table/src/presence.ts        connect, disconnect, handToBot, resume, expiry
packages/table/src/view.ts            viewFor, summaryOf  (only redaction code)
packages/table/src/reduce.ts          reduce(state, event, random) dispatch; nextWake
packages/table/src/index.ts           Public exports
apps/server/src/index.ts              Worker fetch: /api routes, assets fallback
apps/server/src/table-object.ts       TableObject Durable Object shell
apps/server/src/lobby-object.ts       LobbyObject Durable Object
apps/server/wrangler.jsonc            Worker, assets, Durable Object bindings and migration
apps/client/src/table/TableView.tsx   Presentational table extracted from App.tsx
apps/client/src/table/labels.ts       Card/call/seat label helpers moved from App.tsx
apps/client/src/online/identity.ts    Device secret and display name
apps/client/src/online/connection.ts  WebSocket client with reconnect
apps/client/src/online/route.ts       Hash routing
apps/client/src/online/Lobby.tsx      Lobby screen
apps/client/src/online/OnlineTable.tsx Online table screen
```

---

### Task 1: Server scaffold and runtime check

Proves the two risks in the spec before anything is built on them.

**Files:**
- Create: `apps/server/package.json` (`@contractplay/server`, private; deps `@contractplay/core`, `@contractplay/bots`; devDeps `wrangler`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`), `apps/server/tsconfig.json`, `apps/server/wrangler.jsonc`, `apps/server/vitest.config.ts`, `apps/server/src/index.ts`, `apps/server/src/runtime.test.ts`
- Modify: root `vitest.config.ts` (exclude `apps/server/**`), root `package.json` (`test` also runs `pnpm --filter @contractplay/server test`; add `server:dev` = build then `wrangler dev` in `apps/server`), `eslint.config.js` only if server globals need it

**Interfaces:**
- Produces: Worker default export with `fetch`; `GET /api/health` → `200 {"ok":true,"protocol":1}`; any non-`/api/` path served from the `ASSETS` binding (`../client/dist`), with the worker running first only for `/api/*`. `Env = { ASSETS: Fetcher }` (extended in Task 4).

- [ ] **Step 1:** Write `runtime.test.ts` (runs in the Workers pool):
  - `health`: `SELF.fetch("https://x/api/health")` → status 200, JSON `{ ok: true, protocol: 1 }`.
  - `bots run in the Worker runtime`: for seeds 1–20, deal with a seeded `shuffle`, then loop `createBot({ skill: "expert", biddingStyle: "2/1" })` choosing every call and card via `applyAction` / `playContextFor` until `phase` is `complete` or `passed-out`; expect every `applyAction` result `ok`. Record `performance.now()` around each `chooseBid` / `chooseCard`; `console.log` the max and mean; expect max < 50 (ms, wall clock as a loose guard).
- [ ] **Step 2:** Run `pnpm --filter @contractplay/server test`; expect failure (no worker).
- [ ] **Step 3:** Add the config and `src/index.ts`. `wrangler.jsonc`: `name: "contractplay"`, current `compatibility_date`, `main: "src/index.ts"`, assets directory `../client/dist` with binding `ASSETS` and worker-first for `/api/*`.
- [ ] **Step 4:** Run the server tests; expect PASS. Write the measured max and mean bot decision time into the spec under "Risks to check early". If the max is over 5 ms, stop and report to the owner before Task 4 (free-plan CPU limit; the paid plan is the owner's decision).
- [ ] **Step 5:** `pnpm build && pnpm --filter @contractplay/server exec wrangler dev` locally; `curl localhost:8787/api/health` returns the JSON and `curl localhost:8787/` returns the client's `index.html`.
- [ ] **Step 6:** Run `pnpm test && pnpm typecheck && pnpm lint`; commit `feat(server): scaffold Cloudflare worker and verify bots in the runtime`.

### Task 2: Protocol package

**Files:**
- Create: `packages/protocol/{package.json,tsconfig.json,tsconfig.build.json}`, `packages/protocol/src/index.ts`, `packages/protocol/src/index.test.ts`
- Modify: root `package.json` `test` script (build `@contractplay/protocol...` first, as for the other packages)

**Interfaces — Produces:**

```ts
export const PROTOCOL_VERSION = 1;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_PLAYER_NAME = 20;
export const MAX_TABLE_NAME = 40;
export type TableStyle = "SAYC" | "2/1";

export type SeatInfo =
  | { kind: "empty" }
  | { kind: "bot"; skill: SkillLevel }
  | { kind: "human"; name: string; away: boolean; standIn?: SkillLevel };   // standIn: a bot is playing for them

export type TableSummary = { id: string; name: string; style: TableStyle; seats: Record<Seat, SeatInfo>; handInProgress: boolean };

/** GameState without history or the original deal; hands the viewer may not see are empty arrays. */
export type PublicGame = Pick<GameState, "phase" | "dealer" | "vulnerability" | "currentActor" | "auction" | "contract" | "hands" | "currentTrick" | "completedTricks" | "score" | "trickLeader">;

export type TableView = TableSummary & {
  listed: boolean; revision: number; handNumber: number;
  totals: { ns: number; ew: number };
  host?: Seat; yourSeat?: Seat; canDeal: boolean;
  game?: PublicGame;        // only for a seated viewer
  revealed?: Deal;          // all four original hands; only for a seated viewer once the hand is over
};

export type ClientMessage =
  | { type: "hello"; version: number; secret: string; name: string }
  | { type: "sit"; seat: Seat } | { type: "leave" }
  | { type: "setBot"; seat: Seat; skill: SkillLevel }
  | { type: "clearSeat"; seat: Seat }                 // clear a bot, or free/remove a human
  | { type: "deal" }
  | { type: "act"; handNumber: number; revision: number; action: GameAction }
  | { type: "handToBot"; seat: Seat } | { type: "resume" };

export type RefusalReason = "bad-message" | "not-seated" | "seat-taken" | "already-seated" | "not-allowed" | "hand-in-progress" | "not-ready" | "stale" | "not-your-turn" | "illegal";

export type ServerMessage =
  | { type: "view"; view: TableView }
  | { type: "refused"; reason: RefusalReason; view: TableView }
  | { type: "reload" }                                 // protocol version mismatch
  | { type: "gone" };                                  // table does not exist

export function parseClientMessage(raw: string): ClientMessage | undefined;
/** Trims, removes control characters, collapses whitespace; undefined when empty or longer than max. */
export function cleanName(value: unknown, max: number): string | undefined;
```

`secret` must be 32–128 characters of `[A-Za-z0-9_-]`. `action` must be `{type:"bid", seat, bid}` or `{type:"play", seat, card}` with a valid seat, a bid matching the `Bid` pattern, and a card with a known suit and rank (shape only; legality is the table's job).

- [ ] **Step 1:** Tests in `index.test.ts`: each valid message round-trips through `parseClientMessage(JSON.stringify(m))`; returns `undefined` for non-JSON, arrays, unknown `type`, missing fields, wrong field types, `seat: "up"`, `bid: "8clubs"`, card rank `"1"`, a secret of 10 characters, extra-long input (> `MAX_MESSAGE_BYTES`, measured in UTF-8 bytes); `cleanName("  Ann\u0000  B ", 20) === "Ann B"`, `cleanName("", 20) === undefined`, `cleanName("x".repeat(21), 20) === undefined`, `cleanName(5, 20) === undefined`.
- [ ] **Step 2:** Run; expect failure.
- [ ] **Step 3:** Implement with hand-written checks (no new dependency).
- [ ] **Step 4:** Run tests, typecheck, lint; commit `feat(protocol): add online table messages and validation`.

### Task 3: Table logic — seats, hands, views

**Files:**
- Create: `packages/table/{package.json,tsconfig.json,tsconfig.build.json}` (deps: core, bots, protocol), `src/state.ts`, `src/seats.ts`, `src/hand.ts`, `src/view.ts`, `src/reduce.ts`, `src/index.ts`, tests `src/seats.test.ts`, `src/hand.test.ts`, `src/view.test.ts`
- Modify: root `package.json` `test` script (build `@contractplay/table...`)

**Interfaces:**
- Consumes: Task 2 types; `createGameState`, `applyAction`, `playContextFor`, `deal`, `shuffle`, `createDeck` from core; `createBot` from bots.
- Produces:

```ts
export type PlayerId = string;
export type SeatState =
  | { kind: "empty" }
  | { kind: "bot"; skill: SkillLevel }
  | { kind: "human"; player: PlayerId; name: string; since: number; standIn?: SkillLevel };
export type TableState = Readonly<{
  id: string; name: string; style: TableStyle; listed: boolean;
  host?: PlayerId; seats: Readonly<Record<Seat, SeatState>>;
  connections: Readonly<Record<PlayerId, number>>;      // open connection count per player
  awaySince: Readonly<Record<PlayerId, number>>;        // seated players with no connection
  revision: number; handNumber: number;                 // handNumber 0 before the first deal
  game?: GameState; totals: { ns: number; ew: number };
  turnSince: number; lastHumanAt: number; trickJustCompleted: boolean;
}>;
export type TableEvent =
  | { type: "connect"; player: PlayerId; name: string; at: number }
  | { type: "disconnect"; player: PlayerId; at: number }
  | { type: "message"; player: PlayerId; message: Exclude<ClientMessage, { type: "hello" }>; at: number }
  | { type: "bot"; revision: number; action: GameAction; at: number }
  | { type: "tick"; at: number };
export type Outcome = { state: TableState; refused?: RefusalReason; expired?: true };

export function createTable(input: { id: string; name: string; style: TableStyle; listed: boolean; at: number }): TableState;
export function reduce(state: TableState, event: TableEvent, random?: () => number): Outcome;
export function viewFor(state: TableState, player: PlayerId | undefined): TableView;
export function summaryOf(state: TableState): TableSummary;
/** Seat whose turn a bot must take now (a bot seat, a stand-in, or dummy when its declarer is one), else undefined. */
export function botToAct(state: TableState): Seat | undefined;
/** The bot's choice for botToAct's seat, using only that seat's public information. */
export function chooseBotAction(state: TableState): Promise<GameAction | undefined>;
/** When the shell should send the next tick, or undefined: bot due time, host/expiry deadlines. */
export function nextWake(state: TableState): number | undefined;
export const BOT_PAUSE_MS = 1000, TRICK_PAUSE_MS = 2000, IDLE_MS = 120_000, HOST_AWAY_MS = 600_000, EMPTY_TABLE_MS = 86_400_000;
```

Rules to implement (this task covers seats and hands; presence events `connect`/`disconnect`/`handToBot`/`resume`/`tick` expiry are Task 4 and may return the state unchanged here):

- `revision` increases by one on every accepted change; a refused event returns the same state object.
- `sit`: seat must be `empty` (`seat-taken`), the player not already seated (`already-seated`), no hand in progress (cannot happen with a full table, but refuse `hand-in-progress`). The first human to sit becomes host.
- `leave`, `setBot`, `clearSeat`: only between hands (`hand-in-progress`). `setBot` needs a seated sender and an `empty` or `bot` target. `clearSeat` on a bot needs a seated sender; on a human needs the host, or any seated sender when that human is away (`not-allowed` otherwise). When the host's seat empties, the human with the smallest `since` becomes host.
- "Between hands" means `game` is undefined or its phase is `complete` or `passed-out`.
- `deal`: sender seated, all four seats non-empty, at least one human, between hands (`not-ready`). `handNumber += 1`; dealer = `SEATS[(handNumber - 1) % 4]`; vulnerability by the standard cycle `["None","NS","EW","Both","NS","EW","Both","None","EW","Both","None","NS","Both","None","NS","EW"][(handNumber - 1) % 16]`; cards from `deal(shuffle(createDeck(), random))`.
- `act`: `stale` unless `handNumber` and `revision` match; the controller of `action.seat` must be the sender, where the controller of dummy during play is declarer's controller and a human dummy controls nothing (`not-your-turn`); then `applyAction` (`illegal` on failure). On a hand reaching `complete`, add `score.score` to the declaring side's total (negative scores go to the same side as negative); `passed-out` adds nothing.
- `bot` event: ignored unless `revision` matches and `botToAct` equals `action.seat`; otherwise applied like `act`.
- `chooseBotAction`: `createBot({ skill, biddingStyle: state.style })` with the skill of the seat's bot, of the stand-in, or of declarer's bot when acting for dummy; `chooseBid(hand, auction, seat)` in the auction, `chooseCard(playContextFor(game, seat))` in play.
- `nextWake` (this task): when `botToAct` is defined, `turnSince + BOT_PAUSE_MS + (trickJustCompleted ? TRICK_PAUSE_MS : 0)`.
- `viewFor`: unseated or unknown player → no `game`, no `revealed`. Seated → `game.hands` holds the viewer's own remaining cards, dummy's remaining cards once `completedTricks.length > 0 || currentTrick.length > 0`, and `[]` for every other seat; when the hand is over, `revealed` is `game.initialDeal`. `canDeal` mirrors the `deal` rule for that viewer. `host` and `yourSeat` are seats. `SeatInfo.away` is true when the player is in `awaySince`.

- [ ] **Step 1:** `seats.test.ts`: first sitter is host; second player cannot take the same seat (`seat-taken`) or a second seat (`already-seated`); unseated `setBot` → `not-seated`; `setBot` then `clearSeat` by a seated player; newcomer cannot `sit` on a bot seat (`seat-taken`); non-host `clearSeat` on a present human → `not-allowed`, host succeeds; host leaving passes host to the earliest `since`; every accepted change bumps `revision` by exactly 1 and refusals return the identical state.
- [ ] **Step 2:** `hand.test.ts` with a seeded `random`: `deal` refused with an empty seat or with four bots (`not-ready`); hands 1–5 give dealers N, E, S, W, N and vulnerability None, NS, EW, Both, NS; a human bid out of turn → `not-your-turn`; an insufficient bid → `illegal`; the same `act` sent twice → second is `stale` and the auction has one call; human declarer plays dummy's card, human dummy's attempt → `not-your-turn`; bot declarer with human dummy → `botToAct` is dummy's seat on dummy's turn; a table of one human and three bots driven by `chooseBotAction` + `bot` events (human seat also driven by a bot through `act`) reaches `complete` and `totals` equals the hand's score on the right side; four passes → `passed-out`, totals unchanged, `canDeal` true, next `deal` gives hand 2 with dealer east; seat changes during a hand → `hand-in-progress`; `nextWake` is `turnSince + 1000`, and `+ 3000` right after a completed trick.
- [ ] **Step 3:** `view.test.ts`: privacy property — for seeds 1–30, play a full hand with bots in all decisions; after every accepted action, for each seat's player and for `undefined`, collect every card anywhere in `JSON.stringify(viewFor(...))` and expect it to be a subset of: own original hand, cards already played, dummy's hand once the opening lead is made; the unseated view has no `game` key and contains no card at all; after the hand, each seated view has `revealed` equal to the original deal and the unseated view still has none.
- [ ] **Step 4:** Run; expect failures. Implement the modules. Run again; expect PASS.
- [ ] **Step 5:** Run `pnpm test && pnpm typecheck && pnpm lint`; commit `feat(table): add seat, hand, and view logic for online tables`.

### Task 4: Presence, stand-ins, and the Durable Objects

**Files:**
- Create: `packages/table/src/presence.ts`, `packages/table/src/presence.test.ts`, `apps/server/src/table-object.ts`, `apps/server/src/lobby-object.ts`, `apps/server/src/server.test.ts`
- Modify: `packages/table/src/reduce.ts`, `packages/table/src/index.ts`, `apps/server/src/index.ts`, `apps/server/wrangler.jsonc` (bindings `TABLES` → `TableObject`, `LOBBY` → `LobbyObject`; one migration adding both as SQLite classes), `apps/server/package.json` (deps protocol, table)

**Interfaces:**
- Consumes: Task 3 exports.
- Produces (HTTP, all under the same origin as the app):
  - `GET /api/tables` → `200 TableSummary[]` (listed tables only).
  - `POST /api/tables` body `{ name, style, listed }` → `201 { id }`; `400` on a bad name or style; `429 { error: "too-many-tables" }` when 100 listed tables exist. `id` is 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`.
  - `GET /api/tables/:id/ws` (WebSocket upgrade). First client message must be `hello`; wrong `version` → `{type:"reload"}` then close; unknown table → `{type:"gone"}` then close. After `hello` the server sends a `view` and then a `view` to every connection after each accepted change; a refusal sends `refused` to the sender only.
- Player id = lowercase hex SHA-256 of `secret`.

Presence rules (`packages/table`):
- `connect`: increments the player's connection count, clears `awaySince`, updates the seat's `name` if seated, sets `lastHumanAt`. `disconnect`: decrements; at zero, a seated player gets `awaySince = at`.
- `handToBot { seat }`: target must be a human seat without a stand-in; allowed for any other seated human when the target is away, or for the host when the target has been on turn for `IDLE_MS` (`at - turnSince >= IDLE_MS` and the target controls the seat to act); otherwise `not-allowed`. Sets `standIn: "intermediate"`.
- `resume`: sender removes their own stand-in. `connect` by a player with a stand-in also removes it. A stand-in is removed when its seat is freed.
- `tick`: if the host has been away `HOST_AWAY_MS`, host passes to the earliest-seated present human; if no connections and `at - lastHumanAt >= EMPTY_TABLE_MS`, return `expired: true`. `nextWake` includes these deadlines.

Shell rules (`apps/server`):
- `TableObject` loads state from storage on first use, runs every event through `reduce`, stores the new state before sending anything, uses hibernatable WebSockets with the player id and name in the socket attachment, and sets its alarm to `nextWake(state)` after each event. In `alarm()`: if `botToAct(state)` is due, `await chooseBotAction` and feed a `bot` event; then a `tick`. On `expired`, delete storage and tell the lobby. After each change it sends `summaryOf(state)` to `LobbyObject`.
- `LobbyObject` stores `id → TableSummary & { listed }`, answers the list, and enforces the cap.
- Messages failing `parseClientMessage` → `refused` with `bad-message`; binary frames and frames over the size limit close the socket.

- [ ] **Step 1:** `presence.test.ts`: two `connect`s then one `disconnect` leaves the seat not away (Review Focus); the second `disconnect` marks it away; `handToBot` by another seated human on an away seat sets the stand-in and `botToAct` then returns that seat on its turn; `handToBot` on a present player by a non-host → `not-allowed`; by the host before 120 000 ms on turn → `not-allowed`, at 120 000 ms → accepted; stand-in for a human declarer also plays dummy (bot dummy and human dummy cases, Review Focus); reconnect removes the stand-in and the player's next `act` is accepted; away seat freed between hands by any seated human; host away 600 000 ms + `tick` moves host; no connections for 24 h + `tick` → `expired`.
- [ ] **Step 2:** `server.test.ts` (Workers pool, real WebSockets through `SELF.fetch` upgrade): create a table → appears in `GET /api/tables`; unlisted table does not; player A sits south, sets three bots, deals → A's view has 13 cards in `hands.south` and none elsewhere; a second connection B (unseated) receives views with no `game`; A plays a full hand by answering each view where `yourSeat` controls the actor with a bot-chosen legal action (use `createBot` in the test on A's visible cards) until `revealed` appears and `totals` are non-zero or the hand passed out; A closes mid-hand and reconnects with the same secret → the next view has the same `handNumber`, a revision ≥ the last seen, and A's cards; resending the last accepted `act` → `refused` with `stale` and the game unchanged (Review Focus); `hello` with `version: 99` → `reload`; `/api/tables/NOSUCH/ws` → `gone`; a 5000-byte frame closes the socket; restart recovery — evict or re-fetch the object (per current `vitest-pool-workers` docs) mid-hand and the view after reconnect matches the last one.
- [ ] **Step 3:** Run; expect failures. Implement. Run again; expect PASS.
- [ ] **Step 4:** Run `pnpm test && pnpm typecheck && pnpm lint`; commit `feat(server): run online tables in Durable Objects with a lobby`.

### Task 5: Client connection, identity, and routing

**Files:**
- Create: `apps/client/src/online/identity.ts`, `connection.ts`, `route.ts`, and `identity.test.ts`, `connection.test.ts`, `route.test.ts`
- Modify: `apps/client/package.json` (dep `@contractplay/protocol`), `apps/client/src/vite-env.d.ts` (`VITE_ONLINE_URL?: string`)

**Interfaces — Produces:**

```ts
// identity.ts — storage key "contractplay.online"
export type Identity = { secret: string; name: string };
export function loadIdentity(storage: StorageLike): Identity | undefined;
export function saveIdentity(storage: StorageLike, name: string): Identity;   // keeps an existing secret; new secret = 32 random bytes, base64url

// route.ts
export type Route = { screen: "solo" } | { screen: "lobby" } | { screen: "table"; id: string };
export function parseRoute(hash: string): Route;          // "" | "#/" → solo; "#/online" → lobby; "#/table/ABC234" → table (id upper-cased)
export function routeHash(route: Route): string;

// connection.ts
export function serviceUrl(): string | undefined;         // VITE_ONLINE_URL, else location.origin when protocol is http(s); undefined otherwise (desktop/iOS build without the setting)
export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "reload" | "gone";
export type TableConnection = { send(message: Exclude<ClientMessage, { type: "hello" }>): void; close(): void };
export function connectTable(input: {
  baseUrl: string; tableId: string; identity: Identity;
  onView(view: TableView): void; onRefused(reason: RefusalReason): void; onStatus(status: ConnectionStatus): void;
  createSocket?: (url: string) => WebSocket;             // for tests
}): TableConnection;
export function listTables(baseUrl: string): Promise<TableSummary[]>;
export function createTable(baseUrl: string, input: { name: string; style: TableStyle; listed: boolean }): Promise<{ id: string } | { error: string }>;
```

`connectTable` sends `hello` on open, reconnects after an unexpected close with delays of 1, 2, 4, 8 s then every 8 s, stops permanently on `reload` or `gone`, and drops (does not queue) `send` calls made while not open.

- [ ] **Step 1:** Tests: `saveIdentity` twice keeps the same secret and updates the name; the secret matches `/^[A-Za-z0-9_-]{43}$/`; corrupt stored JSON → `undefined`; `parseRoute` for the four hashes above and `"#/table/abc234"` → id `ABC234`, unknown hash → solo; with a fake socket and fake timers: `hello` is the first frame; a `view` frame calls `onView`; a `refused` frame calls `onRefused` then `onView`; close → status `reconnecting` and a new socket after 1000 ms; `gone` → status `gone` and no reconnect (Review Focus); `send` while reconnecting sends nothing.
- [ ] **Step 2:** Run; fail. Implement. Run; pass.
- [ ] **Step 3:** Run all checks; commit `feat(client): add online identity, routing, and table connection`.

### Task 6: Extract the table component from `App.tsx`

Pure refactor; no behaviour or markup change.

**Files:**
- Create: `apps/client/src/table/TableView.tsx`, `apps/client/src/table/labels.ts`
- Modify: `apps/client/src/App.tsx`
- Test: existing `apps/client/src/App.test.tsx` must pass unchanged

**Interfaces — Produces:**

```ts
// labels.ts: callLabel, compactCallLabel, cardLabel, cardFace, callChipClass, sortHand, isCallAvailable(game: PublicGame, bid), seatNames, suitSymbols, isRedSuit, samePartnership — moved verbatim from App.tsx
export type TableViewProps = {
  game: PublicGame;                      // hidden hands are empty arrays
  bottomSeat: Seat;
  /** Seats whose cards the viewer may play now (own seat and/or dummy); empty when not their turn. */
  actingSeat?: Seat;
  displayedTrick: readonly TrickCard[];
  showCalls: boolean; onToggleCalls(): void;
  statusText: string; ariaLabel: string;
  seatLabel?(seat: Seat): React.ReactNode;       // extra per-seat content (online: player name, away, bot badge, seat controls)
  onBid?(bid: Bid): void; onPlay?(seat: Seat, card: Card): void;
  hintedBid?: Bid; hintedCards?: ReadonlySet<string>;
  explainCall?: { shown?: number; onToggle(index: number): void; text(index: number): string };
  tools?: React.ReactNode;               // menu + fullscreen (top-right)
  overlay?: React.ReactNode;             // score panel, review/history controls, hint controls, messages
};
export function TableView(props: TableViewProps): React.JSX.Element;
```

`TableView` renders everything inside `.table-panel` (table surface, status, seats with calls and dummy, trick area, bid picker, last-trick button, hand zone). `App.tsx` keeps solo state, bots, hints, review, persistence, menus, and the start screen, and passes them in. Class names, roles, and aria labels stay exactly as they are.

- [ ] **Step 1:** Run `pnpm test`; note the passing count as the baseline.
- [ ] **Step 2:** Move the helpers to `labels.ts`, then the table markup to `TableView.tsx`; pass solo-only pieces through `tools` and `overlay`.
- [ ] **Step 3:** Run `pnpm test`; the same tests pass with no edits to `App.test.tsx`. Run typecheck and lint.
- [ ] **Step 4:** `pnpm web:dev`, play one solo hand in the browser (auction, dummy play, last trick, score panel, review); confirm it looks and behaves as before.
- [ ] **Step 5:** Commit `refactor(client): extract the table view from App`.

### Task 7: Lobby screen

**Files:**
- Create: `apps/client/src/online/Lobby.tsx`, `Lobby.test.tsx`, `apps/client/src/Root.tsx`
- Modify: `apps/client/src/main.tsx` (render `Root`), `apps/client/src/App.tsx` (a "Play online" button on the start screen and in the table menu that sets `location.hash = "#/online"`; hidden when `serviceUrl()` is undefined), `apps/client/src/styles.css`

**Interfaces:**
- Consumes: Task 5 exports.
- Produces: `Root` chooses `App`, `Lobby`, or `OnlineTable` (Task 8; a placeholder heading until then) from `parseRoute(location.hash)` and listens to `hashchange`. `Lobby` props: `{ baseUrl: string; storage: StorageLike; onOpenTable(id: string): void; onSolo(): void; api?: { listTables; createTable } }`.

Behaviour: with no saved identity, show only a "Your name" field (max 20) and Continue. Then: the table list (name, style, four seats shown as a player name, "Bot", or "Open", and "Playing" when a hand is in progress), refreshed every 5 s and on demand; a "New table" form (name max 40, default `"<name>'s table"`; style SAYC or 2/1; "Show in lobby" checkbox, on by default); "Change name"; "Solo play". Creating a table opens it. Errors (`too-many-tables`, network failure) appear in a `role="alert"` line; an empty list reads "No open tables yet. Create one to start."

- [ ] **Step 1:** Tests with a fake `api` and memory storage: name gate appears first and Continue stores the identity; list renders two summaries with seat labels; empty-list copy; creating a table calls `createTable` with the form values and then `onOpenTable(id)`; a `too-many-tables` error is shown in the alert; a rejected `listTables` shows "Can't reach the tables right now." and keeps the page usable; `App` shows "Play online" when a service URL exists.
- [ ] **Step 2:** Run; fail. Implement, following the existing start-screen styling (dark panels, `primary-button` / `secondary-button`). Run; pass.
- [ ] **Step 3:** Run all checks; commit `feat(client): add the online lobby`.

### Task 8: Online table screen

**Files:**
- Create: `apps/client/src/online/OnlineTable.tsx`, `OnlineTable.test.tsx`, `apps/client/src/online/savedHand.ts`, `savedHand.test.ts`
- Modify: `apps/client/src/Root.tsx`, `apps/client/src/styles.css`

**Interfaces:**
- Consumes: `connectTable`, `TableView`, `loadIdentity`, persistence `loadSoloData` / `saveSoloData`, `handNames`.
- Produces: `OnlineTable` props `{ baseUrl; tableId; storage; onLeave(): void; connect?: typeof connectTable }`; `savedHandFrom(view: TableView, id: string, savedAt: string): SavedHand | undefined` — rebuilds a full `GameState` with `createGameState({ deal: view.revealed, dealer, vulnerability })` and replays the auction then every played card in trick order through `applyAction`; `undefined` if `revealed` is missing or any replay step fails.

Behaviour:
- No identity → send the user to the lobby name gate, then back to this table.
- Before a hand, and between hands: a seating panel showing four seats around the table. Each seat shows its occupant and, as allowed by the view, buttons: "Sit here" (empty, viewer unseated), "Add bot" with a skill select (empty, viewer seated), "Remove bot" and a skill select (bot), "Leave seat" (own), "Free seat" (away human; or any human when the viewer is host). A "Deal" button is enabled when `canDeal`. "Copy table link" copies `<origin><path>#/table/<id>`. Running totals NS / EW are always shown.
- During a hand, seated: `TableView` with `bottomSeat = yourSeat`; `actingSeat` indicates whether this viewer controls the turn, while fixed-seat card input targets `game.currentActor` so a human controlling a bot partner can play both declaring-side hands on their respective turns. Dummy's fixed hand is visibly marked `DUMMY`. `onBid` / `onPlay` send `act` with the view's `handNumber` and `revision` and disable input until the next view arrives. `seatLabel` shows each player's name, "Bot", "away", or "bot playing for <name>". The last completed trick is held on screen for 2 s before the next view's empty trick is drawn, as solo play does. No hints, take-back, or PBN import controls.
- "Hand to a bot" appears beside an away player's seat; for the host it also appears beside a present player who has been on turn for two minutes. A player with a stand-in sees "Take my seat back" (`resume`).
- During a hand, not seated: "A hand is in progress. You can take a seat when it ends." with the seats and totals.
- When a view first shows `revealed` for a `handNumber`, save `savedHandFrom(...)` once to the device's hand history (id `online-<tableId>-<handNumber>`, name from `handNames`), and show the score panel with all four hands' result and a "Deal" button when `canDeal`.
- Status line: "Reconnecting…" while the connection is down; `reload` → "ContractPlay was updated. Reload to keep playing." with a Reload button; `gone` → "This table no longer exists." with "Back to lobby" (Review Focus). Refusals other than `stale` show a short message (`seat-taken` → "That seat was just taken.", `not-your-turn` → "It isn't your turn.", others → "That isn't possible right now."); `stale` shows nothing (Review Focus).

- [ ] **Step 1:** `savedHand.test.ts`: play a seeded hand to completion in core, build the seated view with `viewFor`, and expect `savedHandFrom(view, …).game` to have the same `auction`, `completedTricks`, `contract`, and `score` as the original; a view without `revealed` → `undefined`.
- [ ] **Step 2:** `OnlineTable.test.tsx` with a fake `connect` that lets the test push views and records sent messages: unseated lobby-state view shows four "Sit here" buttons and clicking one sends `sit`; seated view shows "Add bot" and sends `setBot` with the chosen skill; `canDeal` enables Deal and sends `deal`; an auction view on the viewer's turn renders the bid picker and clicking 1♠ sends `act` with the view's revision, and the picker is disabled until the next view; a view where it is not the viewer's turn has no enabled bid buttons; declarer's view on dummy's turn lets a dummy card be clicked and sends `play` for dummy's seat; a view with `revealed` writes exactly one hand to storage even when the same view arrives twice; `gone` shows "This table no longer exists."; a `stale` refusal renders no alert, `seat-taken` renders its message; an unseated in-progress view shows the waiting text and no cards.
- [ ] **Step 3:** Run; fail. Implement. Run; pass.
- [ ] **Step 4:** Manual check: `pnpm build`, run `wrangler dev` in `apps/server`, open two browser profiles at `http://localhost:8787`; create an unlisted table in one, open its link in the other, sit as partners with two bots, play a full hand, refresh one window mid-hand, close one window and use "Hand to a bot", reopen it and take the seat back, deal a second hand, then sit as opponents. Confirm in the second window's network inspector that no frame contains the other player's cards during play.
- [ ] **Step 5:** Run all checks; commit `feat(client): add the online table`.

### Task 9: Deployment and documentation

**Files:**
- Create: `.github/workflows/deploy-cloudflare.yml`
- Modify: root `package.json` (`deploy` = `pnpm web:verify && pnpm --filter @contractplay/server exec wrangler deploy`), `scripts/verify-web-build.mjs` only if the build layout check needs the new routes, `docs/platform-delivery.md`, `README.md`, `TODO.md`, `TODO-archive.md`, `CHANGES.md`, `.gitignore` (`.wrangler/`, `.dev.vars`)

**Interfaces:**
- Produces: a workflow that on push to `main` (and manual dispatch) installs, runs `pnpm web:verify`, and runs `wrangler deploy` in `apps/server` with `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from repository secrets; it skips the deploy step with a notice when the token secret is absent, so the workflow is green before the owner adds it.

- [ ] **Step 1:** Add the workflow, the `deploy` script, and the ignore entries.
- [ ] **Step 2:** `docs/platform-delivery.md`: add "Online tables on Cloudflare" — create a free account, `wrangler login`, `pnpm deploy`, the resulting address, creating an API token with the Workers edit template, adding the two repository secrets, setting `VITE_ONLINE_URL` for desktop and iOS builds, the free-plan limits that apply, and how `bridge.romaniuk.us` would later be attached (the domain must use Cloudflare name servers; confirm against current Cloudflare documentation before writing this sentence).
- [ ] **Step 3:** `README.md`: add online play to Status and a short "Online tables" section (lobby, seats, bots, what is not there: accounts, chat, voice/video, hints, take-back). `CHANGES.md` `## Unreleased`: user-facing entries for online tables. `TODO.md`: tick and move to the archive the three online items this delivers (sessions/table lifecycle/server-authoritative actions with guest identity; private hands and recovery; lobby/table UI with reconnect, stale, and duplicate handling), leave voice/video and the `bridge.romaniuk.us` item open, add open items for sign-in, permissions, and invitations, and rewrite "Current focus".
- [ ] **Step 4:** Run `pnpm build && pnpm web:verify && pnpm test && pnpm typecheck && pnpm lint`; commit `feat: deploy online tables to Cloudflare`.
- [ ] **Step 5 (owner):** Ask the owner to create the Cloudflare account and run `wrangler login`; then run `pnpm deploy` and report the address. Repeat the two-window manual check from Task 8 against the deployed address.

### Task 10: Remove GitHub Pages deployments

**Decision:** Cloudflare is the only maintained web deployment. Keep the existing Pages copy as-is, without updating or redirecting it.

**Files:**
- Delete: `.github/workflows/deploy-web.yml`
- Modify: `README.md`, `docs/platform-delivery.md`, `TODO.md`, `CHANGES.md`

- [x] **Step 1:** Owner confirmed GitHub Pages should not receive future deployments.
- [x] **Step 2:** Remove the Pages workflow; retain the existing published copy without maintaining it.
- [x] **Step 3:** Update project and delivery docs to describe Cloudflare as the sole maintained web deployment and remove the planned redirect.
