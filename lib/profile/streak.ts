// RAZ-103/104 — Pure streak computation helpers.
//
// `current_daily_streak` is denormalized on `profiles` and only ever
// updated by a Postgres trigger on inserts where `mode = 'daily'`. The
// vast majority of players never play the dedicated `/daily` puzzle —
// so for them the column is permanently zero, even though the
// `completed_games` history clearly shows them playing every day.
//
// To match the player-facing meaning of "streak" ("how many days in a
// row I've been playing"), we derive the value from any completion's
// date (UTC) and treat the trigger-maintained column as a hint we can
// fall back to.
//
// Keeping the math in a pure module makes it trivially testable and
// avoids coupling to either Drizzle or React.

// `dates` is a list of YYYY-MM-DD strings (any order, possibly with
// duplicates). `today` is YYYY-MM-DD in the same calendar (UTC, by
// convention with how we read from Postgres elsewhere in this app).
//
// Returns:
//   * `current` — length of the consecutive-day run ending on the
//     latest play day, but only if that latest day is "still alive"
//     (today or yesterday). If the player skipped two or more days,
//     the streak is broken and `current` is 0.
//   * `longest` — the longest consecutive-day run found anywhere
//     in the history. Useful for the "best N" sub-label.
export function computePlayingStreak(
  dates: readonly string[],
  today: string,
): { current: number; longest: number } {
  if (dates.length === 0) return { current: 0, longest: 0 };

  // Dedupe and sort ascending so we can walk runs in calendar order.
  const sorted = Array.from(new Set(dates)).sort();

  let longest = 1;
  let runLen = 1;
  for (let i = 1; i < sorted.length; i++) {
    const gap = daysBetween(sorted[i - 1]!, sorted[i]!);
    if (gap === 1) {
      runLen++;
      if (runLen > longest) longest = runLen;
    } else if (gap > 1) {
      runLen = 1;
    }
  }

  // "Current" run: walk back from the latest play day. If the latest
  // play is more than 1 day before `today`, the streak is broken.
  const latest = sorted[sorted.length - 1]!;
  const dayDiff = daysBetween(latest, today);
  if (dayDiff > 1) return { current: 0, longest };

  let current = 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    if (daysBetween(sorted[i]!, sorted[i + 1]!) === 1) current++;
    else break;
  }
  return { current, longest };
}

// Calendar-day delta between two YYYY-MM-DD strings, treating both as
// UTC midnights. Returns a non-negative integer when `b >= a`.
function daysBetween(a: string, b: string): number {
  const aMs = Date.UTC(
    Number(a.slice(0, 4)),
    Number(a.slice(5, 7)) - 1,
    Number(a.slice(8, 10)),
  );
  const bMs = Date.UTC(
    Number(b.slice(0, 4)),
    Number(b.slice(5, 7)) - 1,
    Number(b.slice(8, 10)),
  );
  return Math.round((bMs - aMs) / (24 * 60 * 60 * 1000));
}

// UTC YYYY-MM-DD for "today" as the rest of the app sees it. Centralised
// so tests can pass a fixed value instead of monkey-patching `Date`.
export function utcDateToday(): string {
  return new Date().toISOString().slice(0, 10);
}
