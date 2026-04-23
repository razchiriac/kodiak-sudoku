import { describe, expect, it } from "vitest";
import { HINT_LIMITS } from "./rate-limit-config";

// Sanity tests for the rate-limit constants. We don't hit the DB here
// because spinning up a postgres instance in unit tests would bloat
// the runtime; the module's pure parts (window config) is what we
// assert, and the DB path is exercised by integration tests when we
// add them.

describe("HINT_LIMITS", () => {
  it("defines at least two windows (burst + sustained)", () => {
    // The whole point of the dual-window design is to catch both
    // script-speed bursts AND slow scrapers. One limit alone would
    // leave a gap: a burst-only limit is easy to pace around; a
    // sustained-only limit is loose enough to script around.
    expect(HINT_LIMITS.length).toBeGreaterThanOrEqual(2);
  });

  it("every window has a positive max and windowMs", () => {
    for (const w of HINT_LIMITS) {
      expect(w.max).toBeGreaterThan(0);
      expect(w.windowMs).toBeGreaterThan(0);
      expect(w.label.length).toBeGreaterThan(0);
    }
  });

  it("windows are ordered shortest-first (burst before sustained)", () => {
    // checkRateLimit evaluates windows in order. Putting the burst
    // window first means a rapid-fire caller gets the most specific
    // "3 per minute" message instead of the vaguer hourly cap.
    for (let i = 1; i < HINT_LIMITS.length; i++) {
      expect(HINT_LIMITS[i].windowMs).toBeGreaterThanOrEqual(
        HINT_LIMITS[i - 1].windowMs,
      );
    }
  });

  it("hourly cap is strictly greater than burst cap", () => {
    // Guard against a tuning error where someone accidentally sets
    // the hourly cap to 3 and the minute cap to 30, which would
    // invert the intent and let a slow scraper through.
    const burst = HINT_LIMITS[0];
    const sustained = HINT_LIMITS[HINT_LIMITS.length - 1];
    expect(sustained.max).toBeGreaterThan(burst.max);
  });
});
