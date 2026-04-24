import { expect, test } from "@playwright/test";
import { gotoPlayPuzzle } from "./helpers/test-helpers";

// RAZ-73 — Completion flow.
//
// This is the test we'd most love to write by hand and most hate
// to actually write by hand: it would take 50+ keystrokes to type
// out the solution to a real puzzle, and the resulting test would
// be both slow and brittle (one DOM rerender at the wrong moment
// and the keystrokes interleave wrong).
//
// We bypass that pain by reaching into the dev-only Zustand handle
// (`lib/zustand/game-store.ts`) and driving `selectCell` +
// `inputDigit` straight against the store for every empty cell.
// `inputDigit` is the same code path the keypad button uses, so
// we're still exercising the full game engine — we're just skipping
// the React-event round-trip per cell.
//
// Why test this end-to-end rather than via the `lib/sudoku` unit
// suite: the unit tests cover the engine; this spec covers the
// glue between the engine, the modal, the Breakdown panel, and
// (indirectly) the server submission effect.

const PUZZLE_ID = 2;

test.describe("completion", () => {
  test("solving the puzzle opens the Solved! modal with the elapsed time", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    // Splat the solution onto the board via the store. We grab the
    // current board + solution in one round-trip, then iterate
    // empty cells client-side. Random puzzles ship the solution
    // to the client (only daily mode hides it), so /play/2 always
    // has `meta.solution` populated.
    await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: {
          getState: () => {
            board: Uint8Array;
            meta: { solution: string | null } | null;
            selectCell: (i: number) => void;
            setMode: (m: "value" | "notes") => void;
            inputDigit: (d: number) => void;
          };
        };
      };
      const st = win.__sudokuStore.getState();
      const solution = st.meta?.solution;
      if (!solution) {
        throw new Error(
          "puzzle 2 has no client-side solution — wrong test fixture?",
        );
      }
      // `inputDigit` no-ops in notes mode unless we explicitly want
      // a note placed; the page may have persisted a previous
      // session's mode, so reset to "value" defensively before the
      // splat loop.
      st.setMode("value");
      for (let i = 0; i < st.board.length; i++) {
        if (st.board[i] !== 0) continue;
        const digit = Number(solution[i]);
        if (Number.isNaN(digit) || digit < 1 || digit > 9) continue;
        st.selectCell(i);
        st.inputDigit(digit);
      }
    });

    // Modal title is the unambiguous signal — it's rendered exactly
    // once in `components/game/completion-modal.tsx`. We use a role
    // query so the test doesn't break if the surrounding markup
    // ever gets restyled.
    await expect(
      page.getByRole("heading", { name: "Solved!" }),
    ).toBeVisible();
  });

  test("the Solved modal renders the elapsed time in mm:ss format", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: {
          getState: () => {
            board: Uint8Array;
            meta: { solution: string | null } | null;
            selectCell: (i: number) => void;
            setMode: (m: "value" | "notes") => void;
            inputDigit: (d: number) => void;
          };
        };
      };
      const st = win.__sudokuStore.getState();
      const solution = st.meta?.solution;
      if (!solution) throw new Error("puzzle 2 has no solution");
      st.setMode("value");
      for (let i = 0; i < st.board.length; i++) {
        if (st.board[i] !== 0) continue;
        st.selectCell(i);
        st.inputDigit(Number(solution[i]));
      }
    });

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    // The modal renders the elapsed time as zero-padded MM:SS (see
    // `formatTime` in `lib/utils.ts`). For a splat-via-store solve
    // the timer hasn't really ticked, so we accept "00:00" through
    // "99:59" — anything matching the format is enough proof the
    // completion modal wired the elapsed-time selector correctly.
    // The label "Time" runs straight into the digits ("Time00:00")
    // so a `\b` word boundary between them wouldn't match — both
    // sides are word chars. We just look for the MM:SS pattern.
    await expect(modal).toContainText(/\d\d:\d\d/);
  });
});
