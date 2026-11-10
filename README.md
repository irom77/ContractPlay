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

ContractPlay currently provides a responsive browser table for local deals, configurable bots, PBN import/export, autosaved play, take-back, hand review, and hints. With the Hints switch on, the table shows your high-card points, the suggested call or card with a reason, and the meaning of any call you click.

Windows and macOS installer builds and an iOS app build/install/launch on an iPad simulator have passed on GitHub Actions. First GitHub Pages deployment and signed or physical-device builds remain pending their documented setup steps. Online multiplayer and complete SAYC and 2/1 agreements remain planned. See the [platform delivery guide](docs/platform-delivery.md), [roadmap](TODO.md), and [change history](CHANGES.md).

## Project structure

```text
apps/client/          React and Vite browser client
apps/client/src-tauri/ Tauri host for desktop and iOS/iPadOS
packages/core/        Platform-neutral cards, rules, and game state
packages/pbn/         PBN parser, serializer, and diagnostics
packages/persistence/ Versioned local game storage
packages/bots/        Bidding and card-play strategies
docs/superpowers/     Feature plans and specifications
```

The core package owns legal actions and immutable game transitions. PBN, persistence, bots, and the client build on its shared types and APIs.

## Bots

Choose Beginner, Intermediate, Advanced, or Expert play, and configure SAYC or 2/1 bidding. The beginner bot covers opening bids and common uncontested and competitive auctions. Intermediate adds natural overcalls, weak three-level openings, major game raises and qualified 3NT placement over them, takeout doubles, and card-play tactics; Advanced adds a third-hand honor play; Expert adds selected conventions and slam tools. Convention coverage is still limited; see [TODO.md](TODO.md) for exact scope.

Hints are off by default. Suggestions are the Expert bot's choice in the selected bidding style, based on standard technique and not on seeing all four hands, so they can be wrong. Call meanings cover common SAYC and 2/1 situations and fall back to a plain natural description elsewhere. If a host supplies a solver, card hints show its legal recommendations instead.

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
