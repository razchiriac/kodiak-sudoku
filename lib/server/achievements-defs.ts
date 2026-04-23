// RAZ-10 — Achievement definitions, shared by the server-side
// evaluator and the profile-page renderer.
//
// Why a pure TS module (no "server-only" import):
//   The profile-page UI wants to show *locked* achievements too
//   ("X earned, Y to go") so the component needs the full catalog,
//   not just the list of earned keys. Keeping the catalog pure
//   means the client bundle can import it directly.
//
// Icons are identified by their Lucide component name. The
// renderer resolves the string to a component at display time
// to keep this file framework-free and treeshakable.

/**
 * Facts the evaluator derives from the database once per call.
 * Kept as a plain shape so unit tests can feed the evaluator
 * synthesized facts without touching Postgres.
 */
export type AchievementFacts = {
  totalSolves: number;
  hasExpertSolve: boolean;
  hasDailySolve: boolean;
  /** Fastest Easy completion in ms, or null if no Easy solves yet. */
  fastestEasyMs: number | null;
  currentDailyStreak: number;
  longestDailyStreak: number;
};

export type AchievementDef = {
  key: string;
  title: string;
  description: string;
  /** Lucide icon name — resolved at render time. */
  icon: string;
  /** Pure predicate. `true` → user qualifies for the badge. */
  check: (facts: AchievementFacts) => boolean;
};

// Five-minute milestone constant for the sub-5 Easy badge.
const FIVE_MINUTES_MS = 5 * 60 * 1000;

/**
 * Ordered list — profile page renders badges in this order when
 * grouping by "earned first", and locked badges fall below in the
 * same order. Keeping the list append-only preserves existing
 * DB rows (we never remove a key once it's shipped).
 */
export const ACHIEVEMENT_DEFS: readonly AchievementDef[] = [
  {
    key: "first-solve",
    title: "First solve",
    description: "Complete your first puzzle.",
    icon: "Sparkles",
    check: (f) => f.totalSolves >= 1,
  },
  {
    key: "solve-10",
    title: "Getting warmed up",
    description: "Complete 10 puzzles.",
    icon: "Flame",
    check: (f) => f.totalSolves >= 10,
  },
  {
    key: "solve-100",
    title: "Century",
    description: "Complete 100 puzzles.",
    icon: "Trophy",
    check: (f) => f.totalSolves >= 100,
  },
  {
    key: "solve-1000",
    title: "Grand master",
    description: "Complete 1,000 puzzles.",
    icon: "Crown",
    check: (f) => f.totalSolves >= 1000,
  },
  {
    key: "first-expert",
    title: "Expert",
    description: "Complete your first Expert puzzle.",
    icon: "Gem",
    check: (f) => f.hasExpertSolve,
  },
  {
    key: "first-daily",
    title: "Dailyist",
    description: "Complete your first daily puzzle.",
    icon: "Sun",
    check: (f) => f.hasDailySolve,
  },
  {
    key: "streak-7",
    title: "Week warrior",
    description: "Keep a 7-day daily streak.",
    icon: "CalendarCheck",
    // `longestDailyStreak` lets us grandfather in users who
    // already hit 7 before the feature shipped — we don't want
    // to look at `currentDailyStreak` only and deny the badge
    // to someone whose streak just broke at 9.
    check: (f) => f.longestDailyStreak >= 7,
  },
  {
    key: "streak-30",
    title: "Monthly streaker",
    description: "Keep a 30-day daily streak.",
    icon: "CalendarHeart",
    check: (f) => f.longestDailyStreak >= 30,
  },
  {
    key: "sub5-easy",
    title: "Sub-5 Easy",
    description: "Complete an Easy puzzle in under 5 minutes.",
    icon: "Zap",
    check: (f) =>
      f.fastestEasyMs !== null && f.fastestEasyMs < FIVE_MINUTES_MS,
  },
];

/**
 * Map from achievement key to its definition. Useful for looking
 * up metadata by key when rendering the earned list.
 */
export const ACHIEVEMENTS_BY_KEY: Readonly<Record<string, AchievementDef>> =
  Object.fromEntries(ACHIEVEMENT_DEFS.map((a) => [a.key, a]));

/**
 * Pure selector — returns the keys the user qualifies for given
 * the supplied facts. Order matches `ACHIEVEMENT_DEFS` so callers
 * can render earned badges in a predictable order.
 */
export function computeEarnedKeys(facts: AchievementFacts): string[] {
  return ACHIEVEMENT_DEFS.filter((a) => a.check(facts)).map((a) => a.key);
}
