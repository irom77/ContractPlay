> ## 🔍 UI previews: every major screen without playing a hand
>
> Open **[`#/mocks`](https://contractplay.niuk.workers.dev/#/mocks)** on the live site, or `http://localhost:5173/#/mocks` after `pnpm web:dev` (`http://localhost:8787/#/mocks` after `pnpm server:dev`). One screen fills the window at a time, so you see the layout exactly as players do.
>
> | # | Screen | # | Screen |
> |---|---|---|---|
> | 1 | Lobby | 13 | Hand result |
> | 2 | Seating | 14 | Rubber score |
> | 3 | Auction: your call | 15 | Solo: new deal |
> | 4 | Auction with hints | 16 | Solo: your call against bots |
> | 5 | Declaring 4♠ with dummy | 17 | Solo: declaring against bots |
> | 6 | Dummy playing for a bot declarer | 18 | Solo: auto play |
> | 7 | Defending, dummy on your left | 19 | Solo: claiming |
> | 8 | Defending, dummy on your right | 20 | Solo: game menu |
> | 9 | Card queued | 21 | Solo: settings |
> | 10 | Game menu | 22 | Solo: recent hands |
> | 11 | Auto play | 23 | Solo: hand result with rubber score |
> | 12 | Claim waiting on you | 24 | Solo: reviewing a saved hand |
>
> - **Step through:** the ‹ and › buttons in the bar at the bottom, or the ← and → keys. The address changes to `#/mocks/N`, so any screen can be bookmarked or linked directly, for example [`#/mocks/7`](https://contractplay.niuk.workers.dev/#/mocks/7).
> - **Inspect without the bar:** × hides it; the small `N/24` button brings it back. **Exit** returns to the app.
> - **Nothing is played or saved:** the screens are look-only. Clicks go nowhere, and names, hints, and hand history stay out of the browser's storage.
> - **Always current:** each screen is a real table state built with the same rules engine and reducer the server runs, projected with the server's `viewFor`, and drawn by the real `Lobby` and `OnlineTable` components; the solo screens (15–24) open the real solo app on a fixed hand with bots, forced cards, and queued cards held still. Layout and component changes appear in the previews automatically. `apps/client/src/mocks/Previews.test.tsx` checks that every screen still reaches its state (for example, that dummy is on your left in screen 7), so a change that breaks one fails `pnpm test`.
> - **Adding a screen:** add an entry to `previewScreens` in [`apps/client/src/mocks/scenarios.ts`](apps/client/src/mocks/scenarios.ts) and its expectation in `Previews.test.tsx`.

<p align="center">
  <img src="docs/contractplay-logo.svg" alt="ContractPlay — play, learn, and review contract bridge" width="520" />
</p>

<h1 align="center">ContractPlay</h1>

<p align="center">Play, learn, and review contract bridge.</p>

<p align="center">
  <img src="docs/screenshots/bidding.png" alt="Bidding: each player's calls sit beside their seat, with the bidding box in the middle of the table" width="49%" />
  <img src="docs/screenshots/play.png" alt="Card play: contract, trick count, dummy, the current trick and the last trick on one screen" width="49%" />
</p>
<p align="center">
  <img src="docs/screenshots/hints.png" alt="Hints switched on: high-card points, the suggested bid highlighted with its meaning, and an opponent's bid explained" width="49%" />
</p>

---

## Status

ContractPlay currently provides a responsive browser table for local deals, configurable bots, PBN import/export, autosaved play, take-back, named hand history and review, hints, and, once the service is deployed, online tables. Solo and online tables share one game menu (☰, top right): Claim, **Take back** (your last call or card), and **Auto play this hand**, which lets a bot make your calls and play your cards until the deal ends (in the auction or the play), then gives them back. Its banner sits clear of every hand (top-right, under the menu and last trick), can be dragged anywhere on the table, and has **Stop auto play**. Rubber tables, solo and online, add **Rubber score** with the scoresheet; solo play also adds Settings, Recent hands (review, export, and PBN import), About, and Deal a new hand to the same menu; there is no Redo. A card that is your only legal play (a singleton in the led suit, or your last card) is played for you after a short pause; turn this off with "Play forced cards automatically" in the deal settings. You can claim the remaining tricks on your turn, either all of them or a number: against robots they check the claim with an exact search, online every human opponent must accept it, and a claimed hand is saved, reviewed, and exported to PBN with its result. While another player is to act you can click one of your cards (or dummy's, if you control it) to queue it; it plays half a second after your turn starts if still legal, and clicking it again unqueues it. Seats whose cards you cannot see show one card back per card held, during card play. With the Hints switch on, the table shows your high-card points, the suggested call or card with a reason, and the meaning of any call you click.

Windows and macOS installer builds pass on GitHub Actions. iOS and iPadOS are paused: the Tauri host still supports them, but CI no longer builds them (see the [platform delivery guide](docs/platform-delivery.md) to resume). The web app and online tables are deployed together to Cloudflare at https://contractplay.niuk.workers.dev. The old GitHub Pages copy has no online entry and is no longer updated. Signed and physical-device builds remain pending their documented setup steps, and `bridge.romaniuk.us` is not set up. Voice and video chat remain planned. See the [platform delivery guide](docs/platform-delivery.md), [roadmap](TODO.md), and [change history](CHANGES.md).

## Project structure

```text
apps/client/          React and Vite browser client
apps/server/          Cloudflare Worker that serves the client and runs online tables
apps/client/src-tauri/ Tauri host for desktop (and iOS/iPadOS, paused)
packages/core/        Platform-neutral cards, rules, and game state
packages/pbn/         PBN parser, serializer, and diagnostics
packages/persistence/ Versioned local game storage
packages/bots/        Bidding and card-play strategies
packages/protocol/    Messages shared by the client and the online service
packages/table/       Online table rules: seats, host, presence, scoring totals
docs/superpowers/     Feature plans and specifications
```

The core package owns legal actions and immutable game transitions. PBN, persistence, bots, and the client build on its shared types and APIs.

## Bots

Choose Beginner, Intermediate, Advanced, or Expert play, and configure SAYC or 2/1 bidding. All levels share one set of partnership agreements: opening bids, notrump structures, strong 2♣ and weak twos, major-suit raises with Jacoby 2NT, fourth suit, Blackwood, and game-forcing 2/1 sequences, with answers to partner's doubles, overcalls, and forcing bids. Beginner bids constructively and does not start competitive action. Intermediate adds overcalls, takeout doubles, preempts, and action over the opponents' preempts and 1NT. Advanced adds balancing, reopening doubles, and light third- and fourth-seat openings, and in the play draws trumps, ruffs, and plays third hand high. Expert adds Gerber, splinters, Reverse Drury, and Lebensohl, and in the play cashes established winners and protects them when discarding. Bots use standard technique and do not see hidden hands, so they still make mistakes; rarer conventions and advanced card play such as squeezes and endplays are not covered.

Hints are off by default. Suggestions are the Expert bot's choice in the selected bidding style, based on standard technique and not on seeing all four hands, so they can be wrong. Call meanings cover common SAYC and 2/1 situations and fall back to a plain natural description elsewhere. If a host supplies a solver, card hints show its legal recommendations instead.

## Online tables

Online tables let four people, with bots filling any empty seats, play one table together. They are live at https://contractplay.niuk.workers.dev. To try them locally, run `pnpm server:dev` and open http://localhost:8787.

- **Lobby.** The lobby lists open tables. A table can be unlisted and then is reachable only by its link, `<address>/#/table/<id>`. There are no accounts: you choose a display name (1-20 characters), and the browser keeps a device secret in local storage that the service stores only as a hash. Clearing browser data or switching device loses your seat.
- **Seats.** Each of the four seats is empty, a person, or a bot at a skill level you choose. A hand needs all four seats filled and at least one person. The first person to sit is the host and can remove a person between hands; any seated person can free an away player's seat between hands. A newcomer can only take an empty seat.
- **Play.** The service shuffles with a cryptographically secure generator and enforces every action with the same rules as the solo app. Each player receives only their own cards, dummy after the opening lead, and every hand when the hand ends; when Declarer is a bot, a present human partner in dummy controls both declaring-side hands. Someone not seated sees seats and score only. **Claims:** on their turn, whoever controls the hand to act (the declarer for both declaring hands, a defender for their own) can claim "all remaining" or a number of the remaining tricks. Every human opponent must Accept; one Reject cancels it. A robot opponent accepts only when an exact search proves the claim, and rejects if the search cannot finish. The claimer can withdraw. While a claim is pending, play stops and the claimer's hand is shown to the opponents only (not to partner). After a rejection or withdrawal that side cannot claim again until the trick ends, and answers carry the claim's id, so a stale answer is ignored. The accepted claim ends the hand, and the result reads for example "Claimed by South (declarer): 3 of the remaining 4 tricks". Online tables use protocol version 4. Bots act on the service after about a second. **Scoring:** a new table scores rubber bridge unless its creator chooses running totals. At a rubber table the dealer rotates from North, vulnerability follows games won, each played hand goes on the rubber scoresheet (passed-out and cancelled hands score nothing), the result shows the hand's points above and below the line with the scoresheet, and the deal after a won rubber starts a new one; **Rubber score** in the game menu shows the sheet at any time, and the seating screen shows it between hands. A running-totals table (and any table made before rubber scoring) keeps board-style dealer and vulnerability rotation and credits each hand's points to the side that scored them.
- **Hand result.** When a hand ends, all 52 cards stay on the table face-up at their seats, each hand with its high-card points, and the contract, outcome, score, table totals, and **Deal** sit in the middle. **Seating** (also in the game menu) switches to the seat controls for changes before the next deal; **Show the hands** switches back. Solo hands end the same way, around the solo score panel.
- **Away players.** The seat waits. Another seated player can hand it to an Intermediate bot, and the player takes it back on return. The host can hand a present but idle player to a bot after two minutes.
- **History.** Finished online hands are saved to the device's hand history for review and PBN export; passed-out hands are not saved.
- **Development admin.** Visit `/admin` on the Cloudflare-hosted app to see listed and unlisted tables and remove a table. This page and its API are currently open without sign-in; add RBAC before public production use.
- **Not available online:** accounts or sign-in, chat, voice or video, take-back, and PBN import.
- **Hints.** The Hints switch is off by default and remembered on the device. It shows high-card points and an Expert suggestion with a reason on your turn, and lets you click any auction call to see its meaning. Hints use only your visible hand, the public auction and play, and dummy once exposed.
- **Limits.** At most 100 listed and 400 unlisted tables; each public IP address can create 10 tables in any rolling 60-minute window. This limit is shared by everyone using the same public IP, and removing a table does not restore a creation. At most 32 identified connections per table; at most 8 connections per network address per table; at most 16 unidentified connections per table and 2 per address, each closed after 10 seconds. A table nobody ever joined is removed after 10 minutes, and any table after 24 hours with no person connected.

In the app, online play is reached from "Play online" on the start screen and "Online tables" in the game menu. Both are hidden when the app has no service address. The Cloudflare deployment serves the app and tables from one address, so it uses its own origin. The old GitHub Pages copy was built with `VITE_ONLINE_URL=none` and has no online entry; it is no longer updated. Online play is available in the web app only for now: desktop and iOS builds do not show it. Enabling it there needs the service address allowed in the app's content security policy and cross-origin access on the service, which is planned.

## Development

Requires Node.js 20 or later and pnpm.

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

Start the browser client with:

```sh
pnpm web:dev
```

Verify the static web package and build native desktop installers with:

```sh
pnpm web:verify
pnpm tauri:dev
pnpm tauri:build
```

The browser and native clients store the current hand and up to 25 completed hands locally. PBN deals can be pasted or imported from a file, and completed hands can be exported as PBN. See the [platform delivery guide](docs/platform-delivery.md) for iOS/iPadOS simulator builds, deployment, and signing requirements.

## Project guidance

- [AGENTS.md](AGENTS.md) contains shared project instructions.
- [CLAUDE.md](CLAUDE.md) and [GEMINI.md](GEMINI.md) mirror those instructions.
- Record roadmap changes in `TODO.md` and meaningful user-facing changes in `CHANGES.md`.

## License

MIT. See [LICENSE](LICENSE).
