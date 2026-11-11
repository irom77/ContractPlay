# Online tables

## Intent

ContractPlay is solo-only today. The owner wants bridge tables that live online, not on anyone's device: people open the app, see the tables, pick a seat, fill the remaining seats with other humans or with bots, and play. The first real use is the owner and their wife at one table from two devices, with bots as their partners or as their opponents. Later the same tables should take four humans, and later still sign-in, permissions, and invitations.

## Goals

- A lobby that lists open tables and lets anyone create one.
- A table with four seats, each empty, held by a human, or held by a bot at a chosen skill level. Any mix is allowed, from one human with three bots to four humans.
- Hand after hand of legal bridge at that table with a running score, using the shared rules in `packages/core` and the bots in `packages/bots`.
- Nobody can see cards they are not entitled to see, even by inspecting network traffic.
- A refresh, a dropped connection, or a service restart does not lose the table, the hand in progress, or a player's seat.
- One deployment on Cloudflare serves both the app and the tables.

## Non-goals (this project)

- Voice and video chat.
- Accounts, sign-in, permissions, and invitations. They are expected later; see "Room for later".
- Spectators. Someone who is not seated sees the seats and the score, never the cards.
- Hints, take-back, and PBN import at online tables. Solo play keeps all three unchanged.
- Chat, tournaments, duplicate movements, rating, timers.
- Pointing `bridge.romaniuk.us` at the service. It stays its own roadmap item; the service starts on the free Cloudflare address.
- Rate limiting and abuse controls beyond the basic limits listed below; the rest belongs to the production-readiness milestone.

## Anti-goals

- A player's device deciding anything about the game. The service holds the deal and is the only authority on what happened.
- Any message that contains a card its recipient may not see.
- Changing solo play. It must keep working offline, in the browser and in the desktop and iOS builds, exactly as now.
- A second copy of the bridge rules or the bot logic.

## Decided by the owner

- Tables are hosted online, not on a player's device.
- Humans and bots mix freely at a table; people connect, pick a seat, and start.
- Cloudflare only. The app moves off GitHub Pages so there is one deployment and one address.
- No accounts for now: a display name, remembered by the device.
- A public lobby, and every table has a link that can be sent to someone.
- No hints and no take-back online; a running score per table.
- Skip voice and video.

## How it works

### Identity

On first use of online play the app asks for a display name (1–20 characters) and creates a long random secret that it keeps in the device's local storage. The secret is sent when connecting and never shown or shared; the service stores only a hash of it and uses that hash as the player's id. The same device therefore gets its seat back after a refresh or reconnect. Clearing browser data or moving to another device loses the seat; that is accepted until sign-in exists.

### Lobby

The lobby shows each listed table: its name, who or what is in each seat, and whether a hand is in progress. Anyone can create a table, giving it a name, a bidding style for its bots (SAYC or 2/1), and whether it is listed in the lobby. An unlisted table is reachable only by its link. *(Unlisted tables are the designer's call, added so a private two-person game does not have to sit in a public list.)*

A table has a short id (for example six letters and digits) and a link of the form `<app address>/#/table/<id>`. Opening the link goes straight to that table.

### Seats

- Anyone at a table who is not seated can take an empty seat. A person holds at most one seat per table.
- Any seated human can set an empty seat to a bot and choose its skill level, change a bot's skill level, or clear a bot seat back to empty. This is allowed between hands; during a hand a bot seat can only be replaced as described under "Leaving and returning".
- A seated human can leave their seat between hands, which makes it empty.
- A hand can start when all four seats are filled and at least one is a human. Any seated human presses Deal. The same applies to the next hand after one finishes.
- A bot seat is never taken directly by a newcomer: a seated human clears it to empty first, and then anyone can sit. This keeps a stranger from the lobby from replacing a bot at someone's table. *(Designer's call.)*
- The first person to sit is the host; creation carries no identity. Between hands the host can remove any human from a seat. If the host's seat is freed or the host has been away for 10 minutes, the longest-seated human becomes host. *(Designer's call; it is also the hook for later permissions.)*
- Between hands, any seated human can free a seat whose player is away. This is how someone who lost their device secret, for example by switching from phone to tablet, gets back in: the old seat is freed and they sit again.
- All four seats are filled for the whole of a hand, so nobody can sit down mid-hand.

### Play

- The service shuffles and deals. Dealer rotates clockwise from north each hand, and vulnerability follows the standard 16-board cycle by hand number.
- Each seated human sees their own hand, the auction, the cards played, the trick counts, and dummy once the opening lead is made. When the hand ends, all four original hands are shown to everyone seated.
- Someone at the table who is not seated sees the table name, the seats, whether a hand is in progress, and the running score. They receive no auction, no played cards, and no hands, so watching cannot be used to pass information to a player. *(Designer's call: the strict reading.)*
- Declarer plays dummy's cards. A human dummy watches. When declarer is a bot it plays both hands; when declarer is a human and dummy is a bot, the human plays both.
- Bots act on the service, using `createBot` with the table's bidding style and the seat's skill level and the same public-information context solo play gives them, with a short pause (about a second) before each bot action so humans can follow.
- A completed trick stays visible briefly before the next lead, as in solo play.
- The table keeps running totals for North–South and East–West, adding each hand's score from `packages/core` scoring.
- When a hand ends, each seated human's app saves it to that device's existing hand history, so it can be reviewed and exported like a solo hand. *(Designer's call; everything needed is revealed at the end of the hand anyway.)*

### Actions and ordering

Every state of a table has a revision number that increases with each accepted change. A player's call or card is sent with the hand number and the revision it was chosen against. The service accepts it only if the sender holds the seat whose turn it is (or is declarer acting for dummy), the revision is current, and `packages/core` says the action is legal. Anything else is refused and answered with the current view, so a duplicate or late message cannot be applied twice or out of turn. The app shows a call or card as made only when the service confirms it.

### Leaving and returning

- If a seated human's connection drops, their seat stays theirs and is shown as away. The table waits for them on their turn.
- Any other seated human can hand an away seat to a bot so play continues. The original player gets the seat back as soon as they reconnect, taking over from the bot at its next turn.
- A seated human who is connected but has not acted for two minutes on their turn can be handed to a bot by the host, in the same way; they take the seat back by pressing a button. There are no automatic timers.
- A table with no human connected for 24 hours is deleted. A finished or idle table otherwise stays until then.

### Limits

Display names and table names are length-limited and stripped of control characters. Messages over a few kilobytes are refused. The number of listed tables is capped (for example 100) and creating beyond it is refused with a clear message.

## How it gets made (designer's calls)

- **Service:** a Cloudflare Worker with Durable Objects on the free plan: one object per table, holding that table's state and its live WebSocket connections, and one lobby object holding the table list. Table state is written to the object's storage on every accepted change, so it survives restarts. WebSocket hibernation is used so idle tables cost nothing. Lives in `apps/server`.
- **Same deployment serves the app:** the Worker's static-assets feature serves the built `apps/client` files; `/api/*` and the WebSocket endpoint go to the Worker code.
- **Shared message definitions:** a new `packages/protocol` with the typed messages between app and service, a protocol version sent on connect, and validation of everything the service receives. An app with an older protocol version is told to reload.
- **Table logic separate from Cloudflare:** seat handling, turn order, redaction, bot scheduling decisions, and scoring are written as plain, platform-neutral, immutable state transitions (state + event → new state + messages to send), in their own package or module, tested with Vitest without any Cloudflare runtime. The Durable Object is a thin shell that stores state, moves messages, and sets timers.
- **Redaction in one place:** a single function builds the view for a given seat (or for an unseated visitor) from the full table state. Nothing else produces outgoing game data.
- **App:** a "Play online" entry beside solo play, a lobby screen, and a table screen. The table screen should reuse the existing table presentation; `apps/client/src/App.tsx` is one large component today, so the table rendering needs to be separated from solo state first. Routing uses the URL hash so it works with the relative asset paths and inside the desktop and iOS shells.
- **Where the app finds the service:** same origin in the browser; a build-time setting gives the desktop and iOS builds the service address. Solo play must not depend on it. *(Deferred: desktop and iOS builds do not offer online play in the first release, because the app's content security policy and the service's cross-origin access do not allow it yet; the app hides online play in the native shell.)*
- **Deployment:** `wrangler` configuration in `apps/server`, a `pnpm` script to deploy, and a GitHub Actions workflow that deploys on pushes to `main` using a Cloudflare API token stored as a repository secret. The owner creates the free Cloudflare account and the token; the first deploy can be done from the owner's machine after `wrangler login`.
- **GitHub Pages:** Cloudflare is the only maintained web deployment. The existing Pages copy remains as-is and the Pages workflow is removed; no redirect is planned.

## Room for later

Not built now, but the design should not block them:

- **Sign-in:** the rest of the service only ever sees a player id. Replacing "hash of a device secret" with "verified account" should touch the connection step only.
- **Permissions and invitations:** tables already carry a host and a listed/unlisted flag; an invite-only table and seat-level permissions would extend that record.
- **Voice and video:** a table already has a set of connected, identified people to signal between.

## Testing

- Table logic: unit tests for seating, starting, turn order, declarer playing dummy, bot seats, stale and duplicate actions, away and return, score totals, and deal rotation.
- Privacy: for many random deals played through by bots, check after every step that the view built for each seat and for an unseated visitor contains no card that seat may not see.
- Protocol: malformed, oversized, and wrong-version messages are refused.
- Service: an integration test that runs the Worker locally with two or more WebSocket clients through create, sit, add bots, play a full hand, disconnect and reconnect mid-hand, and restart recovery.
- App: component tests for the lobby and the online table against a fake connection, and existing solo tests unchanged and passing.
- A manual check in two browser windows against the local service, then against the deployed address.

## Baseline

The bidding-system and play-level work described in `2026-11-10-bidding-system-and-play-levels-design.md` is finished and is the baseline for this project, including `playContextFor`, the extended `PlayContext`, and the current `apps/client/src/App.tsx`. It is not yet committed; it should be committed before this work starts so the two change sets stay separate.

## Risks to check early

- The free plan limits processing time per request. A bot's decision must fit comfortably; measure `createBot` call and card choices in the Worker runtime before building on it. If it does not fit, the fallback is the paid Workers plan (about $5 a month), which is the owner's decision.
- Measured (Task 1, 20 seeded deals, expert / 2/1, 1212 decisions, all `applyAction` results ok):
  - Workers runtime (`@cloudflare/vitest-plugin`, local workerd): max 5.000 ms, mean 0.041 ms. The runtime clock only advances in coarse steps during synchronous work, so the max is clock granularity, not a real figure; the whole test took about 85 ms for 1212 decisions.
  - Plain Node 24: max 6.9 to 7.8 ms, mean 0.045 ms, total about 65 ms. The max is the very first decision (cold JIT); the next slowest are 4.3 ms, 1.3 ms, 1.0 ms. Steady state is well under 5 ms, but the cold first decision exceeds the 5 ms stop threshold, so confirm against the free plan's CPU limit with a deployed Worker before relying on it (owner decision on the paid plan).
- `packages/bots` and `packages/core` must run in the Worker runtime without Node-only APIs; verify with a local run first.

## Left to the builder

Exact message shapes, package and file names, table id format, pause lengths, the lobby's refresh mechanism, and the look of the lobby and seat controls, following the existing visual style.
