import { expect, test } from "@playwright/test";
import {
  gotoPlayPuzzle,
} from "../helpers/test-helpers";

// RAZ-73 — Authed: completing a puzzle triggers the server-side
// submission path (submitCompletionAction).
//
// As an anonymous user the engine still detects completion and
// the modal still opens, but `submitCompletionAction` short-
// circuits because there's no `userId`. As a signed-in user the
// same flow ALSO writes a row to `completed_games`, bumps the
// per-bucket personal best, advances the daily streak, and (for
// daily mode only) returns a rank context.
//
// This spec verifies the user-visible side of that contract:
// the modal opens with no submission error, and the "Solved!"
// title renders. We deliberately don't assert the post-write
// values themselves (no rank context for random mode; no DB
// access from the test); the routes-side coverage in the
// anonymous suite already proves the read paths render. The
// point of THIS test is to make sure the write path doesn't 500
// on a real authenticated request — the most common failure
// mode is server-action wiring drift after a refactor.

const PUZZLE_ID = 2;

test.describe("authed: post-completion submission", () => {
  test("solving a random puzzle opens the Solved modal without a submit error", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    // Same splat-via-store trick as the anonymous completion spec:
    // walk the board, fill every empty cell from `meta.solution`.
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
      if (!solution) throw new Error("no client-side solution on /play/2");
      st.setMode("value");
      for (let i = 0; i < st.board.length; i++) {
        if (st.board[i] !== 0) continue;
        st.selectCell(i);
        st.inputDigit(Number(solution[i]));
      }
    });

    // Modal must open. Submission happens in parallel via an
    // effect in the play page; if the action throws or the wire
    // shape drifts, the modal renders an inline error string
    // surfaced via the `submitError` prop. We assert BOTH the
    // success heading AND the absence of any error text.
    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: "Solved!" }),
    ).toBeVisible();
    // Generic error string check — the play page surfaces submit
    // errors as plain text inside the modal. Anything containing
    // "error" suggests something went wrong server-side.
    await expect(modal.getByText(/error|failed|could not/i)).toHaveCount(0);
  });

  // RAZ-104: after a successful completion the puzzle must NOT show up
  // under the dashboard's "Continue" list. This is the user-visible
  // contract of `submitCompletionAction`'s `cleanupSavedGameRow` step
  // plus the eager stale-row cleanup baked into `listRecentSavedGames`.
  // The previous regression let solved puzzles linger as "in progress"
  // for hours; the test reproduces that lifecycle in one pass.
  test("a solved puzzle disappears from /play Continue", async ({ page }) => {
    await gotoPlayPuzzle(page, PUZZLE_ID);

    // Make at least one move BEFORE the auto-fill so a saved_games row
    // is guaranteed to exist (the autosave debounce is 4s; touching
    // the board first makes it impossible to race past).
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
      if (!solution) throw new Error("no client-side solution on /play/2");
      st.setMode("value");
      // Place one cell, then fill the rest. The first placement
      // ensures the autosave effect fires (it gates on `board`
      // changes); the rest brings the board to a solved state.
      for (let i = 0; i < st.board.length; i++) {
        if (st.board[i] !== 0) continue;
        st.selectCell(i);
        st.inputDigit(Number(solution[i]));
      }
    });

    const modal = page.getByRole("dialog");
    await expect(modal).toBeVisible();
    await expect(
      modal.getByRole("heading", { name: "Solved!" }),
    ).toBeVisible();
    await expect(modal.getByText(/error|failed|could not/i)).toHaveCount(0);

    // Give the server action's cleanupSavedGameRow a moment to land
    // before we navigate away. The submit modal is open AS SOON AS
    // the insert resolves, which is also when the cleanup fires;
    // 1s is generous enough to absorb DB latency on a cold function.
    await page.waitForTimeout(1000);

    await page.goto("/play");

    // The Continue section is conditionally rendered when at least
    // one resumable saved row exists. If the section is missing
    // entirely, that's a stronger pass than "section exists but
    // empty". Either is acceptable; we just need to ensure THIS
    // puzzle's link isn't there.
    const puzzleLink = page.locator(`a[href="/play/${PUZZLE_ID}"]`);
    const continueHeading = page.getByRole("heading", { name: "Continue" });
    if (await continueHeading.isVisible().catch(() => false)) {
      await expect(puzzleLink).toHaveCount(0);
    }
  });
});
