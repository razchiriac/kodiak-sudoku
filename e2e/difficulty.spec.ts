import { expect, test } from "@playwright/test";

// RAZ-38 — Difficulty contract.
//
// The user-reported bug was "Easy and Medium puzzles both feel
// Expert-hard". Root cause: every bucket had ~24 clues regardless
// of its rating-based label, so felt difficulty was indistinguishable.
//
// These tests lock in the post-fix contract. They start a new
// puzzle at each difficulty and assert the minimum clue count
// matches the target ranges declared in `lib/sudoku/augment.ts`:
//
//   Easy >= 38, Medium >= 32, Hard >= 28, Expert >= 20.
//
// We count clues by counting grid cells whose aria-label contains
// "(clue)" — that's the screen-reader-visible marker for a fixed
// (unmovable) cell, which is exactly what "clue count" means.
// Using ARIA keeps the test resilient to CSS changes.

const DIFFICULTY_MIN_CLUES: Array<[string, number]> = [
  ["Easy", 38],
  ["Medium", 32],
  ["Hard", 28],
  ["Expert", 20],
];

test.describe("difficulty clue counts", () => {
  for (const [label, minClues] of DIFFICULTY_MIN_CLUES) {
    test(`${label} puzzle has at least ${minClues} clues`, async ({ page }) => {
      await page.goto("/play");
      // The picker button's accessible name is "<Label> Start a new
      // puzzle" (two stacked spans), so a substring match is what
      // we want here. `exact: true` would require the bare label.
      await Promise.all([
        page.waitForURL(/\/play\/\d+$/),
        page.getByRole("button", { name: label }).click(),
      ]);

      const grid = page.getByRole("grid", { name: /sudoku/i });
      await expect(grid).toBeVisible();

      // The clue-count count comes from how many gridcells carry
      // the "(clue)" marker in their accessible name. We use
      // `allInnerTexts` via attribute filter rather than role
      // queries here because we need the exact count.
      const cells = grid.getByRole("gridcell");
      const labels = await cells.evaluateAll((els) =>
        els.map((e) => e.getAttribute("aria-label") ?? ""),
      );
      const clueCount = labels.filter((l) => l.includes("(clue)")).length;

      // Sanity bounds so a broken selector doesn't silently pass.
      expect(clueCount).toBeGreaterThan(0);
      expect(clueCount).toBeLessThanOrEqual(81);
      expect(clueCount).toBeGreaterThanOrEqual(minClues);
    });
  }
});
