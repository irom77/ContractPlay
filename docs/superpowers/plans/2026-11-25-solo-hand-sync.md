# Sync solo hands to the account — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Signed-in players' finished, dealt-or-replayed solo hands are saved to their account and come back in Recent hands on any device.

**Architecture:** One shared rule in `@contractplay/persistence` says which solo hands may sync. The server's existing `/api/account/online-hands` routes and `online_hands` table accept those hands next to online ones, with separate 25-hand caps split on the `online-` id prefix. The client's existing sync (on sign-in, when Recent hands opens, after an online table loads) also imports and merges solo hands, and solo play uploads a hand when it finishes.

**Tech Stack:** TypeScript, React 19 + Vite client, Cloudflare Worker + D1 server, Vitest (server tests run in `@cloudflare/vitest-pool-workers`).

**Spec:** `docs/superpowers/specs/2026-11-25-solo-hand-sync-design.md`

## Global Constraints

- Only dealt or replayed solo hands sync: no `pbnMetadata`, and either no `record` or a `record` with `replay` (the same rule as the deal-archive post in `App.tsx`). Imported PBN, board-set and "Play this deal again" hands never leave the browser.
- The account keeps the newest 25 solo hands and, separately, the newest 25 online hands.
- Uploads stay unverified personal records: never touch the deal archive or duplicate standings.
- Unfinished play, settings and the board-set library stay on the device. **Delete** stays browser-only. Guests (not signed in) never sync.
- Network or server failure must leave local history unchanged.
- Do not stage `TODO.md` (it holds the user's own uncommitted edit).
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A legacy local solo hand whose id doesn't match the solo id shape must be skipped by the client, not sent; otherwise the server rejects the whole import batch forever and no solo hand ever syncs. (Task 1 + Task 3 test.)
2. A solo hand carrying a board-set `record` without `replay`, or any `pbnMetadata`, must be refused by the server even if a client sends it. (Task 2 test.)
3. 25 solo uploads must not prune any online hand, and the reverse. (Task 2 test.)
4. The App's own save effect must not overwrite storage with stale state after the finish-time upload merges owner marks and remote hands. (Task 4 test.)
5. A second account signing in on the same browser must not upload solo hands already owned by the first. (Task 3 test.)

---

### Task 1: Shared solo sync rule

**Files:**
- Modify: `packages/persistence/src/index.ts`
- Test: `packages/persistence/src/local-solo-store.test.ts`

**Interfaces:**
- Produces: `export function isSoloHandId(id: string): boolean` — true for `/^[a-z0-9]{1,16}-[a-z0-9]{1,16}$/` (the shape `createHandId()` in `App.tsx` makes) and false for anything starting with `online-`.
- Produces: `export function isSyncableSoloHand(hand: SavedHand): boolean` — `isSoloHandId(hand.id) && hand.pbnMetadata === undefined && (hand.record === undefined || hand.record.replay !== undefined)`.
- Update the `onlineHistory` doc comment: it is the local account partition for synced online **and** solo hands.

- [ ] **Step 1: Write the failing tests** (`describe("solo hand sync rule")`)
  - `isSoloHandId("mf3k2x-ab12cd")` true; `"online-ABC234-1"`, `"online-abc"`, `"Solo 1"`, `"a-"`, `""` false.
  - `isSyncableSoloHand`: a completed hand with that id → true; same with `pbnMetadata: { tags: [] }` → false; with a `record` without `replay` → false; with a `record` whose `replay` is `{ dealId: "d1", firstPlayedAt: 1, rescored: false, original: { multiplicity: 1, artificial: false } }` → true; id `"online-ABC234-1"` → false.
- [ ] **Step 2:** `pnpm vitest run packages/persistence` — Expected: FAIL, functions not exported.
- [ ] **Step 3:** Implement both functions next to `isSavedHand`.
- [ ] **Step 4:** `pnpm vitest run packages/persistence` — Expected: PASS. `pnpm --filter @contractplay/persistence build` — Expected: no errors.
- [ ] **Step 5: Commit** — `git commit -m "Add the rule for which solo hands may sync"`

### Task 2: Server accepts solo hands with separate caps

**Files:**
- Modify: `apps/server/src/hand-history.ts`, `apps/server/src/auth-store.ts:131-145`
- Test: `apps/server/src/hand-history.test.ts`

**Interfaces:**
- Consumes: `isSoloHandId`, `isSyncableSoloHand`, `isHandRecord` from `@contractplay/persistence`.
- Produces: `GET` returns up to 50 hands (≤25 with `online-` ids, ≤25 solo), newest `completed_at` first, ties by `hand_id DESC`. `PUT /<id>` accepts an online id or a solo id. `POST /import` keeps its 25-per-request limit.

- [ ] **Step 1: Write the failing tests** (add a `soloHand(id = "mf3k2x-ab12cd", at = 1)` helper = `hand(id, at)`)
  - `"archives a dealt solo hand without online provenance"`: `PUT /mf3k2x-ab12cd` with `soloHand()` → 200; listed hand has the same `id`, `name`, `game`, `savedAt`, and **no** `onlineHistory` field.
  - `"keeps a replayed solo hand's record and refuses imported ones"`: with the replay record from Task 1 plus a valid `deal`/`dealer`/`vulnerability`/`field: []` → 200 and `record.replay.dealId === "d1"` listed. Each of these → 400: `pbnMetadata: { tags: [{ name: "Event", value: "Club" }] }`; `record` without `replay`; id `"Solo 1"`; `PUT /mf3k2x-ab12cd` whose body hand id is `"mf3k2x-zzzzzz"`.
  - `"keeps separate 25-hand caps for solo and online hands"`: PUT 27 online hands at times 0..26 and 27 solo hands with ids `"t${i}-abc"` at times 100..126 → list has 50; online ids are `online-ABC234-26`…`-2`; solo ids `t26-abc`…`t2-abc`; then 1 more online hand at 200 still leaves 25 solo hands.
- [ ] **Step 2:** `pnpm --filter @contractplay/server test -- hand-history` — Expected: the three new tests FAIL (400 on solo PUT), existing tests PASS.
- [ ] **Step 3: Implement.**
  - `archive(value)`: classify by `value.id.startsWith("online-")`. Online path unchanged. Solo path: require `isSyncableSoloHand`, size/`savedAt`/`name` checks as today, `record` (if present) must pass `isHandRecord`; return picked fields `id, game, savedAt, name?, playerSeat?, record?` with no `onlineHistory`.
  - `updating` accepts `/^\/online-[A-Za-z0-9_-]{1,100}$/` or a path whose rest passes `isSoloHandId`.
  - `AuthStore.upsertHands` prunes each kind to its own 25 newest (two `DELETE`s, `hand_id LIKE 'online-%'` and `NOT LIKE`). `listHands` returns the newest 25 of each kind merged in the existing order.
  - Update the `archive` doc comment.
- [ ] **Step 4:** `pnpm --filter @contractplay/server test` — Expected: all PASS.
- [ ] **Step 5: Commit** — `git commit -m "Let the account hand archive keep solo hands"`

### Task 3: Client sync imports and merges solo hands

**Files:**
- Modify: `apps/client/src/online/handHistory.ts`
- Test: `apps/client/src/online/handHistory.test.ts`

**Interfaces:**
- Consumes: `isSyncableSoloHand` from `@contractplay/persistence`; Task 2's GET shape.
- Produces: `export function uploadSoloHand(storage: StorageLike, account: AccountSession, hand: SavedHand): Promise<void>` — PUTs to `/api/account/online-hands/<id>` (no-op unless `isSyncableSoloHand(hand)`), then merges, like `uploadOnlineHand`. `syncOnlineHands` keeps its name and signature.
- Account hands = `isOnline(hand) || isSyncableSoloHand(hand)`. `merge` treats all account hands like it treats online ones today (local ones belonging to the account plus remote, all marked with `ownerPlayerId`); non-syncable solo hands are left untouched and unmarked.
- `request()` accepts at most 25 online and 25 syncable solo hands, rejecting anything else as today.
- `syncOnlineHands` sends missing online hands and missing solo hands (each newest 25 belonging to the account) as **separate** `POST /import` calls, skipping empty ones; it merges the last response (or the GET).

- [ ] **Step 1: Write / update the failing tests**
  - Rename and change the first test to `"imports guest online hands and dealt solo hands on account link and keeps settings local"`: storage has a solo `"mf3k2x-ab12cd"`, an imported solo `{ ...hand("mf3k2x-pbn001"), pbnMetadata: { tags: [] } }`, a legacy `"solo-1"`, and `"online-ABC234-1"`. Expect two POSTs, bodies `["online-ABC234-1"]` and `["mf3k2x-ab12cd"]`; the PBN hand and `"solo-1"` are never sent; afterwards all four are still in local storage and `settings` is `"keep me"`.
  - `"merges remote solo hands from another device"`: GET returns `hand("mf3k2x-remote", 5)`; after sync it is local with `onlineHistory.ownerPlayerId === account.playerId`.
  - `"does not upload solo hands owned by another account"`: sync once as `account` (solo hand gets owned), then sync as `{ playerId: "other-account", … }` → no POST carries `"mf3k2x-ab12cd"`.
  - `"uploads a finished solo hand and skips imported ones"`: `uploadSoloHand` with `"mf3k2x-ab12cd"` → one PUT to `/api/account/online-hands/mf3k2x-ab12cd`; with a `pbnMetadata` hand → no fetch at all; on a 503 it rejects and local data is unchanged.
  - Update `"imports at most the newest 25 online hands while preserving solo data"` so its solo hand id is non-syncable (e.g. `"solo-1"`) or adjust its POST expectations accordingly.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/online/handHistory.test.ts` — Expected: new/changed tests FAIL.
- [ ] **Step 3:** Implement as in Interfaces; update the `syncOnlineHands` doc comment ("Solo data never leaves the device" becomes the dealt-solo rule).
- [ ] **Step 4:** `pnpm vitest run apps/client/src/online` — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "Sync dealt solo hands with the account history"`

### Task 4: Upload a solo hand when it finishes; docs

**Files:**
- Modify: `apps/client/src/App.tsx` (near the `useSoloResultPost` call, ~line 283), `README.md` (lines ~56 and ~91), `CHANGES.md`
- Test: `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `uploadSoloHand` (Task 3), `isSyncableSoloHand` (Task 1), the existing `currentAccount` and `serviceUrl()` used by the Recent hands sync effect.
- Behaviour: when the current hand becomes `complete`, not `frozen`, `serviceUrl() !== undefined`, and the saved record is syncable, App calls `currentAccount()`; if signed in, `uploadSoloHand(storage, account, savedHand)` and on success `setSoloData(loadSoloData(storage))`. At most once per hand id (ref-guarded). Failures are silent (the next sync retries).
- Preserve `existing?.onlineHistory` when the save effect rebuilds a completed hand's record, so owner marks survive re-saves.

- [ ] **Step 1: Write the failing tests** (`describe("Solo hand account sync")`, mocking `currentAccount`/`fetch` the way the existing Recent hands sync tests in `App.test.tsx` do)
  - `"uploads a hand finished against bots for a signed-in player"`: store `gameAfterPlays(51)` as in `"names a hand finished against bots…"`, bots on; await a PUT to `/api/account/online-hands/<the hand id>`; afterwards the stored hand has `onlineHistory.ownerPlayerId` of the account.
  - `"keeps finished solo hands local for guests"`: `currentAccount` resolves `null` → no PUT, hand saved locally.
  - `"does not upload a hand played from an imported file"`: stored game with `currentPbnMetadata` → no PUT.
- [ ] **Step 2:** `pnpm vitest run apps/client/src/App.test.tsx -t "Solo hand account sync"` — Expected: FAIL.
- [ ] **Step 3:** Implement the effect.
- [ ] **Step 4:** `pnpm vitest run apps/client/src/App.test.tsx` — Expected: PASS.
- [ ] **Step 5: Docs.** README: "Signed-in players also sync a personal archive of their newest 25 online hands and newest 25 dealt or replayed solo hands across devices…"; "Solo hands from imported files and board sets, unfinished solo play, settings, and imported board sets stay on the device." Line ~56: "account-owned hand history". `CHANGES.md`: a user-visible entry under the current version.
- [ ] **Step 6: Full check** — `pnpm test`, `pnpm typecheck`, `pnpm lint` — Expected: all pass.
- [ ] **Step 7: Commit** — `git commit -m "Save finished solo hands to the signed-in account"` (README, CHANGES, App files only).
