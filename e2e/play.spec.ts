import { expect, test } from "@playwright/test";

// RAZ-39 — Core gameplay interactions.
//
// These tests exercise the happy path a new visitor walks:
//
//   picker → puzzle → place a digit → undo → erase
//
// The assertions use accessible names (role + aria-label) rather
// than CSS selectors. This isn't a stylistic preference — it
// reflects the a11y contract we established in RAZ-24: if an
// assistive-technology user can find the cell, so can a test.
//
// Running: assumes `pnpm dev` is up locally with the usual dev
// Postgres. See `playwright.config.ts` for alternative modes.

test.describe("gameplay", () => {
  test("starts an Easy puzzle from the difficulty picker", async ({ page }) => {
    await page.goto("/play");
    // The "Easy" button is a form-submit that runs a server action
    // and redirects to /play/[id]. We follow the redirect by
    // waiting for the URL to match the puzzle pattern.
    await Promise.all([
      page.waitForURL(/\/play\/\d+$/),
      page.getByRole("button", { name: "Easy" }).click(),
    ]);
    // The grid must render before we can do anything else.
    await expect(
      page.getByRole("grid", { name: /sudoku/i }),
    ).toBeVisible();
  });

  test("placing a digit fills the selected cell, Undo clears it", async ({
    page,
  }) => {
    // We navigate directly to a known puzzle id to avoid depending
    // on whichever puzzle the server-side "random" picker returns.
    // Puzzle id 2 is the first Easy puzzle in the local seed.
    await page.goto("/play/2");
    const grid = page.getByRole("grid", { name: /sudoku/i });
    await expect(grid).toBeVisible();

    // Grab the first empty (i.e. non-clue) cell. Its aria-label
    // ends with "empty" by contract (see components/game/cell.tsx).
    // We don't care which specific cell as long as it's editable.
    const emptyCell = grid
      .getByRole("gridcell", { name: /empty$/ })
      .first();
    await emptyCell.click();

    // Record the cell's row/column so we can target the *same*
    // cell after the placement updates its label. We pull them
    // from the aria-rowindex / aria-colindex attributes which
    // don't change with value updates.
    const row = await emptyCell.getAttribute("aria-rowindex");
    const col = await emptyCell.getAttribute("aria-colindex");
    expect(row).toBeTruthy();
    expect(col).toBeTruthy();

    // The number pad button for "5" has an aria-label that starts
    // with "Place 5". If the player is in Notes mode it's "Toggle
    // note 5" — a fresh game loads in placement mode so "Place"
    // matches. We use a regex anchored at the start to avoid
    // matching the "Place 15" equivalent in other languages.
    await page.getByRole("button", { name: /^Place 5/ }).click();

    // Re-target by row/col to check the updated state. We allow
    // either "value 5" (solved or still-correct) or the same
    // with a ", conflict" suffix, since a random empty cell may
    // or may not legally accept a 5.
    const updatedCell = grid.locator(
      `[role="gridcell"][aria-rowindex="${row}"][aria-colindex="${col}"]`,
    );
    await expect(updatedCell).toHaveAttribute(
      "aria-label",
      /value 5/,
    );

    // Undo: the control panel exposes an "Undo" button. Clicking
    // it should revert the cell to empty. `exact` guards against
    // future additions like "Undo all" that would otherwise
    // collide with this selector.
    await page
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await expect(updatedCell).toHaveAttribute(
      "aria-label",
      /empty$/,
    );
  });

  test("Notes toggle switches number-pad button labels", async ({ page }) => {
    await page.goto("/play/2");
    await expect(page.getByRole("grid", { name: /sudoku/i })).toBeVisible();

    // Before toggling notes, the pad exposes "Place N" labels.
    await expect(
      page.getByRole("button", { name: /^Place 1/ }),
    ).toBeVisible();

    // Flip into notes mode via the control-panel toggle. `exact`
    // is load-bearing: the control panel also exposes an
    // "Auto-notes" button that `name: "Notes"` would otherwise
    // match in addition to the one we want.
    await page.getByRole("button", { name: "Notes", exact: true }).click();

    // Now the same pad button announces as "Toggle note N" — this
    // is how a screen-reader user knows the mode changed. If the
    // label doesn't flip, notes mode hasn't taken effect.
    await expect(
      page.getByRole("button", { name: /^Toggle note 1/ }),
    ).toBeVisible();
  });
});
