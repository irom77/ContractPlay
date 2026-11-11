# Platform delivery

ContractPlay ships one React/Vite client to the web and through a Tauri 2 host to Windows, macOS, iOS, and iPadOS. The native host uses OS file pickers for PBN import/export and limits file-system access to files selected in those dialogs. Game state is autosaved to local storage after each game change and flushed when the app is hidden or closed.

## Build locally

Install the workspace dependencies with `pnpm install --frozen-lockfile`.

### Web

- Start development with `pnpm web:dev`.
- Build and verify the static package with `pnpm web:verify`.
- The output is `apps/client/dist`; relative asset paths allow hosting at a domain root, a repository subpath, or in Tauri.
- The web workflow deploys `main` to GitHub Pages. The repository's Pages source is set to GitHub Actions and the site is live at https://irom77.github.io/ContractPlay/; a fork needs **Settings → Pages → Build and deployment → GitHub Actions** selected once before its first deployment. To use another static host, deploy `apps/client/dist`.

### Windows and macOS

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

The CI workflow builds an iOS simulator app, installs it on an available iPad simulator, launches it, and uploads the app bundle and screenshot. iPadOS uses the same universal iOS app target; there is no separate iPadOS package. A real iPhone/iPad run is still needed before public release.

For a device or App Store package, build on macOS with an Apple signing identity and provisioning profile, for example:

```sh
pnpm --filter @contractplay/client exec tauri ios build --target aarch64 --export-method app-store-connect
```

The CI simulator build does not require Apple signing credentials. Device installation, TestFlight, and App Store distribution do.

## Online tables on Cloudflare

Online tables run on a Cloudflare Worker in `apps/server`. The Worker serves the built web client from `apps/client/dist` and runs the tables and the lobby as Durable Objects (SQLite-backed). Nothing is deployed yet: the web app is still served from GitHub Pages, whose build is made with `VITE_ONLINE_URL=none` and so has no online entry, until the project owner deploys to Cloudflare and confirms it works. After that, GitHub Pages is to become a redirect to the new address (a planned follow-up).

### First deployment

1. Create a free Cloudflare account.
2. From the repository root, run `pnpm --filter @contractplay/server exec wrangler login` and approve access in the browser.
3. Run `pnpm run deploy` (plain `pnpm deploy` is a different, built-in pnpm command). It runs `pnpm web:verify` and then `wrangler deploy` in `apps/server`. Wrangler prints the address, of the form `https://contractplay.<account-subdomain>.workers.dev`.
4. Open the address in two browser windows and play a table to confirm it works.

Use `wrangler deploy --dry-run` in `apps/server` (after `pnpm build`) to check that the configuration bundles without deploying.

### Deploying from GitHub Actions

`.github/workflows/deploy-cloudflare.yml` runs on pushes to `main` and by manual dispatch. It installs, runs `pnpm web:verify`, and runs `wrangler deploy` in `apps/server`. Until the token secret exists the deploy step is skipped with a notice, so the workflow still passes. Pull requests do not trigger it, and the job runs only from `main`, so a manual run from another branch does nothing. It also skips the deploy, with a notice naming the missing secret, unless both secrets below are set.

To enable it:

1. In the Cloudflare dashboard, open **Account API tokens**, choose **Create Token**, and under **Permission policies** select the **Edit Cloudflare Workers** template. Scope it to the one account, and name it for this repository.
2. Add two repository secrets under **Settings -> Secrets and variables -> Actions**: `CLOUDFLARE_API_TOKEN` (the token) and `CLOUDFLARE_ACCOUNT_ID` (shown in the dashboard). Never commit either value.

Cloudflare also publishes an official `cloudflare/wrangler-action`; this workflow runs `wrangler deploy` directly with the two environment variables instead, which Cloudflare's CI documentation describes.

### Service address; desktop and iOS builds

The Cloudflare deployment serves the app and the tables from one address, so the web app uses its own origin as the service address. The GitHub Pages build (`deploy-web.yml`) sets `VITE_ONLINE_URL=none`, which hides "Play online" and "Online tables" because Pages has no service.

Online play is available in the web app only for now; desktop and iOS builds do not show it. The app recognizes the native shell and hides the online entries there whatever `VITE_ONLINE_URL` says (on Windows the shell serves the app from an http address, `http://tauri.localhost`, which is not the service). Enabling it needs the service address allowed in the app's content security policy (`connect-src` in `apps/client/src-tauri/tauri.conf.json`) and cross-origin access on the service, which is planned.

### Free-plan limits

The Worker uses SQLite-backed Durable Objects, the only kind available on the Workers Free plan. Cloudflare's published free-plan limits include 100,000 Worker requests per day, 100,000 Durable Object requests per day, 100,000 SQL rows written per day, and 10 ms of CPU time per Worker invocation. Check Cloudflare's pricing and limits pages for current values. The 10 ms CPU limit must be confirmed on the first real deployment against bot decisions, which are measured in the [design](superpowers/specs/2026-11-10-online-tables-design.md) under "Risks to check early" (about 7 ms for the first decision after a cold start in Node, about 0.05 ms on average). The service also applies its own limits: at most 100 listed and 400 unlisted tables, 10 table creations per network address per hour, at most 32 identified connections per table, at most 8 connections per network address per table, and at most 16 unidentified connections per table and 2 per address, each closed after 10 seconds.

### Attaching bridge.romaniuk.us later

Cloudflare's documentation says Workers Custom Domains support only domains that are active zones on your Cloudflare account, so `romaniuk.us` (or the subdomain's zone) would first have to be added to Cloudflare, which means using Cloudflare's name servers. A Custom Domain cannot be created on a hostname that already has a CNAME DNS record. The domain can then be attached in the dashboard or with a `routes` entry such as `{ "pattern": "bridge.romaniuk.us", "custom_domain": true }` in `apps/server/wrangler.jsonc`. This is not set up and the repository does not do it.

## CI and release workflows

- `.github/workflows/ci.yml` runs workspace checks, builds Windows and macOS installers, and builds and launches the app in an iPad simulator for pushes and pull requests.
- `.github/workflows/deploy-web.yml` deploys the static browser client to GitHub Pages on pushes to `main` or by manual dispatch.
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

GitHub Pages deployment requires the repository's Pages source to be set to GitHub Actions and the workflow token to have Pages deployment permission. No server, database, or account credentials are needed for the static client. Online play needs the Cloudflare deployment described above.

## Upstream platform references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri file-system plugin and scoped permissions](https://v2.tauri.app/plugin/file-system/)
- [Tauri native dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri GitHub Actions pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/)
