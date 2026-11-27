# BEN Bot Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let solo players choose BEN (the open-source neural-network bridge engine, `lorserker/ben`) as the engine for their custom bots, with the built-in rule bot taking over whenever BEN is slow, unreachable, or answers something illegal.

**Architecture:** BEN runs as a separate, unmodified HTTP service on its own host; ContractPlay never bundles it. The Worker proxies `/api/bots/ben/*` to that host, so the BEN address and key stay secret and use is limited to signed-in accounts. `packages/bots` gains a platform-neutral `createBenBot(config, transport)` that implements the existing `BotPlayer` interface. It encodes the seat's own view into BEN's query format, validates the answer with the shared core rules, and falls back to `createBot(config)`. The solo client supplies a `fetch` transport.

**Tech Stack:** TypeScript, Vitest, Cloudflare Workers (`@cloudflare/vitest-plugin`), React client, BEN `gameapi.py` (Python/Flask, GPL-3.0).

**Spec:** None. The design decisions are recorded under "Design decisions" below. They come from the 2026-11-27 discussion of external engines: WBridge5 is closed-source and Windows-only, GIB is proprietary to BBO, and BEN is the one engine we can use.

## Design decisions

- **BEN only, as a network service.** BEN is GPL-3.0, not AGPL. Calling an unmodified BEN over HTTP does not put ContractPlay under the GPL. Do not vendor, bundle, or patch BEN in this repository.
- **The BEN HTTP contract this plan targets** (from `src/gameapi.py` on `main`, read 2026-11-27). Pin the BEN commit you deploy in `docs/ben-bot-service.md`.
  - Requests are `GET /bid`, `GET /lead` and `GET /play` on the default port 8085.
  - Required parameters are `hand`, `seat` and `dealer`. `/play` also requires `dummy`.
  - Optional parameters used here: `vul`, `ctx`, `played`.
  - `hand` and `dummy` are written `S.H.D.C` with ranks `AKQJT98765432`, uppercase, for example `AKQ.T98.765.432`.
  - `seat` and `dealer` are `N`/`E`/`S`/`W`, uppercase only.
  - `vul` is `-`, `NS`, `EW` or `Both`.
  - `ctx` is the auction from the dealer, dash-separated: `P-1S-Db-Rd-1N` (`P` pass, `Db` double, `Rd` redouble, `N` notrump).
  - `played` is every card played so far in play order, suit then rank, concatenated: `DQD2D4`.
  - When declarer plays from either hand, send `seat` = declarer, `hand` = declarer's hand and `dummy` = dummy's hand. BEN refuses `seat` = dummy.
  - The opening lead uses `/lead`, which needs a `ctx` that ends in a contract.
  - Responses are JSON:
    - `{ "bid": "1S" | "PASS" | "X" | "XX", ... }` for a bid,
    - `{ "card": "S3", ... }` for a lead or play,
    - `{ "message": "..." }` when the board or auction is over,
    - `{ "error": "..." }` with status 400 or 429.
  - BEN drops requests whose `Host` is not in `--allowed-hosts` (HTTP 444).
- **Scope:** solo play only, and only seats played by the custom bot (the setup's own skill), including auto play for the user's seat. Cast characters keep their rule bots and personalities. Bid explanations and Hints keep using the rule system. BEN plays its own system, so its calls may not match the explanations; the setting's label says so. Online tables and benchmark profiles are follow-ups (see TODO).
- **Bots see only their own view.** Each request carries only the acting seat's hand, plus dummy once it is visible, plus public information. The core already enforces this through `playContextFor`.
- **Cost control:** the proxy requires a signed-in account, allows 600 BEN requests per account per hour, and answers 503 when `BEN_API_URL` is unset. That is the default in development and tests.

## Global Constraints

- `packages/core` and `packages/bots` stay platform-neutral: no `fetch`, `window`, or Worker APIs. The transport is injected.
- Game state stays immutable. Every BEN answer is validated with core rules before it becomes an action, and an invalid answer never reaches `applyAction`.
- A bot turn must never stall. BEN timeout `BEN_TIMEOUT_MS = 8000` in the bot and `AbortSignal.timeout(8000)` in the proxy, then fall back.
- Worker secrets: `BEN_API_URL` (base URL, no trailing slash) and `BEN_API_KEY`, sent upstream as header `X-ContractPlay-Key`. Never put them in Wrangler `vars`.
- Run checks with workspace commands: `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Review Focus

1. **BEN slow, down, or rate-limited in the middle of a hand.** The built-in bot plays that turn with no stall and no error shown at the table. Tests: Task 3 "falls back on timeout" and "falls back on transport error", and Task 4 "maps upstream failure to 502".
2. **Declarer playing a card from dummy.** The request must swap to seat = declarer, hand = declarer's cards, dummy = dummy's cards, and the returned card must be one of dummy's. Tests: Task 2 "encodes dummy's turn as declarer" and Task 3 "accepts a dummy card on dummy's turn".
3. **BEN answers a revoke, a card not held, or a call that is now insufficient.** The bot falls back, and the illegal action is never recorded. Tests: Task 3 "rejects a revoke", "rejects an insufficient bid".
4. **A stored `botEngine: "ben"` after the service is gone or the player signed out.** The setup still loads, every move falls back, and the option is hidden. Tests: Task 5 "keeps ben in storage" and "hides the engine select when unavailable".
5. **Opening lead and the first card after it.** `/lead` before dummy is visible, `/play` after. `played` includes the current trick's cards. Test: Task 2 "uses /lead before dummy is shown".

---

### Task 1: Board context for bots in core

**Files:**
- Modify: `packages/core/src/bots.ts` (`BotConfig`, `PlayContext`, `BotPlayer`)
- Modify: `packages/core/src/rules.ts` (add `isLegalCall`)
- Modify: `packages/core/src/game.ts:284` (`playContextFor`)
- Modify: `packages/bots/src/player.ts:23-32` (delete local `isLegalCall` and `contractRank` if unused elsewhere; import from core), `:3681` (`createBot` forwards `board`)
- Modify: `apps/client/src/App.tsx:409-412`, `packages/table/src/hand.ts:207-209` (pass `{ vulnerability }`)
- Test: `packages/core/src/rules.test.ts`, `packages/core/src/game.test.ts`

**Interfaces:**
- Produces:
  - `export type BotEngine = "rules" | "ben"`, and `BotConfig` gains `engine?: BotEngine`.
  - `export type BoardContext = Readonly<{ vulnerability: Vulnerability }>`.
  - `BotPlayer.chooseBid(hand: Hand, auction: readonly PublicBid[], seat: Seat, board?: BoardContext): Promise<Bid>`.
  - `PlayContext` gains `dealer?: Seat`, `vulnerability?: Vulnerability` and `auction?: readonly PublicBid[]`.
  - `export function isLegalCall(bid: Bid, auction: readonly PublicBid[], seat: Seat): boolean` in core `rules.ts`, exported from the core index. It is the same logic as `player.ts:23`.

- [ ] **Step 1: Write failing tests**
  - `rules.test.ts`, "isLegalCall":
    - `isLegalCall("1spades", [{seat:"north",bid:"1hearts"}], "east") === true`
    - `isLegalCall("1clubs", [{seat:"north",bid:"1hearts"}], "east") === false`
    - `isLegalCall("double", [{seat:"north",bid:"1hearts"}], "south") === false` (partner's contract)
    - `isLegalCall("redouble", [{seat:"north",bid:"1hearts"},{seat:"east",bid:"double"}], "south") === true`
  - `game.test.ts`, "playContextFor carries board context": after an auction from dealer `west`, vulnerability `"EW"`, `1spades pass pass pass`, `playContextFor(state)` has `dealer: "west"`, `vulnerability: "EW"` and `auction` deep-equal to `state.auction`.
- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests fail (`isLegalCall` is not exported, and the fields are undefined).
- [ ] **Step 3: Implement.** Move `isLegalCall` and `contractRank` into `rules.ts` and import them in `player.ts`. Add the type fields. Have `playContextFor` fill `dealer`, `vulnerability` and `auction`. Add the `board` parameter to the `createBot` wrapper; it ignores it. At both call sites pass `{ vulnerability: state.vulnerability }` (`turnState.vulnerability` in `App.tsx`).
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS, and the existing bot snapshot tests do not change.
- [ ] **Step 5: Commit**: `git add` the files above by name, then `git commit -m "Give bots the board's vulnerability, dealer and auction"`.

### Task 2: BEN wire encoding

**Files:**
- Create: `packages/bots/src/ben/encoding.ts`
- Test: `packages/bots/src/ben/encoding.test.ts`

**Interfaces:**
- Consumes: `BoardContext` and the `PlayContext` fields from Task 1.
- Produces:
  - `export type BenEndpoint = "bid" | "lead" | "play"`
  - `export type BenRequest = Readonly<{ endpoint: BenEndpoint; params: Readonly<Record<string, string>> }>`
  - `export function benHand(hand: Hand): string`
  - `export function benAuction(auction: readonly PublicBid[]): string`
  - `export function benCards(cards: readonly Card[]): string`
  - `export function benBidRequest(hand: Hand, auction: readonly PublicBid[], seat: Seat, board?: BoardContext): BenRequest`
  - `export function benPlayRequest(context: PlayContext): BenRequest`
  - `export function parseBenBid(value: unknown): Bid | undefined`
  - `export function parseBenCard(value: unknown): Card | undefined`

- [ ] **Step 1: Write failing tests**
  - `benHand` of a hand holding ♠AKQ ♥T98 ♦765 ♣432, in any input order, gives `"AKQ.T98.765.432"`. A void gives an empty segment: `"AKQJT98765432..."`.
  - `benAuction([pass, 1♠, double, redouble, 1NT])` gives `"P-1S-Db-Rd-1N"`, and `benAuction([])` gives `""`.
  - "encodes a bid request": hand above, auction `[{seat:"west",bid:"pass"}]`, seat `"north"`, board `{vulnerability:"None"}` gives `{ endpoint:"bid", params:{ hand:"AKQ.T98.765.432", seat:"N", dealer:"W", vul:"-", ctx:"P" } }`. With an empty auction the dealer is the seat itself. `"Both"` encodes as `vul:"Both"`, and an omitted board as `"-"`.
  - "uses /lead before dummy is shown": a context with no `visibleHand` and declarer `south` gives endpoint `"lead"`, and the params have no `dummy` or `played`.
  - "encodes a defender's play": `played` joins the completed-trick cards and then the current trick, for example `"DQD2D4D5H3"`, and `dummy` is `benHand(visibleHand)`.
  - "encodes dummy's turn as declarer": declarer `south`, acting seat `north` (dummy), `hand` = dummy's cards, `visibleHand` = declarer's cards. Params: `seat:"S"`, `hand: benHand(visibleHand)`, `dummy: benHand(hand)`.
  - `parseBenBid`: `"PASS"`, `"P"` and `"--"` give `pass`; `"X"` and `"Db"` give `double`; `"XX"` and `"Rd"` give `redouble`; `"3N"` gives `3notrump`; `"8S"`, `""` and `42` give `undefined`.
  - `parseBenCard`: `"S3"` gives ♠3, `"HT"` gives ♥T, and `"S1"` or `"Z3"` give `undefined`.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the functions in `encoding.ts`. Dealer is `context.dealer ?? auction[0]?.seat ?? seat`. Do not export the module from the package index yet; Task 3 does that.
- [ ] **Step 4: Run** `pnpm test`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Encode a seat's view for the BEN bridge engine"`.

### Task 3: BEN bot with rule-bot fallback

**Files:**
- Create: `packages/bots/src/ben/benBot.ts`
- Modify: `packages/bots/src/index.ts` (export `createBenBot`, `BenTransport`, `BenRequest`, `BEN_TIMEOUT_MS`)
- Test: `packages/bots/src/ben/benBot.test.ts`

**Interfaces:**
- Consumes: `benBidRequest`, `benPlayRequest`, `parseBenBid`, `parseBenCard` (Task 2); `isLegalCall` (Task 1); core `validatePlay`; `createBot`.
- Produces:
  - `export type BenTransport = (request: BenRequest) => Promise<unknown>`. It resolves to the parsed JSON body and rejects on failure.
  - `export const BEN_TIMEOUT_MS = 8000`
  - `export function createBenBot(config: BotConfig, transport: BenTransport, options?: Readonly<{ timeoutMs?: number }>): BotPlayer`. Its `config` is `{ ...config, engine: "ben" }`.

- [ ] **Step 1: Write failing tests.** Use a stub transport and compare against `createBot(config)` for the fallback cases.
  - "plays BEN's legal bid": the transport returns `{bid:"1S"}`, so the bid is `1spades`, and the transport saw endpoint `"bid"`.
  - "rejects an insufficient bid": after `1notrump` the transport returns `{bid:"1S"}`, so the result equals the rule bot's call.
  - "rejects a revoke": with ♥ led and ♥ held, the transport returns a ♠ the bot holds, so the result equals the rule bot's card.
  - "rejects a card not held", and "accepts a dummy card on dummy's turn" (the transport returns one of `context.hand`, which is dummy's).
  - "falls back on transport error": the transport rejects, and so does `{error:"x"}` and `{message:"Bidding is over"}`.
  - "falls back on timeout": the transport never resolves; use `vi.useFakeTimers()` and advance by `BEN_TIMEOUT_MS`; the result equals the rule bot's.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Race the transport against a timer (`options.timeoutMs ?? BEN_TIMEOUT_MS`) and clear the timer afterwards. Parse the reply. A bid is accepted only if `isLegalCall(bid, auction, seat)`. A card is accepted only if `context.hand` holds it and `validatePlay(context.hand, card, context.ledSuit)` allows it. Anything else, including any thrown error, returns the fallback bot's answer.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Add a BEN bot that falls back to the rule bot"`.

### Task 4: Worker proxy `/api/bots/ben`

**Files:**
- Create: `apps/server/src/ben-routes.ts`
- Modify: `apps/server/src/index.ts:121-126` (route `path === "/api/bots/ben" || path.startsWith("/api/bots/ben/")` to `benRoute`)
- Modify: `apps/server/src/env.d.ts` (add `BEN_API_URL?: string` and `BEN_API_KEY?: string`, both documented as Worker secrets)
- Test: `apps/server/src/ben-routes.test.ts`. Follow `bot-results.test.ts` for a signed-in request and `deal-routes.test.ts` for migrations. Stub upstream with `vi.spyOn(globalThis, "fetch")`.

**Interfaces:**
- Produces:
  - `export async function benRoute(request: Request, env: Env): Promise<Response>`
  - `GET /api/bots/ben` answers `200 {available: boolean}`; `available` is true when `BEN_API_URL` is set.
  - `GET /api/bots/ben/{bid|lead|play}?...` answers `200 {bid?: string, card?: string, message?: string}`. Errors:
    - `401 {error:"unauthenticated"}`
    - `404` for an unknown endpoint
    - `405` for a method other than GET
    - `429 {error:"too-many-requests"}`
    - `503 {error:"ben-unavailable"}`
    - `502 {error:"ben-failed"}`

- [ ] **Step 1: Write failing tests**
  - "reports availability" with and without `BEN_API_URL`.
  - "requires sign-in" (401).
  - "answers 503 without BEN_API_URL".
  - "forwards only allowed params": the upstream URL is `${BEN_API_URL}/play`; its query holds exactly the allowlist `hand, dummy, seat, dealer, vul, ctx, played`, and an extra `user=x` is dropped. The header `X-ContractPlay-Key` equals `BEN_API_KEY`.
  - "returns only bid/card/message": upstream `{card:"S3",who:"x",samples:[…]}` gives `{card:"S3"}`.
  - "maps upstream failure to 502": upstream 400, a thrown error, or a non-JSON body.
  - "rate-limits per account": the 601st request in an hour gets 429. Set the limit through an exported `BEN_REQUESTS_PER_HOUR = 600` and test with a lower test override, or loop.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/server test`. Expected: FAIL.
- [ ] **Step 3: Implement.** Use `authenticatedAccount` from `auth.ts`. For the rate limit, call `new AuthStore(env.DB).admitAuthAttempt(await hash(\`ben:${account.id}\`), Date.now(), HOUR, BEN_REQUESTS_PER_HOUR)`, like `deal-routes.ts:32`. Make the upstream call with `fetch(url, { headers: { "X-ContractPlay-Key": env.BEN_API_KEY ?? "" }, signal: AbortSignal.timeout(8000) })`.
- [ ] **Step 4: Run** `pnpm --filter @contractplay/server test`. Expected: PASS.
- [ ] **Step 5: Commit**: `git commit -m "Proxy BEN engine requests for signed-in players"`.

### Task 5: Solo "Bot engine" setting

**Files:**
- Create: `apps/client/src/benTransport.ts`
- Modify: `apps/client/src/soloSetup.ts` (`SoloSetup.botEngine: BotEngine`, default `"rules"`, read with `pick(stored.botEngine, ["rules","ben"], "rules")`)
- Modify: `apps/client/src/App.tsx`. Add the state and save effect (`:162`, `:193`). Add the engine select beside "Bot skill" in the custom-bot fields (`:913`). In the bot turn (`:408-412`), seats that `botSettingsAt` resolves to the custom bot (no cast character) use `createBenBot(config, benTransport())` when `botEngine === "ben"` and BEN is available.
- Modify: `apps/client/src/mocks/scenarios.ts` (new screen `solo-settings-ben` in the "Menus, claims & auto play" group) and `apps/client/src/mocks/Previews.test.tsx`
- Test: `apps/client/src/soloSetup.test.ts` (create if absent), `apps/client/src/benTransport.test.ts`, `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `createBenBot`, `BenTransport` (Task 3); the HTTP contract (Task 4).
- Produces:
  - `export function benTransport(baseUrl?: string, fetcher?: typeof fetch): BenTransport`. It GETs `${baseUrl}/api/bots/ben/${endpoint}?${new URLSearchParams(params)}` with `credentials: "include"` and throws on a non-OK response.
  - `export async function benAvailable(baseUrl?: string, fetcher?: typeof fetch): Promise<boolean>`. It returns false on any error.
- UI copy:
  - select label "Bot engine"
  - options "Built-in" and "BEN neural network (online, beta)"
  - helper text under the select when BEN is chosen: "BEN plays its own bidding system; call explanations and hints still follow the built-in system."

- [ ] **Step 1: Write failing tests**
  - `soloSetup`: "keeps ben in storage". Saving and then loading `botEngine:"ben"` round-trips, and a missing or garbage value loads as `"rules"`.
  - `benTransport`: it builds `/api/bots/ben/play?hand=…` and throws on a 503.
  - `App.test.tsx`:
    - "hides the engine select when unavailable" (`benAvailable` false, or no account).
    - "shows the engine select for a signed-in player when available".
    - With `botEngine:"ben"` and a transport that rejects, the bots still finish the auction (fallback).
  - `Previews.test.tsx`: the `solo-settings-ben` screen shows the "Bot engine" select with BEN selected and the helper text.
- [ ] **Step 2: Run** `pnpm test`. Expected: FAIL.
- [ ] **Step 3: Implement** the transport, the setup field, the availability check (run it once alongside `currentAccount()`; show the select only when both are truthy), the bot selection, and the preview screen.
- [ ] **Step 4: Run** `pnpm test && pnpm typecheck && pnpm lint`. Expected: PASS. Then check the new preview by eye with `pnpm web:dev` at `#/mocks`.
- [ ] **Step 5: Commit**: `git commit -m "Let solo players choose the BEN engine for custom bots"`.

### Task 6: Operations runbook and docs

**Files:**
- Create: `docs/ben-bot-service.md`
- Modify: `README.md` (the bots paragraph near line 85; the preview table entry for `solo-settings-ben`; credits next to the `bridge-dds` license line, ~188), `CHANGES.md`, `TODO.md`, `docs/platform-delivery.md` (secrets list)

- [ ] **Step 1: Write `docs/ben-bot-service.md`.** It covers:
  1. The pinned BEN commit and the GPL-3.0 note: it runs unmodified as a separate service and is not distributed with ContractPlay.
  2. Hosting: a small Linux VM or container with BEN's Docker image or `python gameapi.py --host 127.0.0.1 --port 8085 --allowed-hosts <public host>`, from `src/`.
  3. A TLS reverse proxy (for example Caddy) that rejects requests without the right `X-ContractPlay-Key`, with a health check.
  4. `wrangler secret put BEN_API_URL` and `wrangler secret put BEN_API_KEY`.
  5. How to verify: `curl` the proxy with a sample `/bid`, then play a solo hand with Bot engine = BEN while signed in.
  6. Removing BEN: delete `BEN_API_URL`, and the option disappears.
- [ ] **Step 2: Update** the README, `CHANGES.md` (user-visible: the "Bot engine" setting), `docs/platform-delivery.md`, and `TODO.md` (tick the plan's item; keep the online-table and benchmark follow-ups open).
- [ ] **Step 3: Run** `pnpm test`. Expected: PASS. README screenshots do not change, because the bidding and play mocks don't show the engine select.
- [ ] **Step 4: Commit**: `git commit -m "Document running the BEN engine service"`.

## Follow-ups (not in this plan)

- BEN at online tables: `packages/table/src/hand.ts` `chooseBotAction` runs in the Table Durable Object, which can call BEN directly with the secrets. The turn timer (`BOT_PAUSE_MS`) must allow BEN's latency.
- A BEN benchmark profile: `packages/benchmark` profiles are tied to `BOT_CHARACTERS` and need an `engine` field and a new `engineVersion` (for example `ben-<commit>`).
- Mapping BEN's `explanation` field into the call explanations.
