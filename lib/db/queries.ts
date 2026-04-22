import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./client";
import {
  completedGames,
  dailyPuzzles,
  profiles,
  puzzles,
  savedGames,
  type Puzzle,
} from "./schema";

// Centralized DB queries. Server-only. Components and server actions call
// into this module instead of touching Drizzle directly so we have a
// single audit point for what we read/write.

// Pick a random puzzle in a difficulty bucket. We do this with TABLESAMPLE
// SYSTEM_ROWS, which is constant-time and avoids the OFFSET trap. If the
// sample misses (rare with our 30k+ rows per bucket), fall back to a
// random ordered scan so the UX never breaks.
export async function getRandomPuzzleByBucket(bucket: number): Promise<Puzzle | null> {
  const sample = await db.execute<Puzzle>(
    sql`select * from ${puzzles}
        tablesample system_rows(20)
        where ${puzzles.difficultyBucket} = ${bucket}
        limit 1`,
  );
  const first = (sample as unknown as { rows: Puzzle[] }).rows?.[0];
  if (first) return first;

  const fallback = await db
    .select()
    .from(puzzles)
    .where(eq(puzzles.difficultyBucket, bucket))
    .orderBy(sql`random()`)
    .limit(1);
  return fallback[0] ?? null;
}

export async function getPuzzleById(id: number): Promise<Puzzle | null> {
  const rows = await db.select().from(puzzles).where(eq(puzzles.id, id)).limit(1);
  return rows[0] ?? null;
}

// Today's daily puzzle, in UTC. We deliberately do not auto-create one
// here: scripts/seed-daily.ts is the only writer, so a missing daily is a
// loud failure (better than silently picking a random puzzle).
export async function getDailyPuzzle(date: string): Promise<{ puzzle: Puzzle; date: string } | null> {
  const rows = await db
    .select({
      puzzle: puzzles,
      date: dailyPuzzles.puzzleDate,
    })
    .from(dailyPuzzles)
    .innerJoin(puzzles, eq(puzzles.id, dailyPuzzles.puzzleId))
    .where(eq(dailyPuzzles.puzzleDate, date))
    .limit(1);
  return rows[0] ?? null;
}

// RAZ-5 / daily-archive: find the previous and next dates present in
// daily_puzzles relative to `date`. We only consider rows that are NOT
// in the future (so today's page never advertises a "next" link that
// leaks tomorrow's puzzle). The single SQL round-trip uses two
// conditional aggregates so the index on puzzle_date is enough and we
// avoid two separate queries from the caller.
export async function getAdjacentDailyDates(
  date: string,
): Promise<{ prev: string | null; next: string | null }> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await db.execute<{ prev: string | null; next: string | null }>(
    sql`select
          max(puzzle_date)::text filter (where puzzle_date < ${date}) as prev,
          min(puzzle_date)::text filter (where puzzle_date > ${date} and puzzle_date <= ${today}) as next
        from ${dailyPuzzles}`,
  );
  const row = (rows as unknown as { rows: { prev: string | null; next: string | null }[] })
    .rows?.[0];
  return { prev: row?.prev ?? null, next: row?.next ?? null };
}

// User's saved game for a specific puzzle (if any). Used by the resume
// flow on the dashboard and the play page.
export async function getSavedGame(userId: string, puzzleId: number) {
  const rows = await db
    .select()
    .from(savedGames)
    .where(and(eq(savedGames.userId, userId), eq(savedGames.puzzleId, puzzleId)))
    .limit(1);
  return rows[0] ?? null;
}

// Most-recently-updated saved games. Powers the "Continue" card on the
// dashboard.
export async function listRecentSavedGames(userId: string, limit = 5) {
  return db
    .select({
      saved: savedGames,
      puzzle: puzzles,
    })
    .from(savedGames)
    .innerJoin(puzzles, eq(puzzles.id, savedGames.puzzleId))
    .where(eq(savedGames.userId, userId))
    .orderBy(desc(savedGames.updatedAt))
    .limit(limit);
}

// User's completion history. Used on the profile page; cap at 50 to keep
// the page snappy.
export async function listRecentCompletions(userId: string, limit = 20) {
  return db
    .select({
      completed: completedGames,
      puzzle: puzzles,
    })
    .from(completedGames)
    .innerJoin(puzzles, eq(puzzles.id, completedGames.puzzleId))
    .where(eq(completedGames.userId, userId))
    .orderBy(desc(completedGames.completedAt))
    .limit(limit);
}

// Single-difficulty best time for a user. Used by the personal-best
// ribbon on the completion modal (RAZ-22) so we can compare the current
// finish against history. Returns null if the user has no completions
// in this bucket yet. Cheap query; covered by (user_id, difficulty_bucket).
export async function getBestTimeForDifficulty(
  userId: string,
  bucket: number,
): Promise<number | null> {
  const rows = await db
    .select({
      bestTimeMs: sql<number | null>`min(${completedGames.timeMs})`,
    })
    .from(completedGames)
    .where(
      and(
        eq(completedGames.userId, userId),
        eq(completedGames.difficultyBucket, bucket),
      ),
    )
    .limit(1);
  return rows[0]?.bestTimeMs ?? null;
}

// Per-difficulty stats for a user. Computed on the fly because the row
// counts per user are small; we'll add a denormalized table later if the
// query becomes a bottleneck.
export async function getUserStats(userId: string) {
  const rows = await db
    .select({
      difficulty: completedGames.difficultyBucket,
      count: sql<number>`count(*)::int`,
      bestTimeMs: sql<number | null>`min(${completedGames.timeMs})`,
      avgTimeMs: sql<number | null>`avg(${completedGames.timeMs})::int`,
    })
    .from(completedGames)
    .where(eq(completedGames.userId, userId))
    .groupBy(completedGames.difficultyBucket);
  return rows;
}

// Top N rows on the daily leaderboard for a given date. Optional `pure`
// flag excludes any completion that used a hint.
export async function getDailyLeaderboard(date: string, opts: { pure?: boolean; limit?: number } = {}) {
  const limit = opts.limit ?? 50;

  const rows = await db
    .select({
      userId: completedGames.userId,
      timeMs: completedGames.timeMs,
      mistakes: completedGames.mistakes,
      hintsUsed: completedGames.hintsUsed,
      completedAt: completedGames.completedAt,
      username: profiles.username,
      displayName: profiles.displayName,
    })
    .from(completedGames)
    .leftJoin(profiles, eq(profiles.id, completedGames.userId))
    .where(
      opts.pure
        ? and(
            eq(completedGames.mode, "daily"),
            eq(completedGames.dailyDate, date),
            eq(completedGames.hintsUsed, 0),
          )
        : and(eq(completedGames.mode, "daily"), eq(completedGames.dailyDate, date)),
    )
    .orderBy(completedGames.timeMs, completedGames.completedAt)
    .limit(limit);

  return rows;
}

// RAZ-34: weekly Quick-play leaderboard. Counts completions of Easy
// (difficulty_bucket = 1) random puzzles, grouped by user, for the
// current ISO week boundaries. ISO weeks start on Monday and contain
// whichever Thursday falls within them, so we use Postgres's
// `date_trunc('week', ...)` which follows the same convention. Ties
// broken by most-recent completion so a player who solved first today
// still ranks above a player with the same count from yesterday.
//
// We deliberately aggregate from the existing `completed_games`
// ledger rather than introducing a new table — quick-play is a
// different social angle on the same underlying events. If we ever
// need to distinguish quick-play completions from regular Easy solves
// (e.g. to count only those that started from /play/quick), we can
// add a tag column later without breaking this query's shape.
export async function getQuickLeaderboardWeekly(
  opts: { limit?: number } = {},
) {
  const limit = opts.limit ?? 50;
  // `mode = 'random'` + `difficulty_bucket = 1` scope us to Easy
  // random completions. We tie-break on `max(completed_at) desc` so
  // someone with the same count but a more recent solve ranks higher.
  const rows = await db
    .select({
      userId: completedGames.userId,
      count: sql<number>`count(*)::int`,
      lastCompletedAt: sql<Date>`max(${completedGames.completedAt})`,
      bestTimeMs: sql<number>`min(${completedGames.timeMs})`,
      username: profiles.username,
      displayName: profiles.displayName,
    })
    .from(completedGames)
    .leftJoin(profiles, eq(profiles.id, completedGames.userId))
    .where(
      and(
        eq(completedGames.mode, "random"),
        eq(completedGames.difficultyBucket, 1),
        sql`${completedGames.completedAt} >= date_trunc('week', now())`,
      ),
    )
    .groupBy(
      completedGames.userId,
      profiles.username,
      profiles.displayName,
    )
    .orderBy(
      sql`count(*) desc`,
      sql`max(${completedGames.completedAt}) desc`,
    )
    .limit(limit);
  return rows;
}

// Resolve a profile by username. Used by /profile/[username].
export async function getProfileByUsername(username: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.username, username)).limit(1);
  return rows[0] ?? null;
}

export async function getProfileById(id: string) {
  const rows = await db.select().from(profiles).where(eq(profiles.id, id)).limit(1);
  return rows[0] ?? null;
}
