import { expect, test } from "@playwright/test";
import {
  firstEmptyCell,
  getGrid,
  gotoPlayPuzzle,
  gridCellAt,
} from "./helpers/test-helpers";

// RAZ-73 — Deeper gameplay coverage.
//
// `play.spec.ts` already covers the front-door behaviours: starting
// a puzzle from the picker, placing a digit, basic undo, the notes-
// mode label flip on the keypad. This file layers on the next ring
// of interactions a player exercises in a normal solve:
//
//   - Erase a placed value
//   - Conflict highlighting (place a digit that clashes with a row peer)
//   - Notes mode places a pencil mark (verified via the store, since
//     pencil marks are visual-only — the cell's accessible name still
//     announces "empty")
//   - Hint reveals a value (handles both legacy single-click and
//     RAZ-14 three-click progressive-disclosure modes)
//   - Redo restores an undone change
//
// We use puzzle id 2 (first Easy in the local seed) for every test
// so the run is deterministic. Where a test needs a state assertion
// that's not exposed via ARIA, it reads the dev-only Zustand handle
// installed by `lib/zustand/game-store.ts`.

const PUZZLE_ID = 2;

test.describe("gameplay — interactions", () => {
  test("Erase clears a placed value back to empty", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);

    const cell = firstEmptyCell(grid);
    await cell.click();
    const row = await cell.getAttribute("aria-rowindex");
    const col = await cell.getAttribute("aria-colindex");

    await page.getByRole("button", { name: /^Place 5/ }).click();
    const target = gridCellAt(grid, Number(row), Number(col));
    // Sanity: a digit landed (we don't care if it's also a conflict).
    await expect(target).toHaveAttribute("aria-label", /value 5/);

    // `exact: true` because the keyboard-shortcut tooltip ("Erase,
    // Backspace") would otherwise leak into the accessible name.
    await page.getByRole("button", { name: "Erase", exact: true }).click();
    await expect(target).toHaveAttribute("aria-label", /empty$/);
  });

  test("placing a digit that clashes with a row peer marks the cell as a conflict", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);

    // Find a row with both a clue (whose value we'll re-use) and an
    // empty cell (where we'll place the clash). We loop because a
    // particular row could in principle be all-clue or all-empty,
    // even though that's vanishingly unlikely on an Easy.
    let chosen:
      | { row: number; clueValue: number; emptyCol: number }
      | null = null;
    for (let r = 1; r <= 9 && !chosen; r++) {
      const cellsInRow = grid.locator(
        `[role="gridcell"][aria-rowindex="${r}"]`,
      );
      const count = await cellsInRow.count();
      let clueValue: number | null = null;
      let emptyCol: number | null = null;
      for (let i = 0; i < count; i++) {
        const c = cellsInRow.nth(i);
        const label = (await c.getAttribute("aria-label")) ?? "";
        const colAttr = await c.getAttribute("aria-colindex");
        if (!colAttr) continue;
        const col = Number(colAttr);
        const clueMatch = label.match(/value (\d) \(clue\)/);
        if (clueMatch && clueValue === null) clueValue = Number(clueMatch[1]);
        else if (/empty$/.test(label) && emptyCol === null) emptyCol = col;
        if (clueValue !== null && emptyCol !== null) {
          chosen = { row: r, clueValue, emptyCol };
          break;
        }
      }
    }
    expect(
      chosen,
      "expected at least one row to contain both a clue and an empty cell on Easy puzzle 2",
    ).not.toBeNull();
    if (!chosen) return;

    const target = gridCellAt(grid, chosen.row, chosen.emptyCol);
    await target.click();
    await page
      .getByRole("button", { name: new RegExp(`^Place ${chosen.clueValue}`) })
      .click();

    await expect(target).toHaveAttribute(
      "aria-label",
      new RegExp(`value ${chosen.clueValue}, conflict`),
    );
    // ARIA invariant — see `Cell.tsx`. A screen reader uses this,
    // not the label suffix, to announce the validity state.
    await expect(target).toHaveAttribute("aria-invalid", "true");
  });

  test("Notes mode places a pencil mark in the cell's notesMask", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    // Pick a deterministic empty cell via the store. `board` is a
    // Uint8Array of length 81 (one byte per cell, 0 = empty). Using
    // the store keeps the test stable across DOM reorderings and
    // is much faster than scanning 81 cells for an aria-label.
    const emptyIndex = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { board: Uint8Array } };
      };
      const board = win.__sudokuStore.getState().board;
      for (let i = 0; i < board.length; i++) if (board[i] === 0) return i;
      return -1;
    });
    expect(emptyIndex).toBeGreaterThanOrEqual(0);

    // Drive selection + mode flip via the store so the keypad click
    // below targets the cell we expect, deterministically. Mode flip
    // through the keypad would also work but adds a round-trip.
    await page.evaluate((idx) => {
      const win = window as unknown as {
        __sudokuStore: {
          getState: () => {
            selectCell: (i: number) => void;
            setMode: (m: "value" | "notes") => void;
          };
        };
      };
      const st = win.__sudokuStore.getState();
      st.selectCell(idx);
      st.setMode("notes");
    }, emptyIndex);

    // Toggle note 5 via the keypad — same path the user takes.
    await page.getByRole("button", { name: /^Toggle note 5/ }).click();

    // Notes are visual-only; the cell's aria-label still reads
    // "empty". Verify the bit is set in the underlying notesMask.
    // notes is a Uint16Array of length 81; bit (digit-1) per cell.
    const noteSet = await page.evaluate((idx) => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { notes: Uint16Array } };
      };
      const mask = win.__sudokuStore.getState().notes[idx] ?? 0;
      return (mask & (1 << (5 - 1))) !== 0;
    }, emptyIndex);
    expect(noteSet).toBe(true);
  });

  test("Hint reveals a value: empties decreases by 1, hintsUsed increments", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    // `board` is a Uint8Array — count empties manually.
    const countEmpties = (b: Uint8Array): number => {
      let n = 0;
      for (let i = 0; i < b.length; i++) if (b[i] === 0) n++;
      return n;
    };

    const before = await page.evaluate(
      (countEmptiesSrc) => {
        const win = window as unknown as {
          __sudokuStore: {
            getState: () => { board: Uint8Array; hintsUsed: number };
          };
        };
        const st = win.__sudokuStore.getState();
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        const ce = new Function(
          "b",
          `return (${countEmptiesSrc})(b);`,
        ) as (b: Uint8Array) => number;
        return { empties: ce(st.board), hintsUsed: st.hintsUsed };
      },
      countEmpties.toString(),
    );

    // The Hint button supports two modes:
    //   - Legacy: 1 click → placement + hintsUsed++
    //   - RAZ-14 progressive: 3 clicks total. Click 1 enters tier
    //     1 (hintsUsed++, no placement). Click 2 enters tier 2
    //     (no change to counters or board). Click 3 actually
    //     places the digit (no counter change).
    // We keep clicking up to 3 times and stop as soon as we see
    // an empty cell get filled. This makes the test agnostic to
    // the live `progressiveHints` flag value.
    const readState = (countEmptiesSrc: string) =>
      page.evaluate(
        (src) => {
          const win = window as unknown as {
            __sudokuStore: {
              getState: () => { board: Uint8Array; hintsUsed: number };
            };
          };
          const st = win.__sudokuStore.getState();
          // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
          const ce = new Function(
            "b",
            `return (${src})(b);`,
          ) as (b: Uint8Array) => number;
          return { empties: ce(st.board), hintsUsed: st.hintsUsed };
        },
        countEmptiesSrc,
      );

    const hintBtn = page.getByRole("button", { name: /^Hint/ });
    for (let i = 0; i < 3; i++) {
      await hintBtn.click();
      const { empties } = await readState(countEmpties.toString());
      if (empties === before.empties - 1) break;
    }

    const after = await readState(countEmpties.toString());

    expect(after.empties).toBe(before.empties - 1);
    expect(after.hintsUsed).toBe(before.hintsUsed + 1);
  });

  test("Redo restores an undone placement", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);

    const cell = firstEmptyCell(grid);
    await cell.click();
    const row = await cell.getAttribute("aria-rowindex");
    const col = await cell.getAttribute("aria-colindex");

    await page.getByRole("button", { name: /^Place 7/ }).click();
    const target = gridCellAt(grid, Number(row), Number(col));
    await expect(target).toHaveAttribute("aria-label", /value 7/);

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(target).toHaveAttribute("aria-label", /empty$/);

    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(target).toHaveAttribute("aria-label", /value 7/);
  });
});
