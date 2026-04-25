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

## 6) Keystore handling

Keystore and passwords are long-term release credentials.

Rules:

- Never commit keystore files.
- Store backups in secure password manager / secret vault.
- Keep CI signing secrets separate from local dev secrets.

## 7) Rollback

If Android release regresses:

1. Halt staged rollout (or unpublish active release) in Play Console.
2. Keep web app running; TWA clients still load web origin.
3. Ship web-side mitigation behind existing feature flags where possible.
