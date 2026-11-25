# Own characters at online tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A seated player can put one of their own characters in an online table's bot seat; it plays with its own skill and dials, everyone sees its name and dial summary, and its owner's results with it count as in solo.

**Architecture:** `setBot` gains an optional `custom` character (validated and name-cleaned when the message is parsed). The table stores it on the seat with the seating player as owner, and `chooseBotAction` plays it with its traits. Views show everyone the name, skill and dials; only the owner's view carries the character id, so only the owner's client records results against it.

**Tech Stack:** TypeScript, Vitest, React; packages `core`, `persistence`, `protocol`, `table`; `apps/client`.

**Spec:** `docs/superpowers/specs/2026-11-25-bot-traits-design.md` (Part 3)

## Global Constraints

- Own character names are cleaned with `cleanName` at most 24 characters, the same rules as player names; traits must be all six dials with a valid setting.
- "Protocol version rises only if the change is not purely additive." Every new field is optional, so `PROTOCOL_VERSION` stays 8.
- "The table's aggressiveness still applies to table bots and stand-ins."
- "Other players at the table record that seat as "custom" (their accounts never hold ids they don't own)."
- Any seated player may set or replace any bot seat, own characters included (as with any bot).
- Keep the `#/mocks` previews, `Previews.test.tsx`, and the README preview table current; update TODO.md and CHANGES.md.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`.

## Review Focus

1. A player who learns or guesses another player's character id seats a bot with it: the owner's records must not count it (the id is never shown to anyone but the seating player, and an owner only counts a seat whose view carries the id). Test in Task 2.
2. The owner leaves the seat, disconnects, or edits or deletes the character mid-session: the seated bot keeps playing as it was seated (a snapshot). Test in Task 2.
3. A crafted `setBot` (control characters or 25+ characters in the name, a missing or extra dial, a bad id, `character` and `custom` together) is refused as a bad message, never stored. Tests in Task 1.
4. Tables stored before this change (no `custom` on any seat) load and play exactly as before. Test in Task 2.
5. A viewer whose own list lacks the seated character (another player, or the owner on a device that never synced it) sees the seat's name in the picker instead of a blank or a wrong choice. Test in Task 3.

---

### Task 1: The message

**Files:**
- Modify: `packages/core/src/bots.ts` (or a new `packages/core/src/ownCharacter.ts`, exported from core's index), `packages/persistence/src/ownCharacters.ts`, `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/index.test.ts`

**Interfaces:**
- Produces (core): `MAX_CHARACTER_NAME = 24`, `isOwnCharacterId(value: unknown): value is string` (`/^own-[A-Za-z0-9_-]{6,40}$/`), `isBotTraits(value: unknown): value is BotTraits`, moved from persistence; persistence re-exports them so its importers don't change.
- Produces (protocol):
  - `type CustomBot = { id: string; name: string; skill: SkillLevel; traits: BotTraits }`.
  - `ClientMessage` `setBot` gains `custom?: CustomBot`.
  - `SeatInfo` bot gains `custom?: { id?: string; name: string; traits: BotTraits }`. `id` is present only in the seating player's own view. The bot's `skill` field carries the skill.

- [x] **Step 1: Write the failing tests** in `index.test.ts`, under `describe("setBot with your own character")`:
  - `parses one`: parsing `{type:"setBot", seat:"east", skill:"beginner", custom:{id:"own-abc123", name:"  Gentle   Gina ", skill:"advanced", traits: TRAIT_PRESETS.conservative}}` gives `{type:"setBot", seat:"east", skill:"advanced", custom:{id:"own-abc123", name:"Gentle Gina", skill:"advanced", traits: TRAIT_PRESETS.conservative}}`. The skill comes from the character, and the name is cleaned.
  - `refuses a bad one`: each of these parses to `undefined`:
    - a 25-character name;
    - a name that cleans to nothing (`"\u0000"`);
    - traits missing `leads`;
    - traits with an extra key;
    - a dial set to `"wild"`;
    - id `"bea"`;
    - a bad skill;
    - `character:"bold-bea"` together with `custom`.

- [x] **Step 2: Run** `pnpm --filter @contractplay/protocol exec vitest run`. Expected: FAIL. `custom` is dropped, so the parsed message has no `custom`, and the refusal cases parse.

- [x] **Step 3: Implement.**
  - Move the three exports to core, and re-export them from persistence.
  - In `parseClientMessage`'s `setBot`, when `data.custom !== undefined`, it must be a record with:
    - an `isOwnCharacterId` id;
    - a `cleanName(name, MAX_CHARACTER_NAME)` that is not undefined, used as the name;
    - a valid skill;
    - `isBotTraits` traits.
  - Build a fresh object from those four fields, so unknown keys are dropped, and copy the traits.
  - `character` and `custom` together → `undefined`.

- [x] **Step 4: Run** `pnpm --filter @contractplay/persistence build && pnpm --filter @contractplay/protocol exec vitest run && pnpm --filter @contractplay/persistence exec vitest run`. Expected: PASS.

- [x] **Step 5: Commit** `Let setBot carry a player's own character`.

### Task 2: The table plays it

**Files:**
- Modify: `packages/table/src/state.ts`, `seats.ts`, `reduce.ts`, `hand.ts`, `view.ts`
- Test: `packages/table/src/aggression.test.ts` (traits) and `packages/table/src/view.test.ts`

**Interfaces:**
- Consumes: `CustomBot` (Task 1).
- Produces:
  - `SeatState` bot gains `custom?: { id: string; name: string; traits: BotTraits; owner: PlayerId }`.
  - `setBot(state, player, seat, skill, character?, custom?: CustomBot)` seats `{kind:"bot", skill: custom.skill, custom: {id, name, traits, owner: player}}`.
  - `summaryOf` gives `custom: {name, traits}` (no id, no owner).
  - `viewFor(state, player)` adds `id` to `custom` on seats whose `owner === player`.

- [ ] **Step 1: Write the failing tests.**
  - In `aggression.test.ts`, `describe("your own character at the table")`:
    - **`plays with its own dials, not the table's`:** use `firstBotToCall("normal")`. The table bot passes (as now). Seat a custom with `skill:"beginner"` and `traits: TRAIT_PRESETS.aggressive` in the three bot seats, the same way `firstBotToCall` does for `character`; it opens. Use `{ ...TRAIT_PRESETS.normal, openings: "bold" }` to show that a single dial is enough.
    - **`keeps playing as seated after its owner leaves`:** seat it (alice), have alice `leave`, then deal with another seated player. The bot still opens the light hand.
    - **`a table stored before own characters plays as before`:** a state whose bot seats have no `custom` key gives the same `chooseBotAction` as today. This is the existing normal/aggressive expectation run on such a state.
  - In `view.test.ts`, test **`shows everyone your character but only you its id`**:
    - Alice seats the character at east.
    - `summaryOf(t).seats.east` is `{kind:"bot", skill:"advanced", custom:{name:"Gentle Gina", traits}}`.
    - `viewFor(t, "alice").seats.east.custom.id === "own-abc123"`.
    - `viewFor(t, "bob").seats.east.custom` has no `id`.
    - `viewFor(t, undefined)` has no `id`.

- [ ] **Step 2: Run** `pnpm --filter @contractplay/table exec vitest run src/aggression.test.ts src/view.test.ts`. Expected: FAIL. `setBot` ignores `custom`, and the seat shows a plain bot.

- [ ] **Step 3: Implement.**
  - `reduce` passes `message.custom` through.
  - Replace `botAggression` with `botConfig(state, seat): Pick<BotConfig, "aggression" | "traits">`. A custom seat returns `{ traits: custom.traits }`. A named bot returns its aggression. Anything else returns the table's aggression. Stand-ins are unchanged.
  - `chooseBotAction` spreads it into `createBot`.
  - `seatInfo` in `view.ts` strips `owner` and `id`; `viewFor` puts the id back for the owner.

- [ ] **Step 4: Run** `pnpm --filter @contractplay/table exec vitest run`. Expected: PASS (all table tests).

- [ ] **Step 5: Commit** `Play a player's own character in an online table's bot seat`.

### Task 3: Seating it, and seeing it

**Files:**
- Modify: `apps/client/src/table/labels.tsx`, `apps/client/src/online/SeatingPanel.tsx`, `apps/client/src/online/OnlineTable.tsx`
- Test: `apps/client/src/table/labels.test.tsx`, `apps/client/src/online/OnlineTable.test.tsx`. These tests define their own `GINA` (`own-gentlegina`, "Gentle Gina", advanced, `TRAIT_PRESETS.conservative`); the preview's copy isn't exported.

**Interfaces:**
- Consumes: `SeatInfo.custom` (Task 1), `OwnCharacter`, `liveCharacters`, `charactersFor` and `loadOwnCharacters` (Part 2).
- Produces:
  - `botName(info)` returns `info.custom?.name`, then a cast member's name, then `"Bot"`. Every seat plate, the turn line, the lobby's table list and admin follow it.
  - `onlineBotOptions(own: readonly OwnCharacter[], seated?: { value: string; name: string })` becomes a function. It adds an optgroup "Your characters" with `"<name> · <skill> · Your character"` per live own character. When given `seated` (a custom seat whose id isn't in `own`), it adds a first, disabled option with that value and name.
  - `setBotFor(seat, choice, own)` returns `{type:"setBot", seat, skill, custom:{id, name, skill, traits}}` for an own id.
  - `traitSummary(traits): string` gives the non-Standard dials as `"Openings: Sound · Preempts: Wild"` using `traitWords`, or `"Standard on every dial"`.
  - `SeatingPanel` takes `own: readonly OwnCharacter[]`.
  - The occupant of a custom seat reads `"Gentle Gina · Advanced · Player's character"`, with `traitSummary` on a quiet line under it.
  - In the picker, the custom seat's value is its id when it is in `own`, otherwise `"seated"`.

- [ ] **Step 1: Write the failing tests.**
  - In `labels.test.tsx`:
    - `traitSummary(TRAIT_PRESETS.normal)` is `"Standard on every dial"`.
    - `traitSummary({ ...TRAIT_PRESETS.normal, preempts: "bold", leads: "cautious" })` is `"Preempts: Wild · Opening leads: Passive"`, in `TRAIT_NAMES` order with `traitWords` labels.
    - `setBotFor("east", "own-abc123", [gina])` carries Gina's `custom`.
    - `botName({ custom: { name: "Gentle Gina", traits } })` is `"Gentle Gina"`.
  - In `OnlineTable.test.tsx`, `describe("your own characters")`:
    - **`offers them for a bot seat and seats one`:** store Gina in `contractplay.ownCharacters` with no owner. On the seating screen, choose `"Gentle Gina · Advanced · Your character"` for the open West seat and press Add bot. The sent message equals `{type:"setBot", seat:"west", skill:"advanced", custom:{id:GINA.id, name:"Gentle Gina", skill:"advanced", traits:GINA.traits}}`.
    - **`shows another player's character by name and dials`:** a view whose west seat is `{kind:"bot", skill:"advanced", custom:{name:"Odd Otto", traits:{...normal, preempts:"bold"}}}` shows `"Odd Otto · Advanced · Player's character"` and `"Preempts: Wild"`. The seat's Bot picker shows "Odd Otto" as its value (Review Focus 5).

- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/table/labels.test.tsx src/online/OnlineTable.test.tsx`. Expected: FAIL on the new tests.

- [ ] **Step 3: Implement.** `OnlineTable` loads `charactersFor(loadOwnCharacters(storage), account?.playerId)`, reloads it after its `syncCharacters` resolves, and passes it to `SeatingPanel`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `Seat your own characters at online tables`.

### Task 4: Results with them online

**Files:**
- Modify: `apps/client/src/partnerResults.ts`, `apps/client/src/online/OnlineTable.tsx` (`recordOnlineResult`)
- Test: `apps/client/src/partnerResults.test.ts`, `apps/client/src/online/OnlineTable.test.tsx`

**Interfaces:**
- Consumes: `SeatInfo.custom.id` (owner's view only), `rosterCharacter`.
- Produces: `onlineCast(seats, userSeat, own: readonly OwnCharacter[] = [])`. A custom seat gives its `id` when that id is a live character in `own`, otherwise `"custom"`.

- [ ] **Step 1: Write the failing tests.**
  - In `partnerResults.test.ts`, test **`counts your own character at an online table, and anyone else's as custom`**:
    - A partner seat `{kind:"bot", skill:"advanced", custom:{id:GINA.id, name:"Gentle Gina", traits}}` with `own=[GINA]` gives `partner: GINA.id`.
    - The same seat without `id` (another player's view) gives `"custom"`.
    - With `id` but `own=[]` it gives `"custom"`.
  - In `OnlineTable.test.tsx`, test **`records a finished hand with your character under its name`**: follow the existing online result test, with Gina as partner in the owner's view. The stored result has `partner: GINA.id`, `online: true` and `names: { [GINA.id]: "Gentle Gina" }`.

- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/partnerResults.test.ts src/online/OnlineTable.test.tsx`. Expected: FAIL. Today the custom seat is "custom".

- [ ] **Step 3: Implement.** `recordOnlineResult` gets the same `own` list as the picker and passes it to both `onlineCast` and `partnerResultOf`.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `Count online hands with your own characters`.

### Task 5: Preview and docs

**Files:**
- Modify:
  - `apps/client/src/mocks/scenarios.ts`: the "seating" screen.
  - `apps/client/src/mocks/Previews.test.tsx`.
  - `README.md`: the online paragraph, and the preview table if the title changes.
  - `CHANGES.md` and `TODO.md`: Part 3 done.
- Test: `apps/client/src/mocks/Previews.test.tsx`

- [ ] **Step 1: Write the failing preview expectation.**
  - The "seating" screen keeps West open and puts Gentle Gina (`GINA`, from the solo previews) at North instead of the human partner. The point that Deal waits for West still holds.
  - Its detail says: "…with Gentle Gina, your own character, at North (her non-standard dials under her name), and Bold Bea, a named bot, at East…".
  - The test expects `"Gentle Gina · Advanced · Player's character"` and her dial summary in the North seat group.

- [ ] **Step 2: Run** `pnpm --filter @contractplay/client exec vitest run src/mocks/Previews.test.tsx`. Expected: FAIL.

- [ ] **Step 3: Update the scenario and the docs.**
  - `GINA` is a module-local constant in `scenarios.ts`; reuse it there.
  - Only the `solo` preview kind has `ownCharacters` today. Add `ownCharacters?: readonly OwnCharacter[]` to the online preview kind, and have `Previews.tsx` store it under `contractplay.ownCharacters` for online screens too, so the picker shows Gina as yours.

- [ ] **Step 4: Run** `pnpm typecheck && pnpm lint && pnpm test`. Expected: all pass.

- [ ] **Step 5: Commit** `Preview your own character at an online table`.
