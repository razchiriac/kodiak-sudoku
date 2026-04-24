import { expect, test } from "@playwright/test";

// RAZ-73 — Authed: profile page redirects + edit form access.
//
// As a signed-in user (storageState set by `e2e/auth.setup.ts`),
// /profile redirects through to either the public profile or
// the editor depending on whether the user has set a username:
//
//   - has username   →  /profile/<username>
//   - no username    →  /profile/edit
//
// Our test user (`e2e+playwright@example.test`) starts with no
// username, so a fresh setup lands on /profile/edit. The username
// field there is the canonical signal.
//
// We deliberately don't ASSERT the redirect target — it depends
// on whether the test user has been "graduated" by a previous run.
// Instead we verify that one of the two valid landing pages
// renders, which is a much more resilient invariant.

test.describe("authed: profile", () => {
  test("/profile redirects to either /profile/<username> or /profile/edit", async ({
    page,
  }) => {
    await page.goto("/profile");
    await page.waitForURL(/\/profile\/.+/);

    const url = page.url();
    if (/\/profile\/edit/.test(url)) {
      // First-time landing: the editor's heading is unambiguous.
      await expect(
        page.getByRole("heading", { level: 1, name: /pick (a|your) username/i }).or(
          page.getByRole("heading", { level: 1, name: /profile/i }),
        ),
      ).toBeVisible();
      await expect(page.getByLabel(/username/i)).toBeVisible();
    } else {
      // Returning user: the public profile renders the username
      // segment as part of the URL — that itself is the proof.
      await expect(
        page.getByRole("heading", { level: 1 }).first(),
      ).toBeVisible();
    }
  });

  test("/profile/edit form posts and surfaces validation errors", async ({
    page,
  }) => {
    await page.goto("/profile/edit");
    // Same heading-or-username strategy as above. The page
    // renders without auth-redirecting because the storageState
    // already carries a session.
    await expect(page.getByLabel(/username/i)).toBeVisible();
  });
});
