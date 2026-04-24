import { expect, test } from "@playwright/test";

// RAZ-73 — Authed: friends server action wiring (negative path).
//
// Sending a friend request to a guaranteed-non-existent username
// is the single test that proves:
//
//   1. The form's `useTransition` server-action call reaches the
//      server (a wire failure would produce a generic toast or
//      throw).
//   2. The server action's Zod input validation passes for a
//      well-formed username.
//   3. The action's `user_not_found` error code maps to the
//      copy in `app/friends/request-form.tsx`'s ERROR_COPY.
//
// We pick a username built from a long random suffix to make the
// "not found" outcome deterministic regardless of seed data, and
// we don't try to test the happy path because that would mutate
// shared state across runs (creating real friendships).

test.describe("authed: friends action wiring", () => {
  test("sending a request to a missing username surfaces the user_not_found toast", async ({
    page,
  }) => {
    const res = await page.goto("/friends");
    expect(res?.status()).toBeLessThan(500);

    // The form's input has `aria-label="Friend username"` per the
    // request-form.tsx component. We type a guaranteed-missing
    // username — long, opaque, prefixed with a marker so it's
    // obvious in any DB inspection where the value came from.
    const username = `e2e-missing-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    await page.getByLabel("Friend username").fill(username);
    await page.getByRole("button", { name: /send/i }).click();

    // The error path uses sonner — the toast is rendered into a
    // portal at `<ol role="status">` (sonner's default). The
    // ERROR_COPY map says "No user with that username." for
    // `user_not_found`; we match a fuzzy regex to insulate this
    // test from minor copy edits.
    await expect(page.getByText(/no user with that username/i)).toBeVisible({
      timeout: 5_000,
    });
  });
});
