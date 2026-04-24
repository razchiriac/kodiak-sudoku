import { expect, test } from "@playwright/test";

// RAZ-73 — Custom puzzle paste flow.
//
// /play/custom is the RAZ-35 "paste any 81-digit board, play it
// here" entry point. It's flag-gated; when the flag is off the
// route 404s. We auto-skip in that case so a flag flip in Edge
// Config doesn't take the suite down.
//
// We use the well-known placeholder puzzle as the valid input —
// it's a real, solvable Sudoku that the validation server action
// accepts. For the invalid-input path we feed three characters,
// which fails the length check before any solver work.

const VALID_PUZZLE = [
  "530070000",
  "600195000",
  "098000060",
  "800060003",
  "400803001",
  "700020006",
  "060000280",
  "000419005",
  "000080079",
].join("\n");

test.describe("custom puzzle paste flow", () => {
  test("a valid 81-digit board lands on /play/custom/<hash> with a grid", async ({
    page,
  }) => {
    const res = await page.goto("/play/custom");
    test.skip(res?.status() === 404, "custom-puzzle flag is off");
    expect(res?.status()).toBeLessThan(400);

    await page.getByLabel("Puzzle").fill(VALID_PUZZLE);
    // The submit button label flips to "Validating…" while the
    // server action runs; we click the initial label and let
    // Playwright auto-wait for the navigation.
    await Promise.all([
      page.waitForURL(/\/play\/custom\/[a-f0-9]+/),
      page.getByRole("button", { name: "Play this puzzle" }).click(),
    ]);

    await expect(page.getByRole("grid", { name: /sudoku/i })).toBeVisible();
  });

  test("an obviously invalid board surfaces an inline error and stays on the form", async ({
    page,
  }) => {
    const res = await page.goto("/play/custom");
    test.skip(res?.status() === 404, "custom-puzzle flag is off");

    await page.getByLabel("Puzzle").fill("nope");
    await page.getByRole("button", { name: "Play this puzzle" }).click();

    // The form renders inline errors with role=alert (see
    // import-form.tsx). We don't assert the exact message string —
    // copy can change — only that some error landed and the URL
    // didn't navigate away from the form.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL(/\/play\/custom\/?$/);
  });
});
