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

## Known limitations (follow-up work)

- Only Chromium is wired up. Firefox / WebKit projects are a one-
  line addition once we start caring about cross-browser parity.
- There's no CI job yet because a test-scoped database isn't set
  up — running against the production DB read-only is brittle, and
  spinning up Supabase in CI is larger scope. When we do add it,
  the preview-URL pattern above is probably the cheapest path.
- Auth flows (sign-in, sign-up) aren't covered yet. Anonymous
  gameplay and page routes are the current focus.
