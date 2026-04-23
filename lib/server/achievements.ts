import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  achievements,
  completedGames,
  profiles,
} from "@/lib/db/schema";
import {
  ACHIEVEMENTS_BY_KEY,
  computeEarnedKeys,
  type AchievementDef,
  type AchievementFacts,
} from "./achievements-defs";

// RAZ-10 — Server-side achievement evaluator + reader.
//
// The flow on a completion:
//   submitCompletionAction inserts the completed_games row, then
//   calls `evaluateAndAwardAchievements(userId)`. The evaluator
//   derives facts in a single roundtrip (one aggregate SELECT over
//   completed_games + a profiles lookup), checks each predicate,
//   and inserts any newly-qualifying keys with ON CONFLICT DO
//   NOTHING so the call is idempotent and safe against races.
//
// It does NOT read the existing `achievements` rows before
// deciding — "ON CONFLICT DO NOTHING" already makes re-awarding a
// no-op at the DB level, and skipping the read keeps the hot path
// at one query for the facts, one for the inserts. The `earned_at`
// of the first insert is preserved because subsequent conflicts
// don't update.

/** Build the fact bundle the evaluator uses, from a single SQL trip. */
async function loadFacts(userId: string): Promise<AchievementFacts> {
  // We use a single aggregate over completed_games for all boolean
  // facts and the total count. Postgres handles `count(*)`,
  // `bool_or(...)`, and conditional aggregates in one pass — much
  // cheaper than issuing separate queries.
  const agg = await db.execute<{
    total: number;
    has_expert: boolean;
    has_daily: boolean;
    fastest_easy_ms: number | null;
  }>(
    sql`select
          count(*)::int as total,
          coalesce(bool_or(${completedGames.difficultyBucket} = 4), false) as has_expert,
          coalesce(bool_or(${completedGames.mode} = 'daily'), false) as has_daily,
          min(${completedGames.timeMs}) filter (where ${completedGames.difficultyBucket} = 1) as fastest_easy_ms
        from ${completedGames}
        where ${completedGames.userId} = ${userId}`,
  );
  const row = (agg as unknown as {
    rows: Array<{
      total: number;
      has_expert: boolean;
      has_daily: boolean;
      fastest_easy_ms: number | null;
    }>;
  }).rows[0];

  // Streak facts live on `profiles` (kept in sync by the daily
  // trigger), so one extra cheap PK lookup. Doing it this way
  // avoids duplicating the streak logic in the evaluator.
  const prof = await db
    .select({
      current: profiles.currentDailyStreak,
      longest: profiles.longestDailyStreak,
    })
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);

  return {
    totalSolves: row?.total ?? 0,
    hasExpertSolve: row?.has_expert ?? false,
    hasDailySolve: row?.has_daily ?? false,
    fastestEasyMs: row?.fastest_easy_ms ?? null,
    currentDailyStreak: prof[0]?.current ?? 0,
    longestDailyStreak: prof[0]?.longest ?? 0,
  };
}

/**
 * Evaluate all achievement predicates for a user and insert any
 * earned ones. Idempotent: safe to call on every completion.
 *
 * Returns the keys that were newly awarded (i.e. inserted on this
 * call, not already present). The submit action can use this to
 * surface a "New achievement!" toast to the user.
 *
 * Errors are swallowed by the CALLER — a failure here should never
 * mask the successful completion insert. We throw from inside
 * anyway so tests can observe failures.
 */
export async function evaluateAndAwardAchievements(
  userId: string,
): Promise<AchievementDef[]> {
  const facts = await loadFacts(userId);
  const qualifying = computeEarnedKeys(facts);
  if (qualifying.length === 0) return [];

  // INSERT with ON CONFLICT DO NOTHING so re-runs are free. The
  // `returning` clause only yields rows that were actually
  // inserted, which is precisely "newly earned" — perfect for the
  // toast path.
  const rows = qualifying.map((key) => ({ userId, key }));
  const inserted = await db
    .insert(achievements)
    .values(rows)
    .onConflictDoNothing()
    .returning({ key: achievements.key });

  return inserted
    .map((r) => ACHIEVEMENTS_BY_KEY[r.key])
    .filter((d): d is AchievementDef => !!d);
}

/**
 * Read achievement rows for a user, ordered by earned_at asc.
 * Used by the profile page to render the badge row. Missing
 * definitions (e.g. a key that was later removed from code) are
 * filtered out defensively.
 */
export async function listEarnedAchievements(userId: string) {
  const rows = await db
    .select({ key: achievements.key, earnedAt: achievements.earnedAt })
    .from(achievements)
    .where(eq(achievements.userId, userId))
    .orderBy(achievements.earnedAt);

  return rows
    .map((r) => {
      const def = ACHIEVEMENTS_BY_KEY[r.key];
      if (!def) return null;
      return { ...def, earnedAt: r.earnedAt };
    })
    .filter((x): x is AchievementDef & { earnedAt: Date } => x !== null);
}

/**
 * Backfill helper — evaluates and awards achievements for an
 * existing user based on their current historical data. Useful
 * for the rollout script so existing players see their earned
 * badges on first profile-page load. Intentionally identical
 * to the post-completion path; separating them would diverge.
 */
export const backfillAchievementsForUser = evaluateAndAwardAchievements;

// Re-export the catalog shape so callers don't have to import from
// two places when they only want the definitions.
export { ACHIEVEMENT_DEFS, ACHIEVEMENTS_BY_KEY, type AchievementDef } from "./achievements-defs";
