# ContractPlay roadmap

Completed checklist history is in [TODO-archive.md](TODO-archive.md).

Status follows the app-wide plan in [`docs/superpowers/plans/2026-10-25-contractplay-app.md`](docs/superpowers/plans/2026-10-25-contractplay-app.md).

## Current focus

The core rules, PBN package, and solo client are in place, and the solo app roadmap is complete. Beginner through Expert bots are selectable and differ in both bidding and card play: Beginner bids constructively and answers partner; Intermediate competes with overcalls, takeout doubles, and preempts; Advanced balances, reopens, opens light in third and fourth seat, draws trumps, and ruffs; Expert adds Gerber, splinters, Reverse Drury, Lebensohl, and counts winners in the play. SAYC and 2/1 share one agreement layer that reads every auction from the opening bid, with separate responses where the systems differ. Switchable hints suggest a call or card with a reason and explain the meaning of calls. The web app is deployed to GitHub Pages. Online tables (lobby, four seats with humans and bots, server-authoritative play, private hands, reconnect and recovery, guest identity only) are built and tested locally but not deployed. Next is deploying them to Cloudflare, confirming the first deployment, and switching GitHub Pages to a redirect; then sign-in, permissions, invitations, and platform validation.

## Platform delivery

- [ ] Validate signed installers and an iPhone/iPad device or App Store build when platform certificates, developer accounts, and devices are available.

## Online multiplayer

- [ ] Deploy the online tables to Cloudflare (owner account and `wrangler login`; `pnpm run deploy`), confirm the Workers free-plan CPU limit against bot decisions and repeat the two-window check on the deployed address, add the repository secrets for the deploy workflow, then switch GitHub Pages to a redirect.
- [ ] Offer online play in the desktop and iOS builds (allow the service address in the app's content security policy and add cross-origin access on the service).
- [ ] Set up `bridge.romaniuk.us` as the public address for online multiplayer (domain managed by the project owner; it must use Cloudflare name servers to be a Workers custom domain).
- [ ] Add sign-in (authentication) so a seat and hand history follow a person across devices.
- [ ] Add permissions (authorization) beyond the current host and seated-player rules.
- [ ] Add invitations to a table.
- [ ] Add basic optional voice and video chat for players at a table.

## Production readiness

- [ ] Add abuse controls for online tables beyond the per-address limits (for example reporting, blocking, rate limits on table actions, and name moderation).
- [ ] Add accessibility review, security controls, observability, backups, and release automation.
- [ ] Complete cross-platform regression checks and release runbooks.
