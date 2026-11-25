# Bot traits and players' own characters: design

## Intent

Players asked to make their own bots. Today a bot differs from another of the same skill only by one switch,
aggressiveness (Conservative, Normal, Aggressive), and the cast of twelve already covers every skill × aggressiveness
pair, so a player's "own" bot would play exactly like a cast member. The owner wants own characters that **play
differently**, so bots get separate trait dials, and a player's character is a name plus skill plus a setting on each dial.

Why it matters: picking favourite partners and opponents (the reason for the cast and the results with them) is more fun
when bots have recognisably different styles, and a player can build the partner or sparring opponent they want.

## Goals

- Six independent trait dials, three settings each, that change how a bot bids or plays.
- Aggressiveness stays, as a preset bundle of dials, so every existing solo setup, online table, and cast member plays
  exactly as it does today (same calls and cards for the same deal and auction).
- Players create, edit, and delete their own characters, pick them in solo, and later seat them at online tables.
- Own characters get results like the cast, and follow a signed-in player across devices.

## Non-goals

- New conventions or new skill levels. Dials bend the calls and cards a bot's skill rules choose; they never add a
  convention or break the partnership's agreements (a dial never passes a forcing bid).
- Hints. Hints keep the Normal system: they say what the agreed system suggests, not what a character would do.
- Sharing characters with other players, or a public gallery.
- Random mistakes ("carelessness"): considered and dropped as hard to tune and to test.

## Anti-goals

- Any change to how existing tables, the cast, or Normal bots play.
- A dial that produces illegal or agreement-breaking calls, or a table that waits on a bot.
- Offensive or impersonating names shown to other players at online tables without the same cleaning as player names.

## Approaches considered

1. **Split aggressiveness into dials and add new ones (chosen).** Four dials pull apart what aggressiveness already
   bundles; two add behaviour (wild preempts, penalty doubles). Aggressiveness becomes presets. Cleanest to explain and
   combine; moderate refactor of `packages/bots/src/aggression.ts`.
2. Keep aggressiveness and add two or three traits on top. Less rework, but traits overlap the old switch.
3. A carelessness trait. Feels human but is hard to tune and test.

The owner chose 1, built in three parts shipped separately, in this order.

## The dials

Each dial is `"cautious" | "standard" | "bold"` internally (type `TraitLevel`); the UI shows per-dial words.

| Dial | Cautious | Standard | Bold | Source |
|------|----------|----------|------|--------|
| **Openings** | Sound: 12+ HCP for a one-level suit opening | as the skill's rules | Light: Rule of 20 with 10–11 HCP | existing (Conservative / Aggressive) |
| **Competing** | Sells out: overcalls and takeout doubles need more; no 3-level push in partner's suit under 8 HCP | as rules | Pushes: light one-level overcalls on a good five-card suit; competes one more level in a fit | existing |
| **Preempts** | Sound: a preempt needs two of the top three honours and 6+ HCP | as rules | Wild: preempts on weaker suits (one honour among AKQJT is enough) and down to 4 HCP; see below | sound existing, wild new |
| **Penalty doubles** | Rarely: penalty doubles become passes where a pass is allowed | as rules | Often: doubles the opponents' final contract with a good defence; see below | new |
| **Opening leads** | Passive: lead from a sequence or a suit with no ace or king | as rules | Attacking: cash the ace from A-K against a suit contract | existing; like aggressiveness today, it covers every defender's lead against a suit contract, not only the opening lead (builder's call, to keep the presets unchanged) |
| **Second hand** | Low | as rules | High: win the trick when it can | existing |

Presets (exactly today's behaviour):

- **Normal**: every dial Standard.
- **Conservative**: Openings, Competing, Preempts, Opening leads, Second hand Cautious; Penalty doubles Standard.
- **Aggressive**: Openings, Competing, Opening leads, Second hand Bold; Preempts and Penalty doubles Standard.

### How the dials combine (builder's call, recorded)

Each dial looks at the call or card the skill's rules chose (the *natural* choice), never at another dial's output.
Cautious dials may only turn a natural non-pass into a pass (where a pass is allowed); Bold dials may only turn a natural
pass into a call. So a call a Cautious dial turned into a pass stays a pass, and at most one dial changes any one call.
When several Bold dials apply to the same natural pass, the first in this order wins: Openings, Preempts, Competing,
Penalty doubles. Card dials (leads, second hand) apply to different moments and cannot clash.

### New behaviour, precisely

- **Wild preempts** (Bold): first, second or third seat with no call yet other than passes, the skill's rules
  passed, and the bot would otherwise pass: open a weak two (2♦/2♥/2♠) with a six-card suit holding at least one of
  AKQJT and 4–10 HCP, or a three-level preempt with a seven-card suit on the same terms. An outside four-card major does not stop it.
  Not in fourth seat. Only replaces a pass; never replaces another chosen call.
- **Penalty doubles, Often** (Bold): only in the pass-out seat (the bot's natural pass would end the auction with the
  opponents' contract), and only when a double cannot be read as takeout: the contract is at the four level or higher,
  or 3NT, or our side has already made a non-pass call (any one of these). The bot
  holds either four or more trumps with two of the top four honours plus one more quick trick outside, or (against
  notrump) three or more quick tricks: double. Never over partner's call, never a redouble, never when the double would be
  read as takeout by the partnership's agreements.
- **Penalty doubles, Rarely** (Cautious): a double the hints would describe as a penalty double ("Penalty double: …") is
  replaced by a pass when a pass is allowed. Takeout, negative, support and reopening doubles are untouched. The builder
  may share or export the hint module's double classification for this rather than duplicate it.

## Part 1: dials in the engine (no visible change)

- `packages/core/src/bots.ts`: `TraitLevel`, `BotTraits` (the six dials), `TRAIT_PRESETS` for each `Aggression`, and
  `BotConfig` gains `traits?: Partial<BotTraits>`. Resolution: preset from `aggression` (default Normal), then any explicit
  `traits` override per dial.
- `packages/bots/src/aggression.ts` becomes `packages/bots/src/traits.ts`; `createBot` resolves traits and applies each
  dial through `adjustCall` (keeping the `passAllowed` guard) and `traitCard`.
- `BotCharacter` gains optional `traits?: Partial<BotTraits>` (cast members keep only `aggression` for now).
- Tests: every preset reproduces today's choices on the existing aggression tests and on a fixed batch of seeded deals
  (record calls and cards before the refactor, assert identical after); each dial tested on its own with a hand that
  shows the difference; wild preempts and both penalty-double settings tested, including that they never pass a forcing
  bid or double partner.

## Part 2: own characters in solo

- A character: `{ id, name, blurb?, skill, traits }`, id `own-<random>`; name cleaned with the same rules as player names
  (`cleanName`, max 24 characters); blurb up to 80 characters; all six dials set.
- **Editor**: in the lobby's Play panel and in solo Settings, beside the cast picks, **Your characters** with New, Edit and
  Delete. The editor has name, description, skill, and the six dials (each a three-way choice with a one-line meaning).
  Start a new character from any cast member or preset to copy its settings. At most 12 own characters.
- **Picking**: own characters appear in the Partner / Left / Right pickers in their own "Your characters" group, with
  their blurb under the picks, their name at the table and in the turn line, like the cast.
- **Results**: `BotResult` seat entries accept own-character ids, so results with and against them count and show like the
  cast. Editing a character keeps its record (the owner's decision): the character stores `playEditedAt` when skill or a
  dial changes (not for name or description edits), and its record says "edited since some of these hands" when any of
  its results is older than that. Deleting a character keeps its results under its last name (results store the name as well as the id for own
  characters), shown as "(deleted)".
- **Storage and sync**: kept in the browser; for signed-in players, synced to the account like bot results (new D1 table
  `bot_characters`, `GET/POST/DELETE /api/account/characters`), on the same sync points. Shape-checked on the service
  like results; never shared.
- Previews: a new preview for the editor; preview 17 shows an own character among the picks.

## Part 3: own characters at online tables

- Protocol: `setBot` may carry an own character `{ name, skill, traits }` (name cleaned on the service, traits validated);
  `SeatInfo` bot gets `custom?: { name, traits }` alongside `character`. Protocol version rises only if the change is not
  purely additive.
- Table service stores the traits per seat and `chooseBotAction` uses them; the table's aggressiveness still applies to
  table bots and stand-ins.
- Other players see the character's name and its dial summary on the seating screen; it is the seating player's
  character, so only seated players can put it in (as with any bot).
- Results with own characters at online tables count as in solo for the character's owner. Other players at the table
  record that seat as `"custom"` (builder's call: their accounts never hold ids they don't own); `SeatInfo.custom` carries
  the owner's character id so the owner's client can recognise it.

## Left to the builder

- File layout and naming inside `packages/bots`; how seeded-deal regression fixtures are recorded.
- UI wording for each dial setting, within the meanings above.
- Exact sync conflict rules for characters (latest edit wins by an `updatedAt`, as results use `at`).
