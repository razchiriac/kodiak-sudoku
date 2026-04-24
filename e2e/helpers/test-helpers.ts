import { expect, type Locator, type Page } from "@playwright/test";

// RAZ-73 — Shared helpers for the e2e suite.
//
// We deliberately keep this file tiny and dependency-free so it can be
// imported by every spec without dragging in heavy fixtures. Functions
// here cover only the glue that's repeated across multiple specs:
//
//   - `gotoPlayPuzzle`  — opens /play/<id>, waits for the grid + the
//     Zustand store to hydrate (so subsequent `page.evaluate(s => ...)`
//     calls don't race React's first commit).
//   - `getGrid`         — returns the canonical Sudoku grid locator
//     (role=grid, named "Sudoku ..."). Centralised so a future label
//     rename touches one line.
//   - `gridCellAt`      — addresses a cell by 1-indexed row/col via the
//     ARIA contract from RAZ-24 (aria-rowindex / aria-colindex). This
//     is the most stable selector we have because both the visual
//     position and the screen-reader announcement depend on it.
//   - `firstEmptyCell`  — returns the first non-clue cell. Useful when
//     a test only cares "any editable cell will do".
//   - `expectNoServerError` — fails fast if Next renders the in-app
//     500 boundary, which is the most common reason a route appears to
//     "render but be wrong" (we get a real DOM, just the wrong one).

// Width/height of the board. Centralised so tests don't sprinkle 9s.
export const BOARD_SIZE = 9;
export const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE; // 81

// Canonical grid locator. The grid was given a stable accessible name
// in RAZ-24 ("Sudoku puzzle"); using a regex absorbs any future
// suffix like "Sudoku puzzle, paused" without breaking selectors.
export function getGrid(page: Page): Locator {
  return page.getByRole("grid", { name: /sudoku/i });
}

// Address a cell by 1-indexed row/col. The grid renders a flat list
// of <button role="gridcell"> with `aria-rowindex` / `aria-colindex`
// set on each — the same hooks a screen reader uses to announce
// position. We prefer this over nth-child because per-cell rerenders
// can shuffle React's reconciliation, but the ARIA attributes are
// pinned to logical position.
export function gridCellAt(grid: Locator, row: number, col: number): Locator {
  return grid.locator(
    `[role="gridcell"][aria-rowindex="${row}"][aria-colindex="${col}"]`,
  );
}

// Return the first cell whose accessible name ends in "empty" — that's
// the screen-reader marker for an editable cell (clues end in "(clue)").
// Many specs only need "any cell I'm allowed to edit" rather than a
// specific position, so this avoids hard-coding row/col that may or
// may not be empty in a given seeded puzzle.
export function firstEmptyCell(grid: Locator): Locator {
  return grid.getByRole("gridcell", { name: /empty$/ }).first();
}

// Open /play/<id>, wait for the grid to render, and confirm the
// Zustand store has hydrated. The latter check matters for any test
// that reaches into `window.__sudokuStore` afterwards: without it,
// the test races React's first commit and intermittently sees an
// undefined store.
export async function gotoPlayPuzzle(page: Page, id: number): Promise<void> {
  await page.goto(`/play/${id}`);
  await expect(getGrid(page)).toBeVisible();
  // Wait for the dev-only store handle to attach (see game-store.ts
  // bottom). 5s is plenty — the attach happens on first render.
  await page.waitForFunction(
    () =>
      typeof window !== "undefined" &&
      typeof (window as unknown as { __sudokuStore?: unknown }).__sudokuStore ===
        "function",
    null,
    { timeout: 5_000 },
  );
}

// Fail fast if the route rendered Next's `error.tsx` boundary instead
// of the page we wanted. Catches the "no exception, no console error,
// but the wrong DOM" failure mode that masks bugs like the RAZ-71
// 500s we just fixed.
export async function expectNoServerError(page: Page): Promise<void> {
  // Next's default error UI uses the literal string "Application
  // error" or our route-specific error.tsx variants. We assert
  // neither is present rather than asserting a specific page heading
  // (which would couple this helper to every route's copy).
  await expect(page.getByText(/application error|something went wrong/i))
    .toHaveCount(0);
}

// Convenience: read the current Zustand state via the dev-only window
// expose. Use sparingly — most assertions should go through the DOM
// because the DOM is what users actually see. This helper exists for
// completion-style flows where round-tripping every input through the
// keyboard would make a 30-second test out of a 300-ms behavior.
export async function getStoreSnapshot<T>(
  page: Page,
  selector: (state: unknown) => T,
): Promise<T> {
  return page.evaluate(
    (selectorString) => {
      const win = window as unknown as {
        __sudokuStore?: { getState: () => unknown };
      };
      if (!win.__sudokuStore) throw new Error("__sudokuStore not exposed");
      const state = win.__sudokuStore.getState();
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function("state", `return (${selectorString})(state);`);
      return fn(state) as unknown;
    },
    selector.toString(),
  ) as Promise<T>;
}

// Drive the store directly. Mirror image of `getStoreSnapshot`. Use
// for "fast-forward to a state that would take 80 keystrokes" — most
// notably, completion flows where we splat the solution onto the
// board to assert the post-solve UI.
export async function callStoreAction(
  page: Page,
  action: (state: unknown) => unknown,
): Promise<void> {
  await page.evaluate(
    (actionString) => {
      const win = window as unknown as {
        __sudokuStore?: { getState: () => unknown };
      };
      if (!win.__sudokuStore) throw new Error("__sudokuStore not exposed");
      const state = win.__sudokuStore.getState();
      // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
      const fn = new Function("state", `return (${actionString})(state);`);
      fn(state);
    },
    action.toString(),
  );
}
