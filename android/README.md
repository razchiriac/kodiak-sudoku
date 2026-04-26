# Android TWA wrapper (RAZ-85)

This directory tracks the Android app shell for Play Store delivery using a
Trusted Web Activity (TWA).

## Why TWA

The web app is already the product source of truth (Next.js + Supabase + feature
flags + lessons + AI surfaces). TWA lets us ship an Android app package without
forking gameplay/auth/UI logic into a second native codebase.

## Current state

This repo currently includes:

- `twa-manifest.template.json` - Bubblewrap/TWA config template (safe to commit)
- build/release checklist in `docs/android-twa.md`
- web-origin verification endpoint at `/.well-known/assetlinks.json`

Generated Gradle projects and keystores are intentionally not committed yet.

## Local workflow (recommended)

1. Install Bubblewrap:

```bash
npm i -g @bubblewrap/cli
```

2. Copy the template manifest and fill values:

```bash
cp android/twa-manifest.template.json android/twa-manifest.json
```

3. Generate Android project (outside or inside `android/`):

```bash
bubblewrap init --manifest "android/twa-manifest.json"
bubblewrap build
```

4. For Play Store upload, produce an `.aab` release bundle and sign with your
   long-term keystore.

## Secrets

Do not commit:

- keystore files (`*.jks`, `*.keystore`)
- Play signing passwords
- private CI signing vars
- generated `android/local.properties`

Only commit reproducible config/templates and docs.
