import { expect, test } from "@playwright/test";
import { getGrid, gotoPlayPuzzle, gridCellAt } from "./helpers/test-helpers";

// RAZ-73 — Keyboard shortcuts.
//
// The play page mounts a single global `KeyboardListener`
// (`components/game/keyboard-listener.tsx`) that owns the entire
// keyboard contract: arrows / hjkl, digits, Backspace, N, Shift+H,
// Cmd+Z, etc. We assert the high-value bindings here. Lower-value
// or vim-flavoured bindings (j/k/l/h, 'u' for undo) are exercised
// indirectly via the same code paths.
//
// The grid renders 81 buttons but doesn't call `focus()` on any
// of them; cell selection is store state, not DOM focus. So we
// fire keyboard events at `body` (which `document.activeElement`
// resolves to right after a fresh navigation) and read selection
// back from the store.

const PUZZLE_ID = 2;

// Read the 0..80 selection index from the store. Helper because
// every assertion here pivots on it.
async function readSelection(page: import("@playwright/test").Page): Promise<number | null> {
  return page.evaluate(() => {
    const win = window as unknown as {
      __sudokuStore: { getState: () => { selection: number | null } };
    };
    return win.__sudokuStore.getState().selection;
  });
}

test.describe("keyboard shortcuts", () => {
  test("clicking a cell, then arrow keys, moves the selection", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);

    // Select an interior cell so all four arrow directions are
    // valid moves (no edge clamping). Row 5, column 5 is dead
    // center — ARIA is 1-indexed, store index = (5-1)*9 + (5-1) = 40.
    await gridCellAt(grid, 5, 5).click();
    expect(await readSelection(page)).toBe(40);

    await page.keyboard.press("ArrowRight");
    expect(await readSelection(page)).toBe(41);
    await page.keyboard.press("ArrowDown");
    expect(await readSelection(page)).toBe(50);
    await page.keyboard.press("ArrowLeft");
    expect(await readSelection(page)).toBe(49);
    await page.keyboard.press("ArrowUp");
    expect(await readSelection(page)).toBe(40);
  });

  test("typing a digit places it at the selected cell", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);

    // Select the first empty cell so the placement isn't blocked
    // by a clue. Read its index from the store afterwards so the
    // assertion targets the right cell.
    await grid.getByRole("gridcell", { name: /empty$/ }).first().click();
    const idx = await readSelection(page);
    expect(idx).not.toBeNull();
    if (idx == null) return;

    await page.keyboard.press("3");

    const value = await page.evaluate((i) => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { board: Uint8Array } };
      };
      return win.__sudokuStore.getState().board[i];
    }, idx);
    expect(value).toBe(3);
  });

  test("Backspace clears the value at the selected cell", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);

    await grid.getByRole("gridcell", { name: /empty$/ }).first().click();
    const idx = await readSelection(page);
    if (idx == null) throw new Error("no empty cell selected");

    await page.keyboard.press("4");
    await page.keyboard.press("Backspace");

    const value = await page.evaluate((i) => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { board: Uint8Array } };
      };
      return win.__sudokuStore.getState().board[i];
    }, idx);
    expect(value).toBe(0);
  });

  test("N toggles between value and notes mode", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    const before = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { mode: "value" | "notes" } };
      };
      return win.__sudokuStore.getState().mode;
    });
    expect(before).toBe("value");

    await page.keyboard.press("n");

    const after = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { mode: "value" | "notes" } };
      };
      return win.__sudokuStore.getState().mode;
    });
    expect(after).toBe("notes");
  });

  test("Cmd+Z undoes a placement; Shift+Cmd+Z redoes it", async ({
    page,
    browserName,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);
    await grid.getByRole("gridcell", { name: /empty$/ }).first().click();
    const idx = await readSelection(page);
    if (idx == null) throw new Error("no empty cell selected");

    await page.keyboard.press("8");
    expect(
      await page.evaluate(
        (i) =>
          (
            window as unknown as {
              __sudokuStore: { getState: () => { board: Uint8Array } };
            }
          ).__sudokuStore.getState().board[i],
        idx,
      ),
    ).toBe(8);

    // Cmd+Z on Mac (and what Chromium does by default), Ctrl+Z
    // elsewhere. Use Meta unconditionally — Chromium honours it
    // on every platform Playwright drives, since the listener
    // accepts either modifier (`metaKey || ctrlKey`).
    void browserName;
    await page.keyboard.press("Meta+z");
    expect(
      await page.evaluate(
        (i) =>
          (
            window as unknown as {
              __sudokuStore: { getState: () => { board: Uint8Array } };
            }
          ).__sudokuStore.getState().board[i],
        idx,
      ),
    ).toBe(0);

    await page.keyboard.press("Meta+Shift+z");
    expect(
      await page.evaluate(
        (i) =>
          (
            window as unknown as {
              __sudokuStore: { getState: () => { board: Uint8Array } };
            }
          ).__sudokuStore.getState().board[i],
        idx,
      ),
    ).toBe(8);
  });

  test("Space toggles pause; Escape clears the selection", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);
    const grid = getGrid(page);
    await grid.getByRole("gridcell", { name: /empty$/ }).first().click();

    // Space pauses. The store exposes `isPaused`; the timer
    // overlays a "Paused" curtain when it flips.
    await page.keyboard.press("Space");
    const paused = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: { getState: () => { isPaused: boolean } };
      };
      return win.__sudokuStore.getState().isPaused;
    });
    expect(paused).toBe(true);

    // Resume so Escape's deselect isn't shadowed by some pause-
    // overlay focus trap.
    await page.keyboard.press("Space");

    await page.keyboard.press("Escape");
    const sel = await readSelection(page);
    expect(sel).toBeNull();
  });
});
