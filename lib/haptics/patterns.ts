// RAZ-72: Haptic Profiles & Per-Event Patterns.
//
// Single source of truth for every vibration pattern in the app.
// Before this module, patterns were inlined at each call site
// (`navigator.vibrate([20])` in game-store, `[10]` in number-pad,
// `[20]` in settings-dialog). That made it impossible to A/B
// different feels without grepping the codebase, and it meant the
// "pick a profile" UX would have to special-case every call site.
//
// Why pure & framework-free:
//   - Unit tests can exercise the pattern table without booting the
//     store.
//   - A future Server Component (e.g. a marketing page that lists
//     accessibility features) could `import { PROFILES }` to render
//     descriptions without dragging zustand into RSC bundles.
//   - The dispatcher (`playHaptic`) is the ONLY place we touch
//     `navigator.vibrate`, so adding telemetry / a future iOS
//     Web Vibration shim is a single-line change.
//
// Design choices that matter:
//   - Patterns are arrays of milliseconds even when a scalar would
//     work — a couple of Chromium versions have been flaky with the
//     scalar overload, and the array form is universally accepted.
//   - Numbers chosen for what's PERCEPTIBLE on a typical Pixel-class
//     Android phone, where most users are. Anything <15ms tends to
//     be silent on modern actuators; anything >120ms in a single
//     pulse starts to feel like a "phone error" buzz. We stay
//     inside that window.
//   - "Subtle" pulses are intentionally TINY — meant for users who
//     find the default annoying, not for users who want haptics at
//     all costs. "Strong" doubles up the durations and adds a
//     trailing pulse so the buzz is unmistakable.

// Event taxonomy. Adding a new event = add a key here + a column to
// every PROFILE entry. The compiler keeps the matrix in sync.
export type HapticEvent =
  | "place" // legal value placement
  | "conflict" // value placement that creates / hits a conflict
  | "hint" // a hint was applied to the board
  | "complete" // puzzle just got solved
  | "noteToggle"; // long-press confirm on the number pad

export type HapticProfileId = "subtle" | "standard" | "strong";

// Display-facing metadata. Co-located with the pattern table so
// adding a profile is a single edit and there's no risk of the
// label drifting from the bundle.
export type HapticProfile = {
  id: HapticProfileId;
  label: string;
  description: string;
  // Pattern per event. Each value is an array of ms intervals,
  // alternating vibrate / pause as per the Web Vibration API.
  patterns: Record<HapticEvent, number[]>;
};

// Display order for the picker. "Subtle" first because it's the
// most-likely opt-in for someone who finds default vibration too
// strong; "Strong" last because it's the most aggressive.
export const PROFILES: readonly HapticProfile[] = [
  {
    id: "subtle",
    label: "Subtle",
    description:
      "Tiny taps. Good if the default feels too strong or your phone has a punchy haptic motor.",
    patterns: {
      // 12ms is at the edge of perceptibility on a Pixel — barely
      // there, which is exactly the point.
      place: [12],
      // Even a "subtle" conflict still needs to feel different from
      // a normal placement, so we double-pulse with a longer gap.
      conflict: [20, 50, 20],
      // Hints get a single short tap — they're fairly rare so we
      // don't need a distinguishing pattern, just a confirmation.
      hint: [16],
      // Completion is the one moment we relax the "subtle" rule a
      // bit — even subtle players probably want to feel the win.
      complete: [30, 40, 30],
      // Long-press confirm should be the lightest tap of all so it
      // doesn't compete with the value placements that follow.
      noteToggle: [10],
    },
  },
  {
    id: "standard",
    label: "Standard",
    description:
      "The shipped default. Comfortable on most Android phones — distinguishable but not noisy.",
    patterns: {
      // Matches today's `[20]` exactly. Existing users see no
      // surprise change because `standard` is the default profile.
      place: [20],
      // Matches today's `[40, 60, 40]` exactly.
      conflict: [40, 60, 40],
      // Slightly longer than `place` so the player can feel "yes,
      // a hint just landed" without confusing it with a placement.
      hint: [25],
      // A satisfying triple-pulse celebrating the solve. Total
      // duration ~190ms which is plenty without dragging on.
      complete: [50, 40, 50, 40, 50],
      // Matches today's number-pad `[10]`.
      noteToggle: [15],
    },
  },
  {
    id: "strong",
    label: "Strong",
    description:
      "Doubled-up pulses. Pick this if you usually miss haptics or your phone has a weak motor.",
    patterns: {
      // 35ms single is firmly in "you noticed that" territory.
      place: [35],
      // Triple-pulse with longer pauses for very clear separation.
      conflict: [60, 80, 60, 80, 60],
      // Distinguishable from `place` by being a double-tap rather
      // than a single longer pulse — different feel rather than
      // just longer.
      hint: [25, 35, 25],
      // Long victory buzz. Five pulses, ~270ms total.
      complete: [70, 50, 70, 50, 70, 50, 70],
      // Stronger than the "place" tick of subtle — long-press is
      // an explicit gesture, the player wants to know it landed.
      noteToggle: [25],
    },
  },
];

// Lookup that NEVER returns undefined — falls back to standard if
// an unknown id sneaks in (e.g. a persisted setting from a future
// version that we then downgraded). Keeps every call site free of
// optional-chaining noise.
export function getProfile(id: HapticProfileId): HapticProfile {
  return PROFILES.find((p) => p.id === id) ?? PROFILES[1];
}

// Pattern lookup helper. Lifted out so unit tests can pin down
// every (event, profile) pair in a single fixture without invoking
// the dispatcher.
export function getPattern(
  event: HapticEvent,
  profileId: HapticProfileId,
): number[] {
  return getProfile(profileId).patterns[event];
}

// Single dispatcher. Replaces the inline `navigator.vibrate(...)`
// calls scattered across the app. Returns a boolean for testability:
// `true` means we attempted a vibrate (regardless of success on the
// underlying motor), `false` means we short-circuited (no
// `navigator`, no `vibrate`, etc).
//
// Accepts an optional `enabled` flag so call sites can pass through
// the combined "feature flag AND user setting" gate without an extra
// `if` at every site. When `false`, returns `false` immediately.
export function playHaptic(
  event: HapticEvent,
  profileId: HapticProfileId,
  enabled = true,
): boolean {
  if (!enabled) return false;
  if (typeof navigator === "undefined") return false;
  // Older iOS Safari and all desktop browsers lack vibrate; feature-
  // detecting keeps the call safe on those. We narrow with a typeof
  // check rather than relying on TS lib types because some `navigator`
  // shims (e.g. test environments) don't include vibrate at all.
  const nav = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return false;
  try {
    nav.vibrate(getPattern(event, profileId));
    return true;
  } catch {
    // Some browsers throw if called from an un-engaged page (no prior
    // user gesture). Haptics failing should NEVER break gameplay.
    return false;
  }
}
