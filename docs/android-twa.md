# Android app via Trusted Web Activity (RAZ-85)

This runbook documents how we package the web app as an Android app for Play
Store distribution.

## 1) Configure env vars

Add these vars in Vercel (Production), and optionally in local `.env` when
testing asset links:

- `ANDROID_APP_PACKAGE_NAME` - e.g. `com.razchiriac.sudoku`
- `ANDROID_APP_SHA256_CERT_FINGERPRINT` - signing cert fingerprint(s),
  comma-separated if needed

The app serves them at:

- `/.well-known/assetlinks.json`

## 2) Verify asset links endpoint

After deploy, confirm:

```bash
curl -s https://<your-domain>/.well-known/assetlinks.json
```

Expected:

- JSON array with one `android_app` target
- package name matches TWA app package
- SHA-256 fingerprint matches release signing key

You can also validate this automatically with the repo script:

```bash
npm run android:assetlinks:check -- --url=https://<your-domain>
```

This command fails fast when:

- the endpoint is unreachable or non-JSON
- `android_app` entry is missing for your package
- certificate fingerprints do not match expected env vars

## 3) Generate Android project

Using Bubblewrap:

```bash
npm i -g @bubblewrap/cli
cp android/twa-manifest.template.json android/twa-manifest.json
# edit android/twa-manifest.json values
bubblewrap init --manifest android/twa-manifest.json
```

This generates the Gradle Android wrapper project.

## 4) Build release bundle

From generated Android project:

```bash
./gradlew bundleRelease
```

Output:

- `app/build/outputs/bundle/release/*.aab`

## 5) Play Console internal testing

Before production:

1. Upload `.aab` to Internal testing track.
2. Add tester emails.
3. Validate install/update on at least one physical Android device.
4. Verify core flows:
   - sign-in / sign-out
   - random + daily play
   - puzzle completion submit
   - Technique Journey pages
   - profile / leaderboard routes
   - haptics and settings toggles

Use `docs/android-internal-testing-checklist.md` to record test evidence and
go/no-go signoff.

## 6) Keystore handling

Keystore and passwords are long-term release credentials.

Rules:

- Never commit keystore files.
- Store backups in secure password manager / secret vault.
- Keep CI signing secrets separate from local dev secrets.

## 7) Address bar visible in the Android app (RAZ-132)

Chrome hides the URL bar only after **Digital Asset Links** verification succeeds for the **exact origin** the TWA opens (`launchUrl`). If anything mismatches, Chrome falls back to Custom Tabs and shows the toolbar.

Checklist:

1. **`ANDROID_APP_*` on Vercel** — `/.well-known/assetlinks.json` must list your Play package and the **Google Play App Signing** SHA-256 fingerprint (not necessarily your upload key). Re-fetch fingerprints from Play Console → App signing if unsure.
2. **TWA host alignment** — In `android/twa-app/app/build.gradle`, `hostName` must equal the production hostname (e.g. `kodiaksudoku.com`). The same origin appears in `app/src/main/res/values/strings.xml` inside `assetStatements` (`site`).
3. **Rebuild and ship** — Bump `versionCode`, upload a new `.aab`, then verify on device after install (Chrome may cache verification state).

```bash
npm run android:assetlinks:check -- --url=https://kodiaksudoku.com
```

## 8) Rollback

If Android release regresses:

1. Halt staged rollout (or unpublish active release) in Play Console.
2. Keep web app running; TWA clients still load web origin.
3. Ship web-side mitigation behind existing feature flags where possible.
