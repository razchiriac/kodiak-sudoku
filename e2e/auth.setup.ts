import { expect, test as setup } from "@playwright/test";

// RAZ-73 — Playwright "setup" project: obtains a real Supabase
// session via the dev-only /api/test/login route and saves the
// resulting cookies to disk so authed specs can hydrate them
// via `test.use({ storageState })`.
//
// This file is loaded by the `setup` project in playwright.config.ts.
// That project is itself only added to the config when
// ENABLE_TEST_LOGIN === "1", so when the env is unset the setup
// never runs and the authed projects don't exist — by design.
//
// We deliberately don't go through the UI sign-in flow:
//   - The magic-link path requires SMTP and a human inbox.
//   - The Google OAuth path requires Google credentials and
//     would couple the suite to a third-party flow.
// The /api/test/login route exists precisely to dodge both.

const TEST_EMAIL = "e2e+playwright@example.test";

// Where the saved storage state lives on disk. Keeping it under
// `playwright/` (not `e2e/`) so the test runner doesn't try to
// pick it up as a spec file. Gitignored — see .gitignore update.
export const AUTH_STATE_PATH = "playwright/.auth/user.json";

setup("authenticate the test user via /api/test/login", async ({ page }) => {
  // CRITICAL: we use `page.request` (NOT the top-level `request`
  // fixture), because `page.request` shares its cookie jar with
  // the browser context that owns `page`. The top-level `request`
  // fixture has its OWN APIRequestContext with a separate jar —
  // any Set-Cookie it receives never reaches `page.context()`,
  // and `storageState()` ends up empty (silently).
  //
  // We learned this the hard way: the setup ran green, the
  // storage file was written, and every authed spec then failed
  // because there were 0 cookies in it. Using `page.request`
  // converts the auth cookies straight into the browser context
  // cookie jar in one step.
  const res = await page.request.post("/api/test/login", {
    data: { email: TEST_EMAIL },
  });

  // Loud failure — the env was set so we promised a working
  // login, and the route either 404'd (server doesn't have the
  // env), 5xx'd (Supabase admin call broke), or returned a
  // non-OK shape. Surfacing this clearly is more valuable than
  // limping forward with an anonymous storage state.
  expect(
    res.status(),
    `POST /api/test/login returned ${res.status()}. Make sure the dev server has ENABLE_TEST_LOGIN=1 in its environment AND that SUPABASE_SERVICE_ROLE_KEY is set.`,
  ).toBe(200);

  // Visit the home page so the SSR layer runs at least once
  // with the cookies in place — this exercises the same
  // `getServerSupabase()` codepath that real users hit on
  // first navigation, surfacing any cookie-shape mismatch
  // immediately rather than in a downstream spec.
  await page.goto("/");
  await expect(page).toHaveTitle(/sudoku/i);

  // Persist storage. Authed specs `test.use({ storageState })`
  // points at this file.
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
