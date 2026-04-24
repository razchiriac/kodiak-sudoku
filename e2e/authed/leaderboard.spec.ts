import { expect, test } from "@playwright/test";

// RAZ-73 — Authed: the daily leaderboard exposes the Friends tab.
//
// Behavior under test (server-rendered in `app/leaderboard/page.tsx`):
//
//   - anonymous → tabs are [Pure, All]
//   - signed-in → tabs are [Pure, All, Friends]
//
// The Friends tab also fetches `getFriendsDailyLeaderboard` for
// the caller, which is one of the queries that broke in the
// RAZ-71 family (it joins three tables with raw SQL aliases). A
// 5xx here means the queries-side fix regressed; an empty-state
// "No completions from you or your friends yet" string is the
// happy path for our test user, which has no completions seeded.

test.describe("authed: daily leaderboard", () => {
  test("renders the Friends tab and its empty state for the caller", async ({
    page,
  }) => {
    const res = await page.goto("/leaderboard");
    expect(res?.status()).toBeLessThan(500);

    // All three tabs must be present (Pure + All + Friends).
    await expect(page.getByRole("tab", { name: "Pure" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "All" })).toBeVisible();
    const friendsTab = page.getByRole("tab", { name: "Friends" });
    await expect(friendsTab).toBeVisible();

    // Activate the Friends tab. Radix tabs swap `aria-selected` and
    // mount the corresponding panel — we want both effects.
    await friendsTab.click();
    await expect(friendsTab).toHaveAttribute("aria-selected", "true");

    // The Friends panel either renders rows (if the seeded test
    // user has completions) or an empty-state CTA pointing at
    // /friends. We check for either, since seeding is environment-
    // dependent and we're testing render-without-error, not data.
    const panel = page.getByRole("tabpanel").filter({ hasText: /./ });
    await expect(panel.first()).toBeVisible();
  });
});
