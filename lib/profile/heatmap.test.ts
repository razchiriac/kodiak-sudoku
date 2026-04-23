import { describe, expect, it } from "vitest";
import {
  bucketSolves,
  formatHour,
  intensity,
  summarize,
  WEEKDAY_LABELS,
} from "./heatmap";

// RAZ-31 — unit tests for the heatmap bucketing helpers.

// `new Date(year, monthIndex, day, hour)` uses local time, which
// is what the bucketing code also uses — so the tests match the
// component's runtime contract regardless of CI timezone.

describe("bucketSolves", () => {
  it("returns a 7x24 grid of zeros for no timestamps", () => {
    const grid = bucketSolves([]);
    expect(grid).toHaveLength(7);
    expect(grid[0]).toHaveLength(24);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("increments the right (weekday, hour) bucket for a single solve", () => {
    // 2026-04-23 was a Thursday (day index 4). Hour 7 local.
    const ts = new Date(2026, 3, 23, 7, 30);
    const grid = bucketSolves([ts]);
    expect(grid[4][7]).toBe(1);
    // Every other cell should still be zero.
    const total = grid.flat().reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  it("accumulates multiple solves in the same bucket", () => {
    const a = new Date(2026, 3, 23, 7, 0);
    const b = new Date(2026, 3, 23, 7, 45);
    const c = new Date(2026, 3, 30, 7, 15); // another Thursday 7am
    const grid = bucketSolves([a, b, c]);
    expect(grid[4][7]).toBe(3);
  });

  it("ignores NaN dates and non-Date inputs", () => {
    const nanDate = new Date("not-a-date");
    // Cast through `unknown` so we can verify the runtime guard
    // (`instanceof Date`) without fighting the type system. We
    // really do want to feed it garbage to prove it doesn't
    // pollute the grid.
    const inputs = [nanDate, new Date(2026, 3, 23, 7, 0), "oops"] as unknown as Date[];
    const grid = bucketSolves(inputs);
    expect(grid.flat().reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe("summarize", () => {
  it("finds the peak bucket and reports max/total", () => {
    const grid = bucketSolves([
      // Thursday 7am x 3
      new Date(2026, 3, 23, 7, 0),
      new Date(2026, 3, 23, 7, 30),
      new Date(2026, 3, 30, 7, 0),
      // Monday 9am x 1
      new Date(2026, 3, 27, 9, 0),
    ]);
    const stats = summarize(grid);
    expect(stats.total).toBe(4);
    expect(stats.max).toBe(3);
    expect(stats.peak).toEqual({ weekday: 4, hour: 7, count: 3 });
  });

  it("returns null peak when there are no solves", () => {
    const grid = bucketSolves([]);
    const stats = summarize(grid);
    expect(stats.total).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.peak).toBeNull();
  });
});

describe("intensity", () => {
  it("returns 0 when count or max is zero", () => {
    expect(intensity(0, 10)).toBe(0);
    expect(intensity(5, 0)).toBe(0);
  });

  it("returns 1 when count equals max", () => {
    expect(intensity(7, 7)).toBe(1);
  });

  it("uses a sqrt curve so mid values are bumped above linear", () => {
    // At count = max/4, linear would give 0.25 but sqrt gives 0.5.
    expect(intensity(1, 4)).toBeCloseTo(0.5, 5);
  });
});

describe("formatHour", () => {
  it("formats the 12-hour boundaries correctly", () => {
    expect(formatHour(0)).toBe("12a");
    expect(formatHour(12)).toBe("12p");
  });

  it("formats morning and afternoon hours", () => {
    expect(formatHour(7)).toBe("7a");
    expect(formatHour(13)).toBe("1p");
    expect(formatHour(23)).toBe("11p");
  });
});

describe("WEEKDAY_LABELS", () => {
  it("lines up with Date.getDay() (0=Sun)", () => {
    // getDay returns 0-6 Sun-Sat; labels should mirror that.
    expect(WEEKDAY_LABELS[0]).toBe("Sun");
    expect(WEEKDAY_LABELS[6]).toBe("Sat");
    expect(WEEKDAY_LABELS).toHaveLength(7);
  });
});
