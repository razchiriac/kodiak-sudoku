// RAZ-31 — pure helpers for the profile solve-heatmap.
//
// Separated from the React component so unit tests can cover the
// bucketing and intensity logic without JSDOM. The component just
// consumes these functions.

/**
 * A 7x24 grid of solve counts, indexed by [weekday][hour].
 *
 * Weekday is 0-6 with 0=Sunday (matching Date.prototype.getDay),
 * hour is 0-23 (matching getHours). This matches the natural
 * row/col order most English-speaking users expect (Sun at the
 * top, midnight on the left).
 *
 * We return a plain nested array (not a flat Int32Array) because
 * the downstream consumer is React JSX that iterates rows/cols.
 */
export type HeatmapGrid = number[][];

/** Build the 7x24 grid from a set of timestamps.
 *
 * Timestamps are bucketed using the host's local `Date` methods
 * (getDay / getHours), which means the caller's timezone. On the
 * server that's UTC; in a browser it's the viewer's tz. The profile
 * page calls this from a client component so buckets reflect the
 * viewer's local wall clock.
 */
export function bucketSolves(timestamps: Iterable<Date>): HeatmapGrid {
  const grid: HeatmapGrid = Array.from({ length: 7 }, () =>
    Array(24).fill(0),
  );
  for (const ts of timestamps) {
    // Guard against bad input: completed_at is non-null in the DB
    // but we might be fed junk via tests. A NaN date silently
    // landing in grid[NaN][NaN] would pollute the output; better
    // to skip and move on.
    if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) continue;
    const dow = ts.getDay();
    const hour = ts.getHours();
    grid[dow][hour] += 1;
  }
  return grid;
}

/** Derived stats for the heatmap caption. */
export type HeatmapStats = {
  /** Total solves counted in the grid. */
  total: number;
  /** The (weekday, hour) bucket with the most solves, or null if total === 0. */
  peak: { weekday: number; hour: number; count: number } | null;
  /** Max solves in any single bucket. Used by the color-scale. */
  max: number;
};

export function summarize(grid: HeatmapGrid): HeatmapStats {
  let total = 0;
  let max = 0;
  let peak: HeatmapStats["peak"] = null;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const n = grid[d][h];
      total += n;
      if (n > max) {
        max = n;
        peak = { weekday: d, hour: h, count: n };
      }
    }
  }
  return { total, peak, max };
}

/**
 * Map a raw solve count to an intensity in [0, 1].
 *
 * We use the square root of count/max so that moderate activity
 * is still clearly visible on the palette — linear scaling made
 * everything below the peak look almost identical when a single
 * bucket dominates. Zero maps to zero (not sqrt(0/0) = NaN).
 */
export function intensity(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  return Math.sqrt(count / max);
}

/** Short (Sun, Mon, ...) day names, Sunday-first. */
export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** Full day names for accessible labels ("You solve most on Thursday..."). */
export const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Format an hour integer (0-23) as a human label (12a, 1a, ... 12p, 1p).
 *
 * We pick this compact format over "06:00" because the heatmap's
 * column ticks get cramped below ~36px and two-letter tags read
 * fastest there.
 */
export function formatHour(h: number): string {
  if (h === 0) return "12a";
  if (h === 12) return "12p";
  if (h < 12) return `${h}a`;
  return `${h - 12}p`;
}
