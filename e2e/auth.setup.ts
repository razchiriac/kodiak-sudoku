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

setup("authenticate the test user via /api/test/login", async ({ request, page }) => {
  // Hit the login route — it sets the Supabase auth cookies on
  // the request context's cookie jar. We then transfer those
  // cookies to a real BrowserContext (`page.context()`) so
  // storageState() captures them in the shape every subsequent
  // browser-based test expects.
  const res = await request.post("/api/test/login", {
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

  // Visit the home page through the browser context with the
  // cookies inherited from the request context. This is the
  // canonical way to convert request-context cookies into
  // browser-context storageState — playwright shares the same
  // CookieJar between request and page when both come from the
  // same `context`.
  await page.goto("/");
  // A trivial assertion to make sure we actually navigated,
  // and to wait until the SSR auth check runs at least once.
  await expect(page).toHaveTitle(/sudoku/i);

  // Persist storage. Authed specs `test.use({ storageState })`
  // points at this file.
  await page.context().storageState({ path: AUTH_STATE_PATH });
});
