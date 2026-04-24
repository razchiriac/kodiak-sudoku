import { expect, test } from "@playwright/test";
import { expectNoServerError } from "./helpers/test-helpers";

// RAZ-73 — Route-level smoke for every public surface.
//
// Different from `smoke.spec.ts` (which covers the four "front-door"
// pages a brand-new visitor sees): this file walks every flag-gated
// or alternate route to make sure none of them 500 in production.
// The class of bug we want to catch here is the RAZ-71 family —
// "the page renders, but to the user it's a generic error" — by
// asserting both a 2xx status code AND a stable, page-specific
// element.
//
// Routes that depend on a feature flag are tested in two ways:
//
//   1. If the flag is on, we assert the canonical content.
//   2. If the flag is off, the route must 404 (not 500). We catch
//      that with the response status check.
//
// Routes that touch the DB (daily, leaderboard variants) tolerate
// an empty-state UI: a freshly-seeded local DB has no completions,
// so we never assert "at least one row".

test.describe("public routes — 200 + page-specific anchor renders", () => {
  test("/", async ({ page }) => {
    const res = await page.goto("/");
    expect(res?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/sudoku/i);
    // The hero h1 copy is stable per `app/page.tsx`.
    await expect(
      page.getByRole("heading", { level: 1, name: /smoothest sudoku/i }),
    ).toBeVisible();
    await expectNoServerError(page);
  });

  test("/play renders difficulty buttons", async ({ page }) => {
    const res = await page.goto("/play");
    expect(res?.status()).toBeLessThan(400);
    for (const label of ["Easy", "Medium", "Hard", "Expert"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("/play/quick redirects to a real puzzle when flag is on, else 404", async ({
    page,
  }) => {
    // Flag-gated route. We don't know the live flag value, so we
    // accept either outcome:
    //   - flag on: we land on /play/<id>?quick=1 with a grid.
    //   - flag off: notFound() — Next renders a 404.
    const res = await page.goto("/play/quick");
    const status = res?.status() ?? 0;
    if (status === 404) return;
    // Flag on path. Watch the URL settle, then assert the grid.
    await page.waitForURL(/\/play\/\d+\?quick=1/);
    await expect(page.getByRole("grid", { name: /sudoku/i })).toBeVisible();
  });

  test("/play/diagonal renders the variant difficulty picker", async ({ page }) => {
    const res = await page.goto("/play/diagonal");
    expect(res?.status()).toBeLessThan(400);
    // The diagonal variant page has a dedicated h1 ("Diagonal
    // Sudoku") and the same Easy / Medium / Hard difficulty
    // picker shape as `/play` — but no Expert (variant only ships
    // Easy / Medium / Hard, see app/play/diagonal/page.tsx).
    await expect(
      page.getByRole("heading", { level: 1, name: /diagonal/i }),
    ).toBeVisible();
    for (const label of ["Easy", "Medium", "Hard"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("/play/custom — paste form when flag on, 404 when off", async ({ page }) => {
    const res = await page.goto("/play/custom");
    const status = res?.status() ?? 0;
    if (status === 404) return;
    expect(status).toBeLessThan(400);
    // Page heading + the textarea labeled "Puzzle".
    await expect(
      page.getByRole("heading", { level: 1, name: /paste a puzzle/i }),
    ).toBeVisible();
    await expect(page.getByLabel("Puzzle")).toBeVisible();
  });

  test("/daily — today's puzzle OR a clear empty state", async ({ page }) => {
    const res = await page.goto("/daily");
    // /daily calls notFound() when no puzzle is seeded for today;
    // 404 is a legitimate empty state in a fresh dev DB. 5xx is not.
    const status = res?.status() ?? 0;
    expect(status).toBeLessThan(500);
    if (status === 404) return;
    await expect(page.getByRole("grid", { name: /sudoku/i })).toBeVisible();
  });

  test("/leaderboard renders heading + tab list", async ({ page }) => {
    const res = await page.goto("/leaderboard");
    expect(res?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: /daily leaderboard/i }),
    ).toBeVisible();
    // Pure / All tabs always present (Friends only when signed in).
    await expect(page.getByRole("tab", { name: "Pure" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
  });

  test("/leaderboard/quick — flag-gated weekly board", async ({ page }) => {
    const res = await page.goto("/leaderboard/quick");
    const status = res?.status() ?? 0;
    if (status === 404) return;
    expect(status).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: /quick-play.*weekly/i }),
    ).toBeVisible();
  });

  test.describe("/leaderboard/difficulty/[bucket]", () => {
    for (const bucket of [1, 2, 3, 4]) {
      test(`bucket ${bucket}`, async ({ page }) => {
        const res = await page.goto(`/leaderboard/difficulty/${bucket}`);
        const status = res?.status() ?? 0;
        if (status === 404) return;
        expect(status).toBeLessThan(400);
        // Each bucket page renders its own h1 with the difficulty
        // label (Easy/Medium/Hard/Expert). We don't assert on the
        // exact label per-bucket because that couples the test to
        // the `DIFFICULTY_LABEL` map; a generic h1-present check
        // is enough to prove the route renders.
        await expect(
          page.getByRole("heading", { level: 1 }).first(),
        ).toBeVisible();
      });
    }
  });

  test("/auth/sign-in renders form with both methods", async ({ page }) => {
    const res = await page.goto("/auth/sign-in");
    expect(res?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: /sign in/i }),
    ).toBeVisible();
    // Both methods must be present — Google one-click + magic link.
    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /send magic link/i }),
    ).toBeVisible();
  });

  test("/privacy renders", async ({ page }) => {
    const res = await page.goto("/privacy");
    expect(res?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: /privacy/i }),
    ).toBeVisible();
  });

  test("/terms renders", async ({ page }) => {
    const res = await page.goto("/terms");
    expect(res?.status()).toBeLessThan(400);
    await expect(
      page.getByRole("heading", { level: 1, name: /terms/i }),
    ).toBeVisible();
  });

  test("/api/health returns 200 JSON", async ({ request }) => {
    // Health endpoint is the cheapest probe we have — a clean baseline
    // for everything else. If this 500s, the DB connection is broken
    // and basically no other test will pass.
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("ok", true);
  });
});
