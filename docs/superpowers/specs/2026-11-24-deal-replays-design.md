# Deal replays — design

Date: 2026-11-24. Status: draft for owner approval.

## Intent

Players want to compare themselves with other people who held the same cards, the way Shark Bridge does, without having
to organise a duplicate session. So every second hand comes from the archive of deals played at least a day ago, and when it ends the
player sees how their score compares in IMPs with everyone who played that deal before.

## Goals

- Every finished hand, solo or online, is kept in a server-side archive of deals and results.
- Every second hand (a table's 2nd, 4th, 6th, …) is a replay: a random archived deal first played at least 24 hours ago.
- When a replayed hand starts, everyone at the table is told it is a replay, with the original date and time, and
  that some of them may have played it before.
- When a replayed hand ends, the result panel shows:
  - the headline: IMPs against the average of all earlier results (the Butler datum, `compareWithField` method `butler`);
  - the original result next to the player's own (contract, declarer, tricks, NS score, date);
  - every earlier result of the deal.
- Both solo and online tables replay, in every scoring mode except duplicate sessions, including rubber (the default).

## Rubber (owner's decision: replay in rubber too)

In rubber the vulnerability comes from games won, so a replay can't always use the original's. A replayed rubber hand
keeps the archived deal and dealer but plays and scores at the rubber's own vulnerability. Every earlier result is
rescored at that vulnerability from its contract, declarer and tricks (core `scoreContract`) before the IMP comparison,
and the result panel says "Earlier results rescored at your vulnerability" when any were. The rubber's dealer
rotation carries on from the next hand.

## Non-goals

- No player names, ids or table ids in the archive. Results are anonymous.
- No dedupe against deals a player has already seen. Repeats are allowed; the start notice warns about them.
- No replays in duplicate sessions (they have their own fixed board set).
- No browsing or searching the archive in the app in this change.

## Anti-goals

- Revealing earlier results before or during the replayed hand. Online views carry the field only once the hand is over.
- Breaking solo when the server is unreachable (offline, native build, local dev without the Worker): solo falls back
  to a fresh shuffle with no notice, and an unsent result is dropped, not retried forever.
- Trusting a solo client's score. The server recomputes every submitted score from the actions. Claims are the one
  gap: core accepts any claimed trick count, and the double-dummy solver runs only in the browser. *Builder's call:*
  claimed results are accepted and stored with a `claimed` flag (kept in the datum) so they can be filtered later.

## Constraints

- Cloudflare free tier: D1 5 GB storage, 5M rows read and 100k rows written a day. Choosing a replay must not scan
  the whole archive (`ORDER BY RANDOM()` reads every row), so choose by a random rowid probe on an index.
- Bridge rules come from `packages/core`; the server validates actions with `applyAction` and scores with core.
- `CLAUDE.md`: previews in `#/mocks` for the new states, focused tests, and TODO/CHANGES/README kept current.

## Approaches

1. **Two new D1 tables in `contractplay-auth` (chosen).** The table server records online results itself and picks
   online replays. Solo uses two small HTTP calls. Queryable with `wrangler d1 execute`, inside free limits.
2. A single archive Durable Object with its own SQLite. Every write goes through one object, there is no ad-hoc query
   path, and it gains nothing over D1.
3. An external free database (Supabase, Turso). Another account and secret, plus a slower round trip from the
   Worker, for nothing D1 lacks.

Owner picked 1.

## Design

### Storage (migration `0003_deal_archive.sql`)

```sql
CREATE TABLE archived_deals (
  id TEXT PRIMARY KEY,                 -- random id
  deal_key TEXT NOT NULL UNIQUE,       -- canonical cards + dealer, so one deal is archived once
  deal_json TEXT NOT NULL,             -- Deal
  dealer TEXT NOT NULL,
  vulnerability TEXT NOT NULL,        -- as first played
  first_played_at INTEGER NOT NULL,
  original_actions_json TEXT NOT NULL  -- the first play's GameAction[], for "View original"
);
CREATE INDEX archived_deals_age ON archived_deals(first_played_at);
CREATE TABLE deal_results (
  deal_id TEXT NOT NULL REFERENCES archived_deals(id) ON DELETE CASCADE,
  played_at INTEGER NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('solo', 'online')),
  vulnerability TEXT NOT NULL,         -- as this result was played (rubber replays may differ from the deal's)
  contract TEXT NOT NULL,              -- PBN text: "4S", "3NTX", "Pass"
  declarer TEXT,
  tricks INTEGER,
  ns_score INTEGER NOT NULL,
  claimed INTEGER NOT NULL DEFAULT 0   -- 1 when the hand ended in a claim
);
CREATE INDEX deal_results_deal ON deal_results(deal_id, played_at);
```

The original result is the earliest row for the deal. A passed-out hand is recorded as `Pass`, NS 0.

### Recording a result

- A shared server module (`apps/server/src/deal-archive.ts`) does `record({ deal, dealer, vulnerability, actions,
  source, playedAt, replayOf? })`. It replays the actions with core from the deal; it rejects anything that is not a
  legal, finished (complete or passed-out) hand; it scores with core. If `replayOf` is given, the result goes on that deal
  after checking the cards match. Otherwise it inserts the deal (or finds it by `deal_key`) and adds the result.
- **Online:** `TableObject` calls it when a hand reaches complete/passed-out, next to `reportFinishedSessionHand`,
  for every table except duplicate-session tables. A failed write logs and moves on (the hand is not blocked).
- **Solo:** `POST /api/deals/results` with `{ deal, dealer, vulnerability, actions, replayOf? }`. There is no sign-in,
  and it is rate-limited per address through the existing `auth_rate_limits` table with its own key prefix.

### Choosing a replay

- `pickReplay(now, vulnerability?)`: a random archived deal with `first_played_at <= now - 24h`, via a random rowid probe, or none.
- Returns a `HandRecord`: deal, dealer, vulnerability, `scoring: "IMP"` (so `fieldMethod` gives `butler`), `event: "Replay"`,
  `original` = the first play's actions, and `field` = every result as `TravellerRow`s. Also returns `dealId` and
  `firstPlayedAt`. With a target vulnerability (rubber), the record carries it and the field is rescored to it by a
  core helper `rescoreField`; without one the deal's own vulnerability applies, and results played at another one are
  rescored to it.
- **Online:** in `TableObject.dispatch`, a `deal` message on an even `handNumber + 1` at a non-session table
  fetches a replay before reducing and passes it in the same way as `sessionBoard` (a new `replayBoard` on
  `TableState`). `dealHand` then uses its deal and dealer, and its vulnerability except at a rubber table, which
  keeps the rubber's. With no replay available it deals fresh.
- **Solo:** `GET /api/deals/replay` (rate-limited) returns the same record. Solo counts the new hands it starts
  (persisted with the solo data); on every second one it asks for a replay (passing the rubber's vulnerability in rubber scoring) and otherwise
  shuffles. Imported, board-set and "Play this deal again" hands do not count and are not archived, and neither are
  hands played with "play against bots" off (one person seeing all four hands). *Builder's call.*
- **Solo gets the record up front** (*builder's call*): the replay response carries the full record, so the comparison
  still works if the result post later fails. A solo player could peek at it; that's acceptable for a solo game.
- **Field size** (*builder's call*): the record groups identical results into one row with a count
  (`TravellerRow.multiplicity`) and holds the original plus at most the 50 most recent other results. The datum is the
  average of what the record holds. This keeps views and saved hands well under the 64 KB saved-hand sync limit.

### What players see

- **Start notice**, on every seat and observer, solo and online: "Replayed deal · first played 12 Nov 2026, 14:32 ·
  some of you may have played it before." (solo: "you may have played it before"), with the time in the viewer's
  local zone. It stays in the status area for the hand.
- **Online view:** `TableView.replay = { firstPlayedAt }` during the hand. Once the hand is over it gains `record`
  (the `HandRecord` above, without the hand just played).
- **End of hand:** `FieldResult` with the record. The headline reads "+3 IMPs against a datum of NS +450". Above the table
  sits a new "Original: 4♠ by S · 10 tricks · NS +620 · 12 Nov 2026" line, and the list holds all earlier results.
  Online shows it from the viewer's partnership (observers: NS); this is new to `OnlineTable`.
- **View original** stays solo-only in this change; online views omit `original`. *Builder's call.*
- **Saved hands:** a replayed hand saved to Recent hands keeps its record, so the comparison can be reviewed later.

### Previews and docs

- New `#/mocks` scenarios: solo replay start notice, solo replay result, online replay result. Tests expect them;
  the README preview table is updated.
- TODO, CHANGES, README (replays, archive, anonymity), `docs/platform-delivery.md` (the migration step).

## Addendum (2026-11-24, after merge): separate pools

A security review found that a single shared pool let anyone call the public solo routes to collect deals (all four
hands) that an online table might later replay, or to plant a deal of their own. Owner's decision: separate pools.
`archived_deals` has `pool` (`solo` | `online`, where the deal was first played) with `UNIQUE (pool, deal_key)`;
online tables replay only `online` deals, solo routes serve and add to only `solo` deals, and `replayOf` must name a
deal in the caller's pool. Solo and online results are therefore never compared on the same deal.

## Left to the builder

- The rowid-probe query and how it retries when it lands on an ineligible row.
- Exact rate limits (suggested 120 result posts and 60 replay requests per address per hour).
- Notice placement and styling in each layout, within the existing status card.
- Whether to seed the archive from the two distinct deals already in `online_hands` (a one-off script is optional).
