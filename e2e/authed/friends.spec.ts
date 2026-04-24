import { expect, test } from "@playwright/test";

// RAZ-73 — Authed: friends page renders without 500.
//
// /friends is one of the routes that historically broke in the
// RAZ-71 family of bugs (raw SQL alias mismatches in
// `lib/server/friends.ts` produced a Postgres "invalid reference
// to FROM-clause" 500 only on signed-in calls). Anonymous users
// never see this page — they're redirected to sign-in — so this
// is one of the highest-value authed checks.

test.describe("authed: friends", () => {
  test("/friends renders the heading and the request form", async ({
    page,
  }) => {
    const res = await page.goto("/friends");
    // 5xx is the bug class we care about most; 2xx and 3xx are
    // both fine (redirect → still-authed → page render).
    expect(res?.status()).toBeLessThan(500);

    await expect(
      page.getByRole("heading", { level: 1, name: /^friends/i }),
    ).toBeVisible();

    // The request form is the unconditional control on the page —
    // it's how a user starts a new friendship. The exact label
    // ("Add a friend", "Send request", etc.) lives in
    // app/friends/request-form.tsx; we use a fuzzy regex against
    // the input/placeholder rather than a brittle string match.
    await expect(
      page.getByRole("textbox").or(page.getByPlaceholder(/username/i)).first(),
    ).toBeVisible();
  });
});
