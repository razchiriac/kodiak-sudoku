import { expect, test } from "@playwright/test";

// RAZ-73 — Authed: header chrome flips to the signed-in state.
//
// The auth menu (`components/layout/auth-menu.tsx`) is a tiny client
// island that subscribes to `supabase.auth.onAuthStateChange`. With
// a session cookie loaded via `storageState`, it should:
//
//   - hide the "Sign in" link
//   - render a "Profile" link that points at /profile
//   - render a "Sign out" icon button (aria-label="Sign out")
//
// This is the cheapest single test that proves the cookies the
// auth.setup.ts step wrote are actually being read by the
// browser-side Supabase client. If THIS test fails, every other
// authed spec will fail in mysterious ways — so we put it first
// (alphabetical filename order) so it shows up on top of any
// red-suite report.

test.describe("authed: site header", () => {
  test("auth menu flips to Profile + Sign-out when signed in", async ({
    page,
  }) => {
    await page.goto("/");

    // The Sign in CTA must NOT be visible. We use `toHaveCount(0)`
    // rather than `not.toBeVisible()` because the latter passes if
    // the element is hidden via CSS — we want it absent from the
    // DOM entirely (the AuthMenu unmounts the Sign-in branch when
    // a user is present).
    await expect(page.getByRole("link", { name: /^sign in$/i })).toHaveCount(0);

    // Profile link is the "you are signed in" affordance. The link
    // text is hidden on small viewports, so we match by href to
    // stay viewport-agnostic.
    await expect(page.locator('header a[href="/profile"]')).toBeVisible();

    // The sign-out trigger is an icon-only button; aria-label is
    // the stable contract.
    await expect(
      page.getByRole("button", { name: /^sign out$/i }),
    ).toBeVisible();
  });
});
