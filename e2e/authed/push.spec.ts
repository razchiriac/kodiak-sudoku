import { expect, test } from "@playwright/test";

// RAZ-73 — Authed: push-notification opt-in toggle on /profile/edit.
//
// The toggle (`components/profile/push-toggle.tsx`) is a client island
// that:
//   - returns `null` if the browser doesn't expose `serviceWorker` +
//     `PushManager`, OR if `NEXT_PUBLIC_VAPID_PUBLIC_KEY` is unset.
//   - otherwise renders a "Daily reminders" card with a Bell/BellOff
//     icon and a Turn on / Turn off button.
//
// We deliberately don't drive a real subscribe round-trip:
//
//   - It would require a registered Service Worker (`/sw.js`) which is
//     not in the repo today (`public/sw.js` is generated at deploy time
//     by next-pwa or similar, not committed).
//   - It would dispatch a real `pushManager.subscribe()` call against
//     Mozilla autopush / FCM — that's a third-party network round-trip
//     we don't want in tests.
//   - The browser permission prompt is non-deterministic across
//     Playwright's headless / headed modes.
//
// Instead we cover the contract that's testable without those moving
// parts: when the env IS set, the toggle renders correctly; when it
// ISN'T, the page still loads cleanly. Either branch is a valid PASS.
// This catches the common regression — a typo in
// `components/profile/push-toggle.tsx` that throws on mount and turns
// the whole /profile/edit page red — without coupling us to a working
// push pipeline.

test.describe("authed: /profile/edit push toggle", () => {
  test("renders the Daily reminders card OR cleanly omits it", async ({
    page,
    context,
  }) => {
    // Grant notifications up-front. Without this, browsers default
    // to "default" which the component treats as supported but the
    // user hasn't decided yet. Granting matches the "happy path"
    // we want to test: a user who's already opted in at the OS
    // level visiting the page.
    //
    // Granting is a no-op when the toggle is hidden because of a
    // missing VAPID key — the permission just never gets queried.
    await context.grantPermissions(["notifications"]);

    await page.goto("/profile/edit");

    // The toggle's parent card is identified by the heading copy
    // "Daily reminders" (a <p className="text-sm font-medium">).
    // Two valid outcomes:
    //
    //   1. NEXT_PUBLIC_VAPID_PUBLIC_KEY is set in this env →
    //      the card renders. We assert the copy + button.
    //   2. The env var is unset (the default for a fresh local
    //      checkout — see SKILL note in components/profile/push-
    //      toggle.tsx). The component returns null and we assert
    //      the card is absent.
    //
    // Either way, the /profile/edit page itself must render — the
    // Username field is the universal anchor (it's there
    // regardless of toggle visibility).
    await expect(page.getByLabel(/username/i)).toBeVisible();

    const card = page.getByText(/daily reminders/i);
    const cardCount = await card.count();

    if (cardCount === 0) {
      // Path 2: VAPID env is unset. The card is intentionally
      // absent. Nothing more to verify — the absence IS the
      // contract.
      return;
    }

    // Path 1: VAPID env is set. The Turn-on button is the
    // primary CTA when the user is not yet subscribed; the
    // Turn-off button is its mirror. We accept either, because
    // a previous test run (or a dev session) might have left
    // the test user subscribed already.
    const turnOn = page.getByRole("button", { name: /^turn on$/i });
    const turnOff = page.getByRole("button", { name: /^turn off$/i });

    // Exactly one of these should be present and enabled. We
    // express that with `.or()` so the assertion message is
    // useful when neither is found.
    await expect(turnOn.or(turnOff)).toBeVisible();
    await expect(turnOn.or(turnOff)).toBeEnabled();
  });
});
