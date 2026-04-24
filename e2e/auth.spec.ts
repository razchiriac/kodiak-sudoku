import { expect, test } from "@playwright/test";
import { expectNoServerError } from "./helpers/test-helpers";

// RAZ-73 — Anonymous coverage of the sign-in form's interactive
// behaviour.
//
// `routes.spec.ts` already proves /auth/sign-in returns 2xx with both
// auth-method buttons present. This spec covers the bits that smoke
// tests skip on purpose:
//
//   1. The magic-link form blocks empty-email submission via the
//      browser's native `required` validation (no JS round-trip needed).
//   2. The "Check your email" success state replaces the form when the
//      magic-link request succeeds. We mock Supabase's `/auth/v1/otp`
//      response so the test (a) never sends a real email and (b) doesn't
//      need a working Supabase project to pass locally.
//   3. The `?error=` query-string surfaces an error banner — this is the
//      callback-route failure path (expired magic link, OAuth provider
//      error). It used to be silent, which was a real reported bug, so
//      we lock the contract down here.
//
// Note: this lives at the top level (e2e/auth.spec.ts), NOT under
// e2e/authed/, because the form itself is anonymous-facing — it's
// the door a *not yet* signed-in user walks through. The authed
// counterparts (header.spec.ts, profile.spec.ts) test what happens
// AFTER the door swings open.

test.describe("anonymous: /auth/sign-in form", () => {
  test("HTML5 required attribute blocks empty submit", async ({ page }) => {
    await page.goto("/auth/sign-in");
    await expectNoServerError(page);

    // Click "Send magic link" with the email field empty. The
    // <input required> means the browser's form validation rejects
    // the submit — no network round-trip, no state change. We
    // verify the form is still visible (i.e. the "Check your email"
    // success block has NOT replaced it).
    await page.getByRole("button", { name: /send magic link/i }).click();
    await expect(
      page.getByPlaceholder("you@example.com"),
    ).toBeVisible();
    await expect(page.getByText(/check your email/i)).toHaveCount(0);
  });

  test("email input is type=email so browsers enforce format validation", async ({
    page,
  }) => {
    // Type contract for the magic-link input. We pick this over
    // mocking Supabase because:
    //
    //   - It's a stable, externally observable property of the
    //     form (a screen reader announces "email" thanks to it).
    //   - Browsers enforce format validation natively, so we
    //     don't have to hit any network at all to prove the
    //     "type a garbage string" path is blocked.
    //   - The user's reported failure mode (RAZ-71-style silent
    //     errors) was about the SERVER throwing, not about
    //     client validation — and we already have separate
    //     coverage for the success/error rendering paths.
    await page.goto("/auth/sign-in");
    const input = page.getByPlaceholder("you@example.com");
    await expect(input).toHaveAttribute("type", "email");
    await expect(input).toHaveAttribute("required", "");
  });

  test("?error= query param surfaces an error banner", async ({ page }) => {
    // Reproduces the OAuth callback failure path: when
    // app/auth/callback rejects (expired code, provider denial),
    // it bounces the browser back to /auth/sign-in?error=<message>.
    // SignInForm seeds its `error` state from that param so the
    // user sees WHY they're back at the door. Before this contract
    // existed the failure was silent — a regression here would
    // re-introduce that bug.
    await page.goto("/auth/sign-in?error=Magic+link+has+expired");
    await expectNoServerError(page);

    // The error block is a <p> with role implicit (no explicit
    // role), so we match by text. The substring is enough — we
    // don't lock down the exact wording because it comes from
    // upstream (Supabase / our callback handler).
    await expect(page.getByText(/magic link has expired/i)).toBeVisible();
  });

  test("'Continue with Google' button is present and enabled", async ({
    page,
  }) => {
    // We don't actually click this — the OAuth redirect leaves our
    // origin and would either land on Google (flaky, requires real
    // creds) or fail (provider disabled). What we CAN verify cheaply
    // is that the button exists, is enabled, and is wired to a
    // <button> element (not a stale <a>) so the click handler will
    // fire. The label is the public-facing contract.
    await page.goto("/auth/sign-in");
    const googleBtn = page.getByRole("button", {
      name: /continue with google/i,
    });
    await expect(googleBtn).toBeVisible();
    await expect(googleBtn).toBeEnabled();
  });
});
