# Bot trait dials (part 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single aggressiveness switch inside the bots with six trait dials, keep aggressiveness as presets that
play exactly as today, and add the two new behaviours (wild preempts, penalty doubles rarely/often).

**Architecture:** `packages/core/src/bots.ts` gains the trait types, presets and a resolver; `BotConfig` gains optional
`traits`. `packages/bots/src/aggression.ts` becomes `traits.ts`, where each dial is its own small function that looks only
at the natural call or card; `createBot` resolves the traits once and applies them. A seeded-deal snapshot recorded before
the refactor proves the presets are unchanged.

**Tech Stack:** TypeScript (`exactOptionalPropertyTypes`), Vitest, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-11-25-bot-traits-design.md` (Part 1 and "The dials").

## Global Constraints

- No visible change: every existing solo setup, online table, and cast member makes the same calls and cards for the same deal and auction.
- Dial levels are `"cautious" | "standard" | "bold"`; dials are `openings`, `competing`, `preempts`, `doubles`, `leads`, `secondHand`.
- Presets: Normal all Standard; Conservative = openings, competing, preempts, leads, secondHand Cautious, doubles Standard; Aggressive = openings, competing, leads, secondHand Bold, preempts and doubles Standard.
- Resolution: preset from `aggression` (missing means Normal), then each dial in `traits` overrides.
- A Cautious dial only turns a natural non-pass (never a redouble) into a pass, and only when `passAllowed()`; a Bold dial only turns a natural pass into a legal call. Bold precedence: openings, preempts, competing, doubles.
- Hints are unchanged (`suggestBid` keeps building a Normal expert bot).
- Keep `packages/core` platform-neutral. Commit only when the owner asks; do not regenerate the snapshot (`-u`) after Task 1.

## Review Focus

1. A Cautious dial passing a forcing call (e.g. a response to partner's new-suit opening after an overcall): expected to keep the call. Tested in Task 3 (`passAllowed` false) and Task 5 (doubles rarely with `passAllowed` false).
2. Wild preempt in fourth seat or after someone opened: expected no preempt. Tested in Task 4.
3. "Often" doubling partner's contract, or doubling when a double would be takeout (partscore suit contract, our side silent): expected pass. Tested in Task 5.
4. A partial `traits` object (one dial set) with `aggression` set: expected the other dials from the preset. Tested in Task 2.
5. A Cautious doubles dial meeting a double that partner's agreements require (no pass allowed): expected the double. Tested in Task 5 (`passAllowed` false).

---

### Task 1: Record the seeded-deal regression snapshot (before any change)

**Files:**
- Create: `packages/bots/src/traits.regression.test.ts` (snapshot lands in `packages/bots/src/__snapshots__/`)

**Interfaces:**
- Produces: `playDeal(seed: number, config: (seat: Seat) => BotConfig): Promise<string>` inside the test file — the whole auction and play as one string ("N:1S E:P … | W:H4 N:H2 …"), or the auction followed by "passed out".

- [ ] **Step 1: Write the test.** A local mulberry32 `seededRandom(seed)` (copy of `packages/table/src/test-helpers.ts:9`), `deal(shuffle(createDeck(), seededRandom(seed)))`, dealer `SEATS[seed % 4]`, vulnerability cycling `["None","NS","EW","Both"][seed % 4]`. Drive it with `createGameState` / `applyAction`: in the auction ask `createBot(config(seat)).chooseBid(state.hands[seat], state.auction, seat)`; in play ask the bot of `state.currentActor` with `playContextFor(state)`. One `it` per skill (beginner, intermediate, advanced, expert) × aggression (conservative, normal, aggressive), all four seats the same config, seeds 1–10 each, ending `expect(lines).toMatchSnapshot()`. Name them `"<skill> <aggression> plays the seeded deals as recorded"`.
- [ ] **Step 2: Run it to write the snapshot:** `pnpm --filter @contractplay/bots exec vitest run src/traits.regression.test.ts`. Expected: 12 passed, "12 snapshots written". If the file takes over ~20 s, drop to seeds 1–6 and rerun.
- [ ] **Step 3: Run it again:** same command. Expected: 12 passed, no snapshots written (proves it is deterministic).

### Task 2: Trait types, presets and resolution in core

**Files:**
- Modify: `packages/core/src/bots.ts:6-10`, `packages/core/src/characters.ts:7`
- Test: `packages/core/src/bots.test.ts`

**Interfaces:**
- Produces (exported from `@contractplay/core`):
  - `type TraitLevel = "cautious" | "standard" | "bold"`; `TRAIT_LEVELS: readonly TraitLevel[]`
  - `type BotTraits = Readonly<{ openings; competing; preempts; doubles; leads; secondHand }>` (each `TraitLevel`); `TRAIT_NAMES: readonly (keyof BotTraits)[]` in that order
  - `TRAIT_PRESETS: Readonly<Record<Aggression, BotTraits>>`
  - `BotConfig` gains `traits?: Partial<BotTraits>`
  - `resolveTraits(config: Pick<BotConfig, "aggression" | "traits">): BotTraits`
  - `BotCharacter` gains `traits?: Partial<BotTraits>` (cast entries unchanged)

- [ ] **Step 1: Write the failing tests** in `bots.test.ts`:
  - `"presets match today's aggressiveness"`: `TRAIT_PRESETS.normal` all standard; `.conservative` equals `{openings:"cautious",competing:"cautious",preempts:"cautious",doubles:"standard",leads:"cautious",secondHand:"cautious"}`; `.aggressive` equals `{openings:"bold",competing:"bold",preempts:"standard",doubles:"standard",leads:"bold",secondHand:"bold"}`.
  - `"resolves the preset then each set dial"`: `resolveTraits({})` equals the normal preset; `resolveTraits({ aggression: "aggressive", traits: { preempts: "bold" } })` equals the aggressive preset with `preempts: "bold"`; `resolveTraits({ traits: { doubles: "cautious" } })` is normal with `doubles: "cautious"`.
- [ ] **Step 2: Run:** `pnpm --filter @contractplay/core exec vitest run src/bots.test.ts`. Expected: FAIL (`TRAIT_PRESETS` not exported).
- [ ] **Step 3: Implement** the types and `resolveTraits` (`{ ...TRAIT_PRESETS[aggression ?? "normal"], ...traits }`, dropping `undefined` values so `exactOptionalPropertyTypes` holds).
- [ ] **Step 4: Run** the same command, then `pnpm --filter @contractplay/core build`. Expected: PASS.

### Task 3: Trait-driven bots with the existing behaviour

**Files:**
- Rename: `packages/bots/src/aggression.ts` → `packages/bots/src/traits.ts`; `aggression.test.ts` → `traits.test.ts`
- Modify: `packages/bots/src/player.ts:3676-3703` (`createBot`)

**Interfaces:**
- Consumes: `BotTraits`, `resolveTraits` (Task 2).
- Produces (in `traits.ts`, not exported from the package index):
  - `adjustCall(chosen: Bid, h: Eval, v: View, traits: BotTraits, passAllowed: () => boolean): Bid`
  - `traitCard(context: PlayContext, traits: BotTraits): Card | undefined` (replaces `aggressionCard`)
  - one function per dial situation, each `(h: Eval, v: View, token: Token) => boolean` for cautious and `(h: Eval, v: View) => Token | undefined` for bold.

Split today's code along these lines (same conditions, same order, nothing else changed):

| Today | Dial |
|---|---|
| `conservativePasses`, nobody opened, one-level suit | openings cautious |
| `conservativePasses`, nobody opened, two-level+ suit except 2♣ | preempts cautious |
| `conservativePasses`, first action over them, and the 3-level push in partner's suit | competing cautious |
| `aggressiveCall`, Rule of 20 opening | openings bold |
| `aggressiveCall`, light overcall and one-more-level compete | competing bold |
| `aggressionCard`, defender's lead against a suit contract (every defensive lead, as today) | leads |
| `aggressionCard`, second hand | secondHand |

`adjustCall`: if the natural token is a non-pass other than "R", pass when any Cautious dial's check holds and `passAllowed()`; if it is "P", try Bold dials in the order openings, preempts, competing, doubles and take the first legal call. `traitCard`: leads dial on leads, secondHand dial on second-hand plays.

- [ ] **Step 1: Rewrite the tests** in `traits.test.ts`: keep every existing test, with `bid`/`play` taking `traits: Partial<BotTraits>` and an `aggression` helper that passes `{ aggression }` as today (so the three-level expectations stay as written). The direct `adjustCall` test passes `TRAIT_PRESETS.conservative`. Add:
  - `"each dial changes only its own calls"` (intermediate): `("KQ32.4.KJ32.Q432","1H")` → `"X"` with only `openings:"cautious"`, `"P"` with only `competing:"cautious"`; `("QJT987.4.K32.432","")` → `"P"` with only `preempts:"cautious"`, `"2S"` with only `openings:"cautious"`; `("KQJ54.KJ543.32.4","")` → `"1S"` with only `openings:"bold"`, `"P"` with only `competing:"bold"`.
  - `"card dials act alone"`: `{ leads: "bold" }` cashes HA on the existing lead context while second hand stays the skill's card; `{ secondHand: "cautious" }` plays H2 second hand while the lead equals the Normal lead.
  - `"a preset given as traits plays like the aggressiveness"`: for each aggression, `createBot({ ..., traits: TRAIT_PRESETS[a] })` (no `aggression`) gives the same calls as `{ aggression: a }` on the opening and overcall hands above.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/bots exec vitest run src/traits.test.ts`. Expected: FAIL (module `./traits.js` missing).
- [ ] **Step 3: Implement** the split; `createBot` computes `const traits = resolveTraits(config)` and calls `adjustCall(natural, system.h, system.v, traits, passAllowed)` and `traitCard(context, traits) ?? bot.chooseCard(context)`. Update the comment above `createBot` to point at `traits.ts`.
- [ ] **Step 4: Run** `pnpm --filter @contractplay/bots exec vitest run src/traits.test.ts src/traits.regression.test.ts`. Expected: all pass, snapshot unchanged (no "written"/"updated").
- [ ] **Step 5: Run** `pnpm --filter @contractplay/core build && pnpm --filter @contractplay/bots exec vitest run && pnpm --filter @contractplay/table exec vitest run`. Expected: PASS (`packages/table/src/aggression.test.ts` unchanged and green).

### Task 4: Wild preempts (preempts Bold)

**Files:**
- Modify: `packages/bots/src/traits.ts`
- Test: `packages/bots/src/traits.test.ts`

**Interfaces:**
- Produces: `wildPreempt(h: Eval, v: View): Token | undefined`, wired as the preempts Bold dial.

Rule (spec): only when nobody has opened (`v.tokens.length === 0`) and `v.leadingPasses <= 2`; 4–10 HCP; take the longest suit (`h.byLength[0]`) with at least one of AKQJT. Exactly six cards in ♦/♥/♠ → `2<suit>`; seven or more in any suit → `3<suit>`; anything else (six clubs) → undefined. An outside four-card major does not stop it. Only replaces a natural pass (guaranteed by `adjustCall`).

- [ ] **Step 1: Write the failing tests** (`"preempts wildly only when the dial is bold"`), intermediate, SAYC. Every hand below passes with all three aggressiveness presets today (checked):
  - `("T98765.Q432.32.4","")` → `"2S"` with `{ preempts: "bold" }` (outside four hearts does not stop it), `"P"` with Normal.
  - `("4.32.J876532.Q32","")` → `"3D"` with bold; same hand after `"P P"` → `"3D"`; after `"P P P"` (fourth seat) → `"P"`.
  - `("98765432.32.32.4","")` (no honour) → `"P"` with bold.
  - `("T98765.Q432.32.4","1C")` → `"P"` with bold (someone opened; the dial never overcalls).
  - `("KQ9876.AK4.32.32","")` → `"1S"` with bold (natural call kept).
- [ ] **Step 2: Run** `pnpm --filter @contractplay/bots exec vitest run src/traits.test.ts`. Expected: the new test FAILs.
- [ ] **Step 3: Implement** `wildPreempt` and wire it.
- [ ] **Step 4: Run** the traits tests and the regression test. Expected: PASS, snapshot unchanged.

### Task 5: Penalty doubles, Rarely and Often

**Files:**
- Modify: `packages/bots/src/traits.ts`
- Test: `packages/bots/src/traits.test.ts`

**Interfaces:**
- Consumes: `explainBid(auction, index, style, skill)` from `./hints.js` (a penalty double's explanation starts with `"Penalty double"`). `hints.ts` imports `player.ts`, which imports `traits.ts`; the cycle is safe because nothing calls across it at module load. If Vitest or the build trips on it, move `explainDouble` and its helpers into a new `packages/bots/src/doubles.ts` that both import, rather than duplicating the rules.
- Produces: `readAsPenalty(v: View): boolean` (a double by `v.seat` now would be explained as a penalty double: `explainBid([...v.auction, { seat: v.seat, bid: "double" }], v.auction.length, v.style)`), `penaltyDouble(h: Eval, v: View): Token | undefined` (doubles Bold), and the doubles Cautious check (`token === "X" && readAsPenalty(v)`).

`penaltyDouble` returns `"X"` only when all hold:
- pass-out seat: `v.last` is set, `!v.lastIsOurs`, and `v.tokens` ends with `[v.last, "P", "P"]`; `v.legal("X")`;
- not readable as takeout: `levelOf(v.last) >= 4`, or `v.last === "3N"`, or our side has a non-pass call in `v.ours`; and `readAsPenalty(v)`;
- the holding: against a suit, `h.len(trump) >= 4 && h.count(trump, "AKQJ") >= 2` and at least one quick trick outside trumps; against notrump, at least 3 quick tricks. Quick tricks per suit by the standard defensive table (AK or AKQ 2, AQ 1.5, A 1, KQ 1, guarded K 0.5; `player.ts:54` counts AKQ as 3 for its own purposes), written over `Eval` in `traits.ts`.

- [ ] **Step 1: Write the failing tests** (`"doubles for penalty often only when the dial is bold"` and `"doubles for penalty rarely when cautious"`), advanced, SAYC. Natural calls below were checked against today's bots:
  - `("KJ32.A54.QT98.32","1S P 4S P P")` (East, pass-out seat, game, our side silent) → `"X"` with `{ doubles: "bold" }`, `"P"` with Normal.
  - `("KJ32.A54.QT98.32","1S P 2S P P")` (partscore, our side silent: takeout) → `"P"` with bold.
  - `("KQT2.A54.Q98.432","1S 2H 2S P P")` (East overcalled 2H; partscore but our side competed) → `"X"` with bold.
  - `("A32.KQ4.K432.432","1N P 3N P P")` (2.5 quick tricks) → `"P"` with bold; `("A32.AK4.K432.432","1N P 3N P P")` (3.5) → `"X"`.
  - Partner's contract: `penaltyDouble(evaluate(hand("KJ32.A54.QT98.32")), createView(auctionFrom("1S P 4S P"), "north", "SAYC", "advanced"))` (North's partner South bid 4S last) → `undefined`.
  - Rarely: `("KJ2.AQT9.432.432","1N 2H")` doubles (explained "Penalty double: expects to defeat 2♥.") with Normal and → `"P"` with `{ doubles: "cautious" }`. A takeout double, `("KQ32.4.KJ32.Q432","1H")` intermediate, stays `"X"` with `{ doubles: "cautious" }`. `adjustCall("double", h, v, { ...TRAIT_PRESETS.normal, doubles: "cautious" }, () => false)` on the `1N 2H` position stays `"double"`.
- [ ] **Step 2: Run** `pnpm --filter @contractplay/bots exec vitest run src/traits.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** `readAsPenalty`, the quick-trick helper, `penaltyDouble`, and the Cautious check; wire both into `adjustCall` (doubles last in the Bold order).
- [ ] **Step 4: Run** traits tests and the regression test. Expected: PASS, snapshot unchanged.

### Task 6: Docs and full checks

**Files:**
- Modify: `TODO.md` (note part 1 done under the own-characters item), `docs/superpowers/specs/2026-11-25-bot-traits-design.md` only if a builder call changed (e.g. the lead dial covering every defensive lead, as today). No `CHANGES.md` entry and no preview change: nothing visible changes.

- [ ] **Step 1:** Update the docs above.
- [ ] **Step 2: Run** `pnpm typecheck`, `pnpm lint`, `pnpm test`. Expected: all clean; the regression snapshot unchanged. Report any flaky test (e.g. `boardSet.test.ts`) with its rerun result.
