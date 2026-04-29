import { describe, expect, it } from "vitest";
import { resolveStreakForDisplay } from "./streak";

describe("resolveStreakForDisplay", () => {
  it("prefers stored streak values when they are non-zero", () => {
    const out = resolveStreakForDisplay({
      storedCurrent: 5,
      storedLongest: 12,
      derivedCurrent: 7,
      derivedLongest: 15,
    });
    expect(out).toEqual({ current: 5, longest: 12 });
  });

  it("falls back to derived values when stored values are zero", () => {
    const out = resolveStreakForDisplay({
      storedCurrent: 0,
      storedLongest: 0,
      derivedCurrent: 4,
      derivedLongest: 9,
    });
    expect(out).toEqual({ current: 4, longest: 9 });
  });
});
