import { expect, test } from "@playwright/test";

// RAZ-39 — Smoke tests.
//
// These are the "does the app boot at all" checks. If any of these
// fail, nothing else is worth running — which is why they live in
// their own file and run first alphabetically.
//
// They cover the four entry points a brand-new visitor will see:
//
//   1. "/"             — marketing / landing page
//   2. "/play"         — difficulty picker (the fastest path to a game)
//   3. "/daily"        — today's puzzle
//   4. "/leaderboard"  — public board
//
// We keep the assertions shallow on purpose: heading text, key
// nav elements, absence of a server error. The deep behavior is
// covered by the other spec files in this directory.

test.describe("smoke", () => {
  test("landing page loads and links into the app", async ({ page }) => {
    await page.goto("/");
    // The hero copy is the most stable string on the landing page;
    // `h1` alone would collide with sub-hero sections on some
    // responsive variants.
    await expect(page).toHaveTitle(/sudoku/i);
    // There must be a primary CTA to start playing. We don't click
    // it here — the `play` spec covers that flow end-to-end — but
    // if the button has vanished, something is structurally wrong.
    await expect(
      page.getByRole("link", { name: /play|start/i }).first(),
    ).toBeVisible();
  });

  test("/play renders the difficulty picker", async ({ page }) => {
    await page.goto("/play");
    // Four difficulty buttons (Easy / Medium / Hard / Expert) are
    // the core of this page. We assert each label is present
    // rather than count buttons, because the page also has nav
    // buttons (Leaderboard, Daily) that would inflate the count.
    for (const label of ["Easy", "Medium", "Hard", "Expert"]) {
      await expect(page.getByRole("button", { name: label })).toBeVisible();
    }
  });

  test("/daily renders today's puzzle or a clear empty state", async ({
    page,
  }) => {
    await page.goto("/daily");
    // Either the grid is visible (happy path) or the page has an
    // "archive" link to yesterday's puzzle. We accept either: the
    // server may not have seeded a puzzle for today yet in a fresh
    // local dev environment.
    const grid = page.getByRole("grid", { name: /sudoku/i });
    const archive = page.getByRole("link", { name: /archive|previous/i });
    await expect(grid.or(archive).first()).toBeVisible();
  });

  test("/leaderboard renders without server error", async ({ page }) => {
    await page.goto("/leaderboard");
    // Leaderboard page may be empty on a fresh DB. We just want to
    // prove the route renders — any recognizable leaderboard
    // heading is enough.
    await expect(
      page.getByRole("heading", { name: /leaderboard/i }).first(),
    ).toBeVisible();
  });
});
