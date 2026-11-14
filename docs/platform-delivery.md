# Platform delivery

ContractPlay ships one React/Vite client to the web and through a Tauri 2 host to Windows, macOS, iOS, and iPadOS. The native host uses OS file pickers for PBN import/export and limits file-system access to files selected in those dialogs. Game state is autosaved to local storage after each game change and flushed when the app is hidden or closed.

## Build locally

Install the workspace dependencies with `pnpm install --frozen-lockfile`.

### Web

- Start development with `pnpm web:dev`.
- Build and verify the static package with `pnpm web:verify`.
- The output is `apps/client/dist`; relative asset paths allow hosting at a domain root, a repository subpath, or in Tauri.
- GitHub Pages is no longer deployed by this repository. Its existing static copy at https://irom77.github.io/ContractPlay/ has no online entry and is not updated. To use another static host, deploy `apps/client/dist`.

### Windows and macOS

> **On hold.** Windows and macOS builds are on hold and will probably be deprecated; the web app at https://contractplay.niuk.workers.dev is the supported way to play. The steps below are kept for reference.

Install Rust stable and the Tauri platform prerequisites, then run:

```sh
pnpm tauri:dev
pnpm tauri:build
```

On Windows, install Microsoft C++ Build Tools with the **Desktop development with C++** workload and ensure WebView2 is available. Building MSI installers may also require the optional VBScript Windows feature; NSIS installers do not. On macOS, install Xcode or its command-line tools for desktop builds. CI builds Windows MSI and NSIS installers and macOS app and DMG bundles on their respective runners; successful builds are retained as workflow artifacts.

### iOS and iPadOS

iOS builds require macOS, full Xcode, CocoaPods, and the Rust Apple targets. Generate the Xcode project and run on a simulator or a connected device with:

```sh
pnpm --filter @contractplay/client exec tauri ios init
pnpm --filter @contractplay/client exec tauri ios dev
```

The CI workflow has a job that builds an iOS simulator app, installs it on an available iPad simulator, launches it, and uploads the app bundle and screenshot. It is on hold (`if: false` in `.github/workflows/ci.yml`) while iOS and iPadOS are not being pursued. iPadOS uses the same universal iOS app target; there is no separate iPadOS package. A real iPhone/iPad run is still needed before public release.

For a device or App Store package, build on macOS with an Apple signing identity and provisioning profile, for example:

```sh
pnpm --filter @contractplay/client exec tauri ios build --target aarch64 --export-method app-store-connect
```

The CI simulator build does not require Apple signing credentials. Device installation, TestFlight, and App Store distribution do.

## Online tables on Cloudflare

Online tables run on a Cloudflare Worker in `apps/server`. The Worker serves the built web client from `apps/client/dist` and runs the tables and the lobby as Durable Objects (SQLite-backed). The service is live at https://contractplay.niuk.workers.dev. Cloudflare is the only maintained web deployment.

### Deployment

Pushes to `main` trigger the Cloudflare workflow. It installs dependencies, verifies and builds the web app, then deploys the Worker. The repository's GitHub Actions secrets provide the Cloudflare credentials; keep them out of source control. For a manual deployment, run `pnpm run deploy` from the repository root (plain `pnpm deploy` is a different, built-in pnpm command).

Before pushing a release to `main`, run `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm web:verify`. The deploy workflow does not apply D1 migrations or configure mail: complete the prerequisites below before deploying the sign-in feature. `/admin` and its API remain open without authentication; authorization is separate required work before public production use.

Use `pnpm --filter @contractplay/server exec wrangler deploy --dry-run` (after `pnpm build`) to check that the configuration bundles without deploying.

### Email sign-in prerequisites

The production D1 database is provisioned and its migrations are applied. Sender configuration and live email delivery still need verification. All commands below run from the repository root and use `apps/server/wrangler.jsonc` through the server workspace.

1. **Create and bind D1.** Authenticate Wrangler to the intended Cloudflare account, then create the database:

   ```sh
   pnpm --filter @contractplay/server exec wrangler d1 create contractplay-auth
   ```

   Copy the actual returned `database_id` into the existing `d1_databases` entry in `apps/server/wrangler.jsonc`. Keep `binding: "DB"`, `database_name: "contractplay-auth"`, and `migrations_dir: "migrations"`; do not add a second binding or invent an ID. The production database is now bound in the checked-in config. If the database already exists, get its ID with `pnpm --filter @contractplay/server exec wrangler d1 info contractplay-auth` instead of creating another. See [D1 commands](https://developers.cloudflare.com/d1/wrangler-commands/).

2. **Apply migrations explicitly.** Local migrations prepare the development database; remote migrations prepare the bound production database. `--remote` changes production data, so confirm the selected account and real binding first. Wrangler tracks applied files; deploy alone does not apply them.

   ```sh
   pnpm --filter @contractplay/server exec wrangler d1 migrations apply contractplay-auth --local
   pnpm --filter @contractplay/server exec wrangler d1 migrations apply contractplay-auth --remote
   ```

3. **Set the app origin.** `vars.AUTH_PUBLIC_ORIGIN` is currently `https://contractplay.niuk.workers.dev`. It must match the browser app's exact HTTPS origin, with no path, query, or fragment. Change it when enabling a custom domain; old-host sessions do not transfer across origins. Keep `AUTH_ALLOW_INSECURE_LOCALHOST` unset in production.

4. **Choose one mail provider and an approved sender.** Set `vars.AUTH_EMAIL_FROM` to a sender your provider permits. No sender is supplied by the repository, and a `workers.dev` app hostname is not a sending domain.

   - **Cloudflare Email Service:** arbitrary-recipient mail requires **Workers Paid** and an **onboarded sending domain using Cloudflare DNS**. Complete the provider's sender/DNS verification, then add `"send_email": [{ "name": "EMAIL" }]` at the top level of Wrangler configuration. This binding needs no mail API secret. Verified-destination testing on Free does not establish public-recipient readiness. See [plans](https://developers.cloudflare.com/email-service/platform/pricing/), [domain onboarding](https://developers.cloudflare.com/email-service/get-started/send-emails/), and [binding API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/).
   - **Resend fallback:** omit the `EMAIL` binding, verify an owned sending domain with Resend, set `vars.AUTH_EMAIL_PROVIDER` to `"resend"`, and set `vars.AUTH_EMAIL_FROM` to an approved address. Store the API key interactively as a Worker secret:

     ```sh
     pnpm --filter @contractplay/server exec wrangler secret put RESEND_API_KEY
     ```

     The adapter sends `{ from, to, subject, text }` to Resend's fixed HTTPS `/emails` endpoint using the secret. `EMAIL` takes precedence whenever present; a Cloudflare send failure does not automatically retry through Resend. See [domain verification](https://resend.com/docs/dashboard/domains/introduction) and [send API](https://resend.com/docs/api-reference/emails/send-email).

Keep provider keys and Cloudflare credentials out of tracked files and Wrangler `vars`. Magic-link/session values are generated at runtime; there is no additional signing-key secret to configure. The app deliberately returns the same check-email response for known/unknown addresses, throttled requests, and delivery failures, so that message alone is not a delivery check.

For local full-stack sign-in, apply local migrations, then put `AUTH_PUBLIC_ORIGIN=http://localhost:8787` and `AUTH_ALLOW_INSECURE_LOCALHOST=true` in ignored `apps/server/.dev.vars`. Set the approved sender and, if using Resend, provider/key there too; never commit that file. Run `pnpm server:dev` and use `http://localhost:8787` consistently. The static Vite server alone does not serve the auth APIs. Configured Resend development requests send real mail; opening their link must use the same local app origin.

After configuration and a checked deployment, verify real email receipt, one-time link use, reload/session restoration, linked guest seat recovery from a second browser, archive sync, and sign-out. Open emailed links in the browser you intend to sign in. Account archives retain 25 online hands; uploads are personal, noncompetitive records. Deleting a hand currently clears only local cache and sync restores its server copy. Solo hands, settings, board sets, and unfinished solo play do not sync. Do not mark live setup complete until these checks pass.

### Deploying from GitHub Actions

`.github/workflows/deploy-cloudflare.yml` runs on pushes to `main` and by manual dispatch. It installs, runs `pnpm web:verify`, and runs `wrangler deploy` in `apps/server`. Until the token secret exists the deploy step is skipped with a notice, so the workflow still passes. Pull requests do not trigger it, and the job runs only from `main`, so a manual run from another branch does nothing. It also skips the deploy, with a notice naming the missing secret, unless both secrets below are set.

To enable it:

1. In the Cloudflare dashboard, open **Account API tokens**, choose **Create Token**, and under **Permission policies** select the **Edit Cloudflare Workers** template. Scope it to the one account, and name it for this repository.
2. Add two repository secrets under **Settings -> Secrets and variables -> Actions**: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (shown in the dashboard). Never commit either value.

Cloudflare also publishes an official `cloudflare/wrangler-action`; this workflow runs `wrangler deploy` directly with the two environment variables instead, which Cloudflare's CI documentation describes.

### Service address; desktop and iOS builds

The Cloudflare deployment serves the app and the tables from one address, so the web app uses its own origin as the service address. The old GitHub Pages copy has no online entry because it was built with `VITE_ONLINE_URL=none`.

Online play is available in the web app only for now; desktop and iOS builds do not show it. The app recognizes the native shell and hides the online entries there whatever `VITE_ONLINE_URL` says (on Windows the shell serves the app from an http address, `http://tauri.localhost`, which is not the service). Enabling it needs the service address allowed in the app's content security policy (`connect-src` in `apps/client/src-tauri/tauri.conf.json`) and cross-origin access on the service, which is planned.

### Free-plan limits

The Worker uses SQLite-backed Durable Objects, the only kind available on the Workers Free plan. Cloudflare's published free-plan limits include 100,000 Worker requests per day, 100,000 Durable Object requests per day, 100,000 SQL rows written per day, and 10 ms of CPU time per Worker invocation. Check Cloudflare's pricing and limits pages for current values. The 10 ms CPU limit must be confirmed on the first real deployment against bot decisions, which are measured in the [design](superpowers/specs/2026-11-10-online-tables-design.md) under "Risks to check early" (about 7 ms for the first decision after a cold start in Node, about 0.05 ms on average). The service also applies its own limits: at most 100 listed and 400 unlisted tables, 10 table creations per network address per hour, at most 32 identified connections per table, at most 8 connections per network address per table, and at most 16 unidentified connections per table and 2 per address, each closed after 10 seconds.

### Attaching bridge.romaniuk.us later

Cloudflare's documentation says Workers Custom Domains support only domains that are active zones on your Cloudflare account, so `romaniuk.us` (or the subdomain's zone) would first have to be added to Cloudflare, which means using Cloudflare's name servers. A Custom Domain cannot be created on a hostname that already has a CNAME DNS record. The domain can then be attached in the dashboard or with a `routes` entry such as `{ "pattern": "bridge.romaniuk.us", "custom_domain": true }` in `apps/server/wrangler.jsonc`. This is not set up and the repository does not do it.

## CI and release workflows

- `.github/workflows/ci.yml` runs workspace checks, builds Windows and macOS installers, and builds and launches the app in an iPad simulator for pushes and pull requests.
- `.github/workflows/deploy-cloudflare.yml` deploys the Worker and web client to Cloudflare on pushes to `main` or by manual dispatch from `main` once the repository secrets exist; without them it skips the deploy. See [Online tables on Cloudflare](#online-tables-on-cloudflare).
- `.github/workflows/release.yml` builds Windows and macOS assets for `v*.*.*` tags and creates a draft GitHub release. Review installers before publishing them. Windows artifacts are unsigned. macOS uses an ad-hoc signature; it is suitable for build validation but still prompts users to allow the app and does not replace Developer ID signing and notarization.
- The first GitHub Actions run passed the workspace checks, Windows and macOS installer builds, and iPad simulator build/install/launch. See the [run summary](https://github.com/irom77/ContractPlay/actions/runs/40745554895). This checkout is Linux/WSL and cannot run those platform builds locally.

## Signing, stores, and accounts

### Windows

Unsigned installers can trigger Microsoft SmartScreen warnings and may be blocked by Smart App Control. For public distribution or Microsoft Store submission, obtain a Windows code-signing certificate and configure the `bundle.windows` signing fields or a signing command in `apps/client/src-tauri/tauri.conf.json`. Keep certificate material in GitHub Actions secrets; never commit it. The release workflow currently creates unsigned draft assets.

### macOS

The default `bundle.macOS.signingIdentity` is `-` for ad-hoc CI builds. Public direct downloads need a Developer ID Application certificate and notarization. App Store distribution uses an Apple Distribution certificate. Create and store signing/notarization credentials in protected CI secrets; replace the ad-hoc identity through CI configuration when those credentials exist.

### iOS and iPadOS

TestFlight and App Store distribution require an Apple Developer account, an app record in App Store Connect, signing certificates, and provisioning profiles. Generate an App Store Connect API key for automated uploads if desired. The repository currently does not contain Apple account credentials, signing profiles, or a store-submission workflow. App Review and store metadata remain manual release steps.

### Web

The repository has no GitHub Pages deployment workflow. Static builds can be hosted elsewhere from `apps/client/dist`; online play needs the Cloudflare deployment described above.

## Upstream platform references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri file-system plugin and scoped permissions](https://v2.tauri.app/plugin/file-system/)
- [Tauri native dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri GitHub Actions pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/)
