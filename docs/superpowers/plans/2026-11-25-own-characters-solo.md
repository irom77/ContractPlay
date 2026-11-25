# Own characters in solo (part 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Players create, edit and delete their own bot characters (name, description, skill, six dials), pick them as
partner or opponents in solo, get results with and against them, and keep them on their account.

**Architecture:** The character's shape and checks live in `@contractplay/persistence` (shared by client and service),
next to `BotResult`. The client keeps characters in local storage (`ownCharacters.ts`), resolves any cast id (named cast
or own) through one lookup, and passes the character's traits to `createBot`. An editor sits under the cast picks in
`BotCastFields`, which both the lobby's Play panel and solo Settings render. Sync copies the bot-results pattern: a D1
table, one route, latest `updatedAt` wins, deletions travel as tombstones.

**Tech Stack:** TypeScript, React, Vitest + Testing Library, Cloudflare Workers + D1.

**Spec:** `docs/superpowers/specs/2026-11-25-bot-traits-design.md` (Part 2). Part 1 shipped in `023e3f4`.

## Global Constraints

- Character: `{ id "own-<random>", name (cleanName, max 24), blurb up to 80 characters, skill, traits }`, all six dials set. At most 12 own characters per player (the editor's New is disabled at 12).
- Editing keeps the record; `playEditedAt` is set only when skill or a dial changes, and the record then says "edited since some of these hands" when any of its results is older.
- Deleting keeps the character's results under its last name, shown as "Name (deleted)".
- Hints unchanged. Online tables unchanged (part 3). Characters are never shared or shown to other players.
- Keep `#/mocks` previews, `Previews.test.tsx`, and the README preview table current. Update `TODO.md`, `CHANGES.md`, `README.md`, `docs/platform-delivery.md`.
- Production D1 migration only with the owner's explicit approval. Commit only when asked.

## Decisions taken in this plan (builder's calls, within the spec)

- **Deletion syncs as a tombstone** (`deleted: true` with a newer `updatedAt`) through `POST`, instead of a separate `DELETE` route: without it, a second device would upload the deleted character again. The route is `GET/POST /api/account/characters`.
- **Limits on the service:** at most 24 live characters and 100 rows (tombstones included) per account, so two devices that each made characters offline still sync; the 12 limit is the editor's.
- **Dial words** (each with a one-line meaning in the editor, from the spec's table): Openings Sound / By the book / Light; Competing Sells out / By the book / Pushes; Preempts Sound / By the book / Wild; Penalty doubles Rarely / By the book / Often; Leads Passive / By the book / Attacking; Second hand Low / By the book / High.
- **Results store names** in a new optional `BotResult.names` (own id → name at the time of the hand).

## Review Focus

1. A stored solo setup whose cast names a deleted or unknown own character: expected that seat plays as the custom bot and the picker shows Custom bot. Test in Task 3.
2. Two accounts on one device: characters made under account A must not upload to account B. Test in Task 6 (owner tag, as results).
3. A tampered or old local store (bad dial value, 200-character name, duplicate ids): expected those entries dropped on load, never a crash. Test in Task 2.
4. Editing only the name or description must not mark the record edited. Test in Task 2.
5. A result that names an own character but no `names` entry (hand-edited storage): expected shown as "Your character (deleted)" when the character is gone. Test in Task 4.

---

### Task 1: Shared shape: own characters and results that name them

**Files:**
- Create: `packages/core/src/names.ts` (move `cleanName` with its `CONTROL`, `FORMAT`, `LONE_SURROGATE` from `packages/protocol/src/index.ts:87-106`; protocol re-exports it unchanged)
- Create: `packages/persistence/src/ownCharacters.ts`, test `packages/persistence/src/ownCharacters.test.ts`
- Modify: `packages/persistence/src/botResults.ts`, `packages/persistence/src/index.ts`; test `packages/persistence/src/botResults.test.ts` (create if missing)

**Interfaces:**
- Produces (`@contractplay/core`): `cleanName(value: unknown, max: number): string | undefined` (same behaviour; `packages/protocol` keeps exporting it).
- Produces (`@contractplay/persistence`):
  - `type OwnCharacter = Readonly<{ id: string; name: string; blurb: string; skill: SkillLevel; traits: BotTraits; updatedAt: number; playEditedAt?: number; deleted?: true; owner?: string }>`
  - `MAX_OWN_CHARACTERS = 12`, `MAX_CHARACTER_NAME = 24`, `MAX_CHARACTER_BLURB = 80`, `MAX_STORED_CHARACTERS = 100`
  - `isOwnCharacterId(value: unknown): value is string` — `/^own-[A-Za-z0-9_-]{6,40}$/`
  - `isOwnCharacter(value: unknown): value is OwnCharacter` — id; `cleanName(name, 24) === name`; blurb a string of at most 80 characters with no control characters; skill one of four; `traits` has exactly the six `TRAIT_NAMES`, each in `TRAIT_LEVELS`; `updatedAt` and `playEditedAt` safe integers ≥ 0; `deleted` undefined or true; `owner` undefined or string.
  - `ownCharacterFields(character: OwnCharacter): OwnCharacter` — without `owner` or unknown fields.
  - `BotResult` gains `names?: Readonly<Record<string, string>>`; seat entries also accept own ids; `isBotResult` checks every `names` key is an own id sitting in `partner`/`left`/`right` and every value passes `cleanName(v, 24) === v`; `botResultFields` keeps `names`.

- [ ] **Step 1: Write the failing tests.**
  - `ownCharacters.test.ts`: `"accepts a full character"` (a fixture `{ id: "own-abc123", name: "Gentle Gina", blurb: "Never doubles.", skill: "advanced", traits: { ...TRAIT_PRESETS.normal, doubles: "cautious" }, updatedAt: 5 }` → true; with `deleted: true, owner: "p1", playEditedAt: 3` → true); `"rejects a bad character"` (each → false: id `"tess"`, id `"own-a"`, name `" Gina"`, a 25-character name, a 81-character blurb, a blurb with `"\u0007"`, skill `"master"`, traits missing `leads`, a dial `"wild"`, an extra dial `{ ...traits, luck: "bold" }`, `updatedAt: -1`, `deleted: false`); `"drops the owner"` (`ownCharacterFields({ ...fixture, owner: "p1", extra: 1 } as never)` equals the fixture).
  - `botResults.test.ts`: `"accepts own characters with their names"` (`{ handId: "h1", partner: "own-abc123", left: "tess", right: "custom", score: 50, declared: false, made: false, names: { "own-abc123": "Gentle Gina" } }` → true; `botResultFields` keeps `names`); `"rejects names for seats that are not own characters"` (names key `"tess"` → false; names key `"own-zzz999"` not seated → false; name `""` → false).
- [ ] **Step 2: Run** `pnpm --filter @contractplay/persistence exec vitest run`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement**, moving `cleanName` to core first (`pnpm --filter @contractplay/core build`; protocol tests still pass).
- [ ] **Step 4: Run** `pnpm --filter @contractplay/core build && pnpm --filter @contractplay/persistence exec vitest run && pnpm --filter @contractplay/protocol exec vitest run`, then `pnpm --filter @contractplay/persistence build`. Expected: PASS.

### Task 2: Characters in the browser

**Files:**
- Create: `apps/client/src/ownCharacters.ts`, test `apps/client/src/ownCharacters.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `ownCharactersKey = "contractplay.ownCharacters"`
  - `loadOwnCharacters(storage): OwnCharacter[]` — drops entries failing `isOwnCharacter` and later duplicates of an id; `saveOwnCharacters(storage, list): OwnCharacter[]` keeps the newest `MAX_STORED_CHARACTERS` by `updatedAt`.
  - `liveCharacters(list): OwnCharacter[]` — without tombstones, in list order (new characters are appended).
  - `type CharacterDraft = Readonly<{ name: string; blurb: string; skill: SkillLevel; traits: BotTraits }>`; `checkDraft(draft): { draft: CharacterDraft } | { error: string }` — name through `cleanName(…, 24)` ("Give your character a name of up to 24 characters."), blurb trimmed, over 80 → "Keep the description to 80 characters.".
  - `createCharacter(list, draft, now: number, random = Math.random): OwnCharacter[]` — id `own-` + 10 base-36 characters; throws when 12 live exist.
  - `updateCharacter(list, id, draft, now): OwnCharacter[]` — sets `updatedAt: now`; sets `playEditedAt: now` only when skill or any dial differs; keeps an earlier `playEditedAt` otherwise.
  - `deleteCharacter(list, id, now): OwnCharacter[]` — replaces it with `{ ...character, deleted: true, updatedAt: now }`.
  - `rosterCharacter(id: string | undefined, own: readonly OwnCharacter[]): BotCharacter | undefined` — the named cast member, or a live own character as `{ id, name, skill, aggression: "normal", blurb, traits }`.
  - `startingPoints: readonly { label: string; draft: CharacterDraft }[]` — the three presets ("Normal bot", "Conservative bot", "Aggressive bot", Intermediate skill, empty name) then each cast member (its name, blurb, skill, `TRAIT_PRESETS[aggression]`).

- [ ] **Step 1: Write the failing tests:** `"keeps only well-formed characters"` (storage holding `[valid, { ...valid, traits: { ...valid.traits, leads: "wild" } }, { ...valid, name: "x".repeat(200) }, { ...valid }]` loads `[valid]`; unreadable JSON loads `[]`); `"creates up to twelve"` (12 creates succeed with distinct `own-` ids; the 13th throws); `"marks play edits but not name edits"` (update changing only name and blurb leaves `playEditedAt` undefined; changing `skill` sets it to `now`; a later name-only edit keeps it); `"deletes as a tombstone"` (`liveCharacters(deleteCharacter(list, id, 9))` lacks it; the stored entry has `deleted: true, updatedAt: 9`); `"looks up cast and own characters"` (`rosterCharacter("tess", [])?.name` is "Timid Tess"; an own id returns its name and traits; a deleted own id returns undefined); `"checks drafts"` (name `"  Gina  "` → "Gina"; `""` and 25 characters → the name error; 81-character blurb → the blurb error).
- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/ownCharacters.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.

### Task 3: Own characters at the solo table

**Files:**
- Modify: `apps/client/src/soloSetup.ts`, `apps/client/src/App.tsx:356-357, 956, 1077, 1106`; test `apps/client/src/soloSetup.test.ts`, `apps/client/src/App.test.tsx`

**Interfaces:**
- Consumes: `rosterCharacter`, `loadOwnCharacters` (Task 2).
- Produces (signatures change; every caller updated):
  - `readCast` accepts `"custom"`, a cast id, or any `isOwnCharacterId` value (whether the character exists is decided at use, so a setup survives a sync that brings the character later).
  - `castCharacterAt(cast, seat, userSeat, own: readonly OwnCharacter[]): BotCharacter | undefined`
  - `botSettingsAt(setup, seat, userSeat, own): { skill: SkillLevel; aggression: Aggression; traits?: Partial<BotTraits> }`
  - `castHasCustom(cast, own): boolean` — a seat whose own character is missing counts as custom.
  - App holds `const [ownCharacters, setOwnCharacters] = useState(() => loadOwnCharacters(persistence.storage))` and passes `traits` into `createBot` when present.

- [ ] **Step 1: Write the failing tests:** in `soloSetup.test.ts`, `"keeps an own character in the cast"` (saved cast `{ partner: "own-abc123", … }` loads back unchanged; `"own-!"` loads as `"custom"`); `"an own character plays with its own dials"` (`botSettingsAt` with that partner returns its skill and `traits`); `"a missing own character plays as the custom bot"` (with `own = []`, `botSettingsAt` returns the setup's skill and aggressiveness and `castHasCustom` is true). In `App.test.tsx`, `"names an own character at its seat"`: storage holding an own character "Gentle Gina" as partner shows "Gentle Gina" at North's seat label.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/soloSetup.test.ts src/App.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same. Expected: PASS.

### Task 4: Results with own characters

**Files:**
- Modify: `apps/client/src/partnerResults.ts`, `apps/client/src/table/BotCastFields.tsx`, `apps/client/src/App.tsx:870-890` (Recent hands), `apps/client/src/online/Lobby.tsx:218`; test `apps/client/src/partnerResults.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3.
- Produces:
  - `partnerResultOf(handId, game, userSeat, cast, extra = {}, own: readonly OwnCharacter[] = [])` — counts a hand when any seat is a cast member or a live own character; adds `names` for each own seat.
  - `partnerStats` / `opponentStats` count own ids as well as cast ids (`"custom"` and `"human"` still skipped).
  - `castMemberName(id: string, own: readonly OwnCharacter[], results: readonly PartnerResult[]): string` — the cast or live own name; for a missing own id, the newest result's `names[id]` + " (deleted)", or "Your character (deleted)".
  - `editedSince(id: string, own: readonly OwnCharacter[], results: readonly PartnerResult[]): boolean` — the character has `playEditedAt` and some result with it has `at` undefined or below it.
  - Summaries in `BotCastFields` and Recent hands append " · edited since some of these hands" when `editedSince`.

- [ ] **Step 1: Write the failing tests** in `partnerResults.test.ts`: `"records a hand with an own character and its name"`; `"counts own characters as partners and opponents"`; `"names a deleted character from its results"` (→ "Gentle Gina (deleted)"; with no names → "Your character (deleted)"); `"notes play edits since older hands"` (results at 1 and 10, `playEditedAt: 5` → true; `playEditedAt: 0` → false; no `playEditedAt` → false).
- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/partnerResults.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, and update the three display sites to use `castMemberName` and `editedSince`. App records with `own = ownCharacters`.
- [ ] **Step 4: Run** `pnpm --filter @contractplay/client exec vitest run src/partnerResults.test.ts src/App.test.tsx src/online/Lobby.test.tsx`. Expected: PASS.

### Task 5: Picker group and editor

**Files:**
- Create: `apps/client/src/table/OwnCharacterEditor.tsx`, test `apps/client/src/table/OwnCharacterEditor.test.tsx`
- Modify: `apps/client/src/table/BotCastFields.tsx`, `apps/client/src/table/labels.tsx` (dial words), `apps/client/src/App.tsx:856`, `apps/client/src/online/Lobby.tsx:388`, `apps/client/src/styles.css` (only what the editor needs)

**Interfaces:**
- Consumes: Task 2 functions.
- Produces:
  - `BotCastFields` props gain `own: readonly OwnCharacter[]` and `onOwnChange(next: OwnCharacter[]): void`. The pickers get a "Your characters" `optgroup` after Custom bot (live characters, `"<name> · Your character"`). Under the blurbs, a **Your characters** list: each with Edit and Delete (Delete asks `window.confirm("Delete <name>? Its results stay in your record.")`), and **New character** (disabled with "You have 12 characters, the most you can keep." at 12). A deleted character that was picked switches that seat to Custom bot.
  - `OwnCharacterEditor({ initial?: OwnCharacter; onSave(draft: CharacterDraft): void; onCancel(): void })` — a form: "Start from" select (`startingPoints`, new characters only), Name, Description, Skill, and a `fieldset` per dial with three radio buttons labelled by the dial words, the chosen one's meaning shown below; Save shows `checkDraft`'s error inline (`role="alert"`) and calls `onSave` only on success.
  - `traitWords: Record<keyof BotTraits, { label: string; levels: Record<TraitLevel, { word: string; meaning: string }> }>` in `labels.tsx`.
  - Callers persist through `saveOwnCharacters` and hold the list in state (App's `ownCharacters`; Lobby loads its own on mount and after `resultsSynced` changes).

- [ ] **Step 1: Write the failing tests** in `OwnCharacterEditor.test.tsx`: `"starts from a cast member"` (choose "Bold Bea" → skill Advanced, Openings Light, Leads Attacking selected); `"saves a named character"` (type name, pick Penalty doubles Often, Save → `onSave` called with that draft); `"explains a bad name"` (Save with empty name → alert text, `onSave` not called). And in a `BotCastFields` test (create `BotCastFields.test.tsx`): `"offers your characters in every picker"`; `"deleting a picked character returns its seat to the custom bot"`; `"stops at twelve"`.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/table`. Expected: FAIL.
- [ ] **Step 3: Implement**, and wire App and Lobby.
- [ ] **Step 4: Run** `pnpm --filter @contractplay/client exec vitest run`. Expected: PASS.

### Task 6: On the account

**Files:**
- Create: `apps/server/migrations/0005_bot_characters.sql`, `apps/server/src/characters.ts`, `apps/server/src/characters.test.ts`, `apps/client/src/online/charactersSync.ts`, `apps/client/src/online/charactersSync.test.ts`
- Modify: `apps/server/src/auth-store.ts`, `apps/server/src/index.ts` (route `/api/account/characters`), `apps/client/src/App.tsx` (sync beside `syncBotResults` at line ~199; upload after each save), `apps/client/src/online/OnlineTable.tsx` and `apps/client/src/online/Lobby.tsx` (same sync points as results)

**Interfaces:**
- Consumes: Task 1 (`isOwnCharacter`, `ownCharacterFields`), Task 2 (`loadOwnCharacters`, `saveOwnCharacters`).
- Produces:
  - Table `bot_characters(account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE, character_id TEXT NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data_json TEXT NOT NULL, PRIMARY KEY (account_id, character_id))`.
  - `AuthStore.upsertCharacters(accountId, characters: readonly OwnCharacter[]): Promise<void>` — `ON CONFLICT … DO UPDATE … WHERE excluded.updated_at > bot_characters.updated_at`, then trims to the newest 100 rows; `AuthStore.listCharacters(accountId): Promise<OwnCharacter[]>`.
  - `charactersRoute(request, env)`: same auth, origin and `X-Expected-Player-ID` checks as `bot-results.ts`; `GET` → `{ characters }`; `POST { characters }` (at most 100, each `isOwnCharacter`, else 400) → 409 `{ error: "too-many-characters" }` when the account would hold more than 24 live; otherwise the full list. Other paths 404, other methods 405.
  - `syncCharacters(storage, account): Promise<OwnCharacter[]>` and `uploadCharacters(storage, account, changed: readonly OwnCharacter[])`, the same queue/owner/merge pattern as `botResultsSync.ts`: send local entries of this account the service lacks or holds an older `updatedAt` for; merged list = other owners' entries + remote (tagged `owner`) + local entries still newer than remote.

- [ ] **Step 1: Write the failing tests.** Server (`characters.test.ts`, applying migrations 0001–0005 as `bot-results.test.ts` does): `"stores and lists a player's characters"`; `"keeps the newer edit"` (POST updatedAt 5 then 3 → stays 5); `"keeps deletions"` (tombstone listed with `deleted: true`); `"rejects bad characters and too many"` (bad dial → 400; 25 live → 409); `"needs the signed-in player"` (no session → 401; wrong expected id → 409). Client (`charactersSync.test.ts`, fetch stubbed as in `botResultsSync.test.ts`): `"sends what the account lacks and keeps the account's list"`; `"a deletion on the account removes the local copy"`; `"leaves another account's characters alone"`.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/persistence build && pnpm --filter @contractplay/server exec vitest run src/characters.test.ts && pnpm --filter @contractplay/client exec vitest run src/online/charactersSync.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** and wire the sync points.
- [ ] **Step 4: Run** the same commands. Expected: PASS.

### Task 7: Previews, docs, full checks

**Files:**
- Modify: `apps/client/src/mocks/scenarios.ts`, `apps/client/src/mocks/Previews.test.tsx`, `README.md` (preview table, solo paragraph), `CHANGES.md`, `TODO.md`, `docs/platform-delivery.md` (0005 note)

- [ ] **Step 1: Write the failing preview expectations:** preview 17 "Solo: new deal" now has an own character, "Gentle Gina" (Advanced, Penalty doubles Rarely), as the right-hand opponent instead of the custom bot, with "3 hands against"; a new solo preview after it, "Solo: your characters", showing the editor open on Gentle Gina (detail text describes name, description, skill, and the six dials). Expectations: the picker shows "Gentle Gina · Your character"; the editor shows the six dial groups and Gina's Rarely selected.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/mocks`. Expected: FAIL.
- [ ] **Step 3: Implement** the previews; renumber the README preview table (one more solo preview, so later numbers shift by one, total 37); update the docs.
- [ ] **Step 4: Run** `pnpm typecheck`, `pnpm lint`, `pnpm test`. Expected: all pass; report any flaky test with its rerun.
- [ ] **Step 5:** Ask the owner before applying migration 0005 to production.
