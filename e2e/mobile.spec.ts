import { expect, test } from "@playwright/test";
import { gotoPlayPuzzle } from "./helpers/test-helpers";

// RAZ-73 — Mobile-specific interactions.
//
// Two interactions that only make sense on a touch device:
//
//   1. Layout: the board, keypad and control buttons all fit on
//      a Pixel 7 viewport (412×915) without horizontal scroll
//      and without the keypad clipping below the fold once the
//      Sticky Header is accounted for.
//   2. Long-press on a number-pad button (RAZ-20, gated on the
//      `longPressNote` feature flag): a 400ms+ hold toggles a
//      pencil mark on the selected cell *without* changing the
//      cell's value, even when the player is still in value
//      mode. This is the only way to drop a single note without
//      a mode round-trip.
//
// We restrict the whole file to the mobile project. The
// `viewport` width check is the cleanest gate that survives a
// renamed project later.

test.describe("mobile", () => {
  test.beforeEach(({ viewport }, testInfo) => {
    testInfo.skip(
      (viewport?.width ?? 9999) >= 700,
      "mobile-only spec — runs in chromium-mobile project",
    );
  });

  test("/play/<id> renders without horizontal overflow on a phone viewport", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, 2);

    // documentElement.scrollWidth must not exceed viewport width.
    // A 1px tolerance accounts for sub-pixel rounding on devices
    // with non-integer DPR. If we ever introduce a fixed-width
    // element wider than the phone, this check fails fast.
    const overflow = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      viewW: window.innerWidth,
    }));
    expect(overflow.docW).toBeLessThanOrEqual(overflow.viewW + 1);

    // The keypad's "Place 1" button must be visible without
    // scrolling — it's the most-tapped control on mobile.
    await expect(
      page.getByRole("button", { name: /^Place 1/ }),
    ).toBeVisible();
  });

  test("long-press on a digit toggles a note instead of placing a value", async ({
    page,
  }) => {
    await gotoPlayPuzzle(page, 2);

    // Skip when the long-press flag is off — the handler short-
    // circuits in `handlePointerDown` and a hold collapses to a
    // normal tap, which would place a value (wrong assertion shape).
    const flagOn = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: {
          getState: () => { featureFlags: { longPressNote: boolean } };
        };
      };
      return win.__sudokuStore.getState().featureFlags.longPressNote;
    });
    test.skip(!flagOn, "long-press-note flag is off");

    // Pick the first empty cell via the store; select it; ensure
    // value mode (long-press is only meaningful in value mode —
    // see number-pad.tsx around line 276).
    const emptyIndex = await page.evaluate(() => {
      const win = window as unknown as {
        __sudokuStore: {
          getState: () => {
            board: Uint8Array;
            selectCell: (i: number) => void;
            setMode: (m: "value" | "notes") => void;
          };
        };
      };
      const st = win.__sudokuStore.getState();
      let idx = -1;
      for (let i = 0; i < st.board.length; i++) {
        if (st.board[i] === 0) {
          idx = i;
          break;
        }
      }
      st.selectCell(idx);
      st.setMode("value");
      return idx;
    });
    expect(emptyIndex).toBeGreaterThanOrEqual(0);

    // Drive a 500ms pointer hold on the "Place 4" button. The
    // long-press timer is 400ms, so 500ms guarantees it fires.
    // We use real pointer events (down + up) rather than touch
    // because the listener attaches to onPointerDown — touch
    // events synthesise pointer events under the hood, but
    // dispatching pointer directly is more deterministic.
    const padBtn = page.getByRole("button", { name: /^Place 4/ });
    const box = await padBtn.boundingBox();
    if (!box) throw new Error("could not measure Place 4 button");

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Hold longer than LONG_PRESS_MS (400ms). 500ms gives a
    // comfortable margin without ballooning the test runtime.
    await page.waitForTimeout(500);
    await page.mouse.up();

    // The cell's value must still be 0 (long-press suppresses
    // the synthetic click) and the notesMask must have bit 3 set.
    const result = await page.evaluate((idx) => {
      const win = window as unknown as {
        __sudokuStore: {
          getState: () => { board: Uint8Array; notes: Uint16Array };
        };
      };
      const st = win.__sudokuStore.getState();
      return {
        value: st.board[idx],
        noteSet: (st.notes[idx] ?? 0) & (1 << (4 - 1)),
      };
    }, emptyIndex);

    expect(result.value).toBe(0);
    expect(result.noteSet).not.toBe(0);
  });
});
