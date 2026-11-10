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

## CI and release workflows

- `.github/workflows/ci.yml` runs workspace checks, builds Windows and macOS installers, and builds and launches the app in an iPad simulator for pushes and pull requests.
- `.github/workflows/deploy-web.yml` deploys the static browser client to GitHub Pages on pushes to `main` or by manual dispatch.
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

GitHub Pages deployment requires the repository's Pages source to be set to GitHub Actions and the workflow token to have Pages deployment permission. No server, database, or account credentials are needed for the static client.

## Upstream platform references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri file-system plugin and scoped permissions](https://v2.tauri.app/plugin/file-system/)
- [Tauri native dialog plugin](https://v2.tauri.app/plugin/dialog/)
- [Tauri GitHub Actions pipeline](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri macOS signing and notarization](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Windows code signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri App Store distribution](https://v2.tauri.app/distribute/app-store/)
