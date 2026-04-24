// RAZ-72: pattern table + dispatcher tests.
//
// We test:
//   1. Every (event, profile) pair returns a non-empty array of
//      positive integers. This catches typos in the table without
//      being so strict it blocks tuning the values.
//   2. `standard` profile preserves the legacy patterns exactly so
//      existing players see no perceptible change on upgrade.
//   3. `playHaptic` short-circuits cleanly when navigator is absent
//      OR when `enabled` is false, without throwing.
//   4. `playHaptic` calls `navigator.vibrate` with the correct
//      pattern when everything is wired up.

import { afterEach, describe, expect, it, vi } from "vitest";
// eslint exemption: the test file uses `as any` only to bypass the
// strict type signature when forcing an unknown profile id through
// `getProfile`. Documented at the call site.
import {
  getPattern,
  getProfile,
  PROFILES,
  playHaptic,
  type HapticEvent,
  type HapticProfileId,
} from "./patterns";

const EVENTS: HapticEvent[] = [
  "place",
  "conflict",
  "hint",
  "complete",
  "noteToggle",
];
const PROFILE_IDS: HapticProfileId[] = ["subtle", "standard", "strong"];

describe("haptic pattern table", () => {
  // The matrix test. If anyone deletes a pattern by accident, this
  // catches it before the call site silently sends `undefined` into
  // navigator.vibrate.
  for (const profileId of PROFILE_IDS) {
    for (const event of EVENTS) {
      it(`returns a positive pattern for (${profileId}, ${event})`, () => {
        const pattern = getPattern(event, profileId);
        expect(Array.isArray(pattern)).toBe(true);
        expect(pattern.length).toBeGreaterThan(0);
        for (const ms of pattern) {
          expect(Number.isInteger(ms)).toBe(true);
          expect(ms).toBeGreaterThan(0);
          // Sanity: keep individual pulses under 200ms so we never
          // accidentally render a "phone error" buzz on placement.
          expect(ms).toBeLessThan(200);
        }
      });
    }
  }

  // Lock the active "standard" patterns. Originally this test
  // pinned the pre-RAZ-72 patterns (place=[20], conflict=[40,60,40])
  // as a backwards-compat anchor, but RAZ-77 lowered the defaults
  // after multiple players reported them as too strong on
  // modern actuators. The lock is still useful — it forces anyone
  // tuning these values to make a deliberate change and update the
  // assertion — but the values now reflect the post-RAZ-77 shipping
  // defaults rather than the original RAZ-72 ones.
  it("locks the active standard patterns", () => {
    expect(getPattern("place", "standard")).toEqual([14]);
    expect(getPattern("conflict", "standard")).toEqual([22, 50, 22]);
    expect(getPattern("hint", "standard")).toEqual([16]);
    expect(getPattern("complete", "standard")).toEqual([35, 30, 35, 30, 35]);
    expect(getPattern("noteToggle", "standard")).toEqual([12]);
  });

  // Profile bookkeeping.
  it("exposes exactly the three v1 profiles in display order", () => {
    expect(PROFILES.map((p) => p.id)).toEqual(["subtle", "standard", "strong"]);
  });

  it("falls back to standard for unknown profile ids", () => {
    // Cast through unknown so the test compiles while explicitly
    // simulating "persisted state from a future / corrupted version".
    const unknown = "ultra" as unknown as HapticProfileId;
    expect(getProfile(unknown).id).toBe("standard");
  });
});

describe("playHaptic dispatcher", () => {
  // We use `vi.stubGlobal` rather than direct `globalThis.navigator =`
  // assignment because the node test env sometimes installs `navigator`
  // as a getter-only property; `stubGlobal` knows how to redefine it
  // safely. `unstubAllGlobals` after each test restores the original.
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns false and does nothing when enabled=false", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(playHaptic("place", "standard", false)).toBe(false);
    expect(vibrate).not.toHaveBeenCalled();
  });

  it("returns false when navigator.vibrate is missing", () => {
    // We stub navigator to an object that has no `vibrate` so the
    // `typeof nav.vibrate !== "function"` branch fires. Stubbing to
    // `undefined` is platform-fragile (some Node releases throw on
    // it), so we exercise the no-vibrate path instead — it's the
    // exact same short-circuit that runs when navigator itself is
    // undefined.
    vi.stubGlobal("navigator", {});
    expect(playHaptic("place", "standard", true)).toBe(false);
  });

  it("calls vibrate with the correct pattern when wired up", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });
    expect(playHaptic("conflict", "strong", true)).toBe(true);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith([60, 80, 60, 80, 60]);
  });

  it("swallows vibrate exceptions and returns false", () => {
    const vibrate = vi.fn(() => {
      throw new Error("user gesture required");
    });
    vi.stubGlobal("navigator", { vibrate });
    expect(() => playHaptic("place", "standard", true)).not.toThrow();
    expect(playHaptic("place", "standard", true)).toBe(false);
  });
});
