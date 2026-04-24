# End-to-end tests (Playwright)

RAZ-39 — Playwright-based E2E tests that drive a real browser against
the running app. These complement the unit tests in `vitest`: unit tests
cover logic (solver, store, hint tiers); E2E tests cover the contract
at the DOM boundary (accessible names, routing, interaction flow).

## Running locally

The tests assume the app is running at `http://localhost:3000` and
that the local Postgres (the one your `.env` points at) has been
seeded (so `pnpm puzzles:seed-local` should have been run at least
once — the `Easy` puzzle at id `2` is referenced by `play.spec.ts`).

```bash
# In one terminal:
pnpm dev

# In another:
pnpm test:e2e
```

`pnpm test:e2e:ui` opens the Playwright UI runner, which is the
fastest way to debug a flaky or mis-selecting test.

## Running against a preview deployment

Set `PLAYWRIGHT_BASE_URL` to any reachable origin and Playwright
will target that instead. This is handy for poking at a Vercel
preview URL on a PR:

```bash
PLAYWRIGHT_BASE_URL=https://sudoku-pr-42.vercel.app pnpm test:e2e
```

## Writing new tests

- Put new `*.spec.ts` files in this directory.
- Prefer accessible names (`getByRole`, `aria-label`) over CSS
  selectors. The grid and controls were deliberately given stable
  ARIA contracts in RAZ-24; building on that keeps the tests
  resilient to visual refactors.
- Keep each test focused on one observable behavior. Long scripts
  that chain many interactions are hard to diagnose when they fail.

## Authed tests (RAZ-73, opt-in)

Specs under `e2e/authed/` exercise behaviour that only signed-in
users can reach (own profile, friends, post-completion writes).
They run against a fixed test user via a dev-only auth bypass.

### How it works

1. A new API route, `/api/test/login`, accepts a POST with an
   email (default: `e2e+playwright@example.test`) and uses the
   Supabase service-role key to issue a real magic-link session
   for that user. Both `NODE_ENV !== "production"` AND
   `ENABLE_TEST_LOGIN === "1"` must be true; either guard
   failing returns 404 (NOT 403 — see the route file for the
   reasoning).
2. A Playwright "setup" project (`e2e/auth.setup.ts`) hits that
   route once per run and writes the session cookies to
   `playwright/.auth/user.json` (gitignored).
3. The `chromium-desktop-authed` and `chromium-mobile-authed`
   projects load that file via `storageState` and run the
   `e2e/authed/*.spec.ts` files. These projects are only
   registered in `playwright.config.ts` when
   `ENABLE_TEST_LOGIN=1` is set in the playwright runner's env,
   so an anonymous run isn't polluted with skipped scaffolding.

### Running locally

```bash
# In your dev terminal — set BOTH places. The dev server checks
# the env when serving /api/test/login; Playwright checks it
# when deciding whether to add the authed projects.
echo "ENABLE_TEST_LOGIN=1" >> .env.local
pnpm dev   # restart so Next picks up the env

# In your test terminal:
ENABLE_TEST_LOGIN=1 pnpm test:e2e
```

If you only want the authed slice:

```bash
ENABLE_TEST_LOGIN=1 pnpm test:e2e --project=chromium-desktop-authed
```

### Known limitations (follow-up work)

- Only Chromium is wired up. Firefox / WebKit projects are a one-
  line addition once we start caring about cross-browser parity.
- There's no CI job yet because a test-scoped database isn't set
  up — running against the production DB read-only is brittle, and
  spinning up Supabase in CI is larger scope. When we do add it,
  the preview-URL pattern above is probably the cheapest path.
- The test user (`e2e+playwright@example.test`) accumulates state
  in whatever Supabase project the dev server points at. For
  truly isolated runs we'd want a per-PR database — out of scope
  for the initial RAZ-73 cut.
