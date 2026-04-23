import { defineConfig, devices } from "@playwright/test";

// RAZ-39 — Playwright configuration for end-to-end tests.
//
// We deliberately keep this config small so it stays legible:
//
//   - Tests live in ./e2e.
//   - By default we point at http://localhost:3000 and assume the dev
//     server is already up (along with the local Postgres that the
//     server talks to). This matches the day-to-day dev workflow —
//     if you already have `pnpm dev` running, `pnpm test:e2e` just
//     drives it.
//   - You can override the target with PLAYWRIGHT_BASE_URL to point
//     at a preview deployment (e.g. a Vercel preview URL for a PR)
//     without changing anything else.
//   - Only Chromium is wired up for now. Firefox / WebKit are an
//     easy follow-up when we start caring about cross-browser
//     regressions; the extra runtime in CI wasn't worth it for v1.
//   - A mobile viewport project is included because our UI is
//     mobile-first — most UX bugs will surface on small screens
//     first, so having one "Pixel 7" run by default catches them.
//
// The `webServer` block is intentionally opt-in. Starting `pnpm dev`
// from inside Playwright is convenient but flaky (Next's compile step
// can take >30s on a cold cache and races the `reuseExistingServer`
// probe). Set PLAYWRIGHT_START_SERVER=1 when you want that behavior
// — CI is the likely caller.

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const startOwnServer = process.env.PLAYWRIGHT_START_SERVER === "1";

export default defineConfig({
  testDir: "./e2e",

  // A single worker keeps database state predictable (tests share
  // the same puzzles table) and makes failure logs easy to read.
  // Bump this once we add test-scoped fixtures.
  workers: 1,
  fullyParallel: false,

  // Retry once in CI — flaky network / cold-start issues happen
  // and a single retry hides them without masking real regressions
  // (two consecutive failures still bubble up). Locally we don't
  // retry, because a flake during development is more useful as a
  // loud failure than a quiet pass.
  retries: process.env.CI ? 1 : 0,

  reporter: process.env.CI ? [["html", { open: "never" }], ["list"]] : "list",

  use: {
    baseURL,
    // Capture traces only on the first retry — full traces on every
    // run bloat test-results/ quickly and we rarely need them for
    // green tests.
    trace: "on-first-retry",
    // Screenshot only when a test actually fails; full-page so we
    // get context, not just the viewport.
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // A generous action timeout handles Next's first-compile lag
    // on dev server hits without making the suite slow.
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "chromium-desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "chromium-mobile",
      // Pixel 7 is a representative Android viewport (412x915).
      // iPhone would need WebKit which we skip for now.
      use: { ...devices["Pixel 7"] },
    },
  ],

  // When PLAYWRIGHT_START_SERVER=1, start the dev server ourselves
  // and wait for it to respond on `baseURL` before running tests.
  // Otherwise we assume you're already running `pnpm dev` alongside.
  webServer: startOwnServer
    ? {
        command: "pnpm dev",
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
});
