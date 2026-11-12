# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The Cloudflare deployment serves the web app and online tables together at https://contractplay.niuk.workers.dev; the old GitHub Pages copy is no longer updated. Next is confirming the deployment with a real game and moving to `bridge.romaniuk.us`; then sign-in, permissions, invitations, and platform validation.

## Platform delivery

- [ ] Validate signed installers when platform certificates and developer accounts are available.
- [ ] On hold: iOS and iPadOS (the CI simulator build is switched off; an iPhone/iPad device or App Store build would follow if resumed).

## Scoring

- [x] Score solo play as rubber bridge by default, with single deals as an option.
- [ ] Decide whether online tables should also score rubbers; they keep running duplicate totals for now.

## Online multiplayer

- [x] Deploy the online tables to Cloudflare: live at https://contractplay.niuk.workers.dev; the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` are set, so pushes to `main` deploy automatically.
- [x] Add solo-style bidding, card-play, and call-meaning hints to online tables; suggestions use only the viewer's visible cards and public play.
- [x] Add a UI preview mode at `#/mocks` that steps through realistic lobby, seating, auction, declaring, dummy, defending, and result screens built from real table states, with tests that keep each screen in its state.
- [x] Play forced cards automatically (the only legal card) in solo and online play, with a setting to turn it off, and add Auto play so a bot plays the user's cards for the rest of the deal.
- [x] Add claims (all remaining or a number; humans accept or reject online, robots check with an exact search), a queued next card played when your turn starts, and card backs for hidden hands, with `#/mocks` screens for the claim answer and the queued card.
- [x] Gather online table controls into a collapsible game menu: Back to lobby, Take back (your last call or card, with any bot play since), Cancel this hand (host), and Leave the table at any time (a bot finishes the hand).
- [x] Add a development-only `/admin` page to list and remove listed or unlisted online tables; its open access must be replaced with RBAC before public production use.
- [ ] Repeat the two-window check on the deployed address and confirm the Workers free-plan CPU limit holds for bot decisions (if not, the paid Workers plan is the owner's decision).
- [ ] Offer online play in the desktop and iOS builds (allow the service address in the app's content security policy and add cross-origin access on the service).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer. A CNAME at Squarespace will not work; a Workers custom domain needs the zone on Cloudflare. Steps for the owner: add `romaniuk.us` to Cloudflare (Free plan) and check the imported records, especially email (MX, TXT); switch the name servers in Squarespace Domains to the two Cloudflare gives (registration stays at Squarespace); once active, add `bridge.romaniuk.us` under Workers & Pages → `contractplay` → Settings → Domains & Routes → Custom domain. Then record the custom domain in `apps/server` wrangler configuration so deploys keep it.
- [ ] Add sign-in (authentication) so a seat and hand history follow a person across devices.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
