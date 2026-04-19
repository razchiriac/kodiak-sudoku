import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  boolean,
  char,
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Drizzle schema. We define the shape of every table the app owns. The
// `auth.users` table lives in Supabase's `auth` schema and is not declared
// here; we only reference its UUID via `userId` columns.

// Profiles. One row per signed-in user, populated on first sign-in via a
// Supabase trigger (see drizzle/migrations/0000_init.sql) so we never have
// to insert it from app code. `username` is required to appear on
// leaderboards but optional otherwise.
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // Daily streak fields are denormalized onto profiles so the dashboard can
  // render them without a join. They are kept in sync by a Postgres trigger
  // on inserts into completed_games (see migration 0000).
  currentDailyStreak: integer("current_daily_streak").notNull().default(0),
  longestDailyStreak: integer("longest_daily_streak").notNull().default(0),
  lastDailyCompletedOn: date("last_daily_completed_on"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Puzzles. Immutable seed data imported from the Kaggle dataset. The
// `puzzle` column has a unique constraint so re-runs of the import script
// dedupe naturally via ON CONFLICT.
export const puzzles = pgTable(
  "puzzles",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    puzzle: char("puzzle", { length: 81 }).notNull().unique(),
    solution: char("solution", { length: 81 }).notNull(),
    clueCount: smallint("clue_count").notNull(),
    ratingRaw: real("rating_raw").notNull(),
    // 1=Easy, 2=Medium, 3=Hard, 4=Expert. Stored as smallint (not enum) so
    // we can re-bucket post-launch with a single UPDATE.
    difficultyBucket: smallint("difficulty_bucket").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("puzzles_difficulty_idx").on(t.difficultyBucket),
    check("puzzles_difficulty_range", sql`${t.difficultyBucket} between 1 and 4`),
    check("puzzles_clue_range", sql`${t.clueCount} between 17 and 40`),
  ],
);

// Saved (in-progress) games. Exactly one per (user, puzzle) so resuming
// is unambiguous. RLS is added in the migration so users only see their
// own rows.
export const savedGames = pgTable(
  "saved_games",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    puzzleId: bigint("puzzle_id", { mode: "number" })
      .notNull()
      .references(() => puzzles.id),
    board: char("board", { length: 81 }).notNull(),
    // Notes are stored as the raw 81 Uint16 bitmasks serialized as a
    // base64 string. Smaller than JSON and trivially decodable on the
    // client. JSONB would also work but balloons in size.
    notesB64: text("notes_b64").notNull().default(""),
    elapsedMs: integer("elapsed_ms").notNull().default(0),
    mistakes: integer("mistakes").notNull().default(0),
    hintsUsed: integer("hints_used").notNull().default(0),
    isPaused: boolean("is_paused").notNull().default(false),
    // Timestamp the game first started, used to validate elapsed_ms isn't
    // larger than wall-clock time would allow when the user submits.
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("saved_games_user_puzzle_uniq").on(t.userId, t.puzzleId),
    index("saved_games_user_updated_idx").on(t.userId, t.updatedAt.desc()),
  ],
);

// Completed games. Append-only ledger of every successful completion.
// Daily-mode rows feed the leaderboard query (see lib/db/queries.ts).
export const completedGames = pgTable(
  "completed_games",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").notNull(),
    puzzleId: bigint("puzzle_id", { mode: "number" })
      .notNull()
      .references(() => puzzles.id),
    difficultyBucket: smallint("difficulty_bucket").notNull(),
    timeMs: integer("time_ms").notNull(),
    mistakes: integer("mistakes").notNull().default(0),
    hintsUsed: integer("hints_used").notNull().default(0),
    // 'random' for non-daily completions, 'daily' for the daily puzzle.
    // Map (not enum) so we can add new modes without a migration.
    mode: text("mode").notNull(),
    // For 'daily' rows, the date this completion counted for. NULL for
    // 'random'. The leaderboard query joins on this field.
    dailyDate: date("daily_date"),
    completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("completed_games_mode_check", sql`${t.mode} in ('random', 'daily')`),
    check("completed_games_difficulty_range", sql`${t.difficultyBucket} between 1 and 4`),
    index("completed_games_user_completed_idx").on(t.userId, t.completedAt.desc()),
    index("completed_games_puzzle_idx").on(t.puzzleId),
    // Partial index that powers the daily leaderboard top-N query.
    index("completed_games_daily_time_idx")
      .on(t.dailyDate, t.timeMs)
      .where(sql`${t.mode} = 'daily'`),
    // One scored daily completion per user per date. Enforced even though
    // app code also checks this; defense in depth.
    uniqueIndex("completed_games_daily_user_uniq")
      .on(t.userId, t.dailyDate)
      .where(sql`${t.mode} = 'daily'`),
  ],
);

// Daily puzzle assignments. Pre-seeded for the next 365 days by
// scripts/seed-daily.ts so the user-facing path is a simple SELECT.
export const dailyPuzzles = pgTable(
  "daily_puzzles",
  {
    puzzleDate: date("puzzle_date").primaryKey(),
    puzzleId: bigint("puzzle_id", { mode: "number" })
      .notNull()
      .references(() => puzzles.id),
    difficultyBucket: smallint("difficulty_bucket").notNull(),
  },
  (t) => [index("daily_puzzles_puzzle_idx").on(t.puzzleId)],
);

// Optional event log for re-bucketing difficulty post-launch. Empty in v1
// but the table exists so we can start collecting from day one without a
// later migration.
export const puzzleAttempts = pgTable(
  "puzzle_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id"),
    puzzleId: bigint("puzzle_id", { mode: "number" })
      .notNull()
      .references(() => puzzles.id),
    event: text("event").notNull(),
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("puzzle_attempts_puzzle_idx").on(t.puzzleId, t.createdAt)],
);

export type Puzzle = typeof puzzles.$inferSelect;
export type SavedGame = typeof savedGames.$inferSelect;
export type CompletedGame = typeof completedGames.$inferSelect;
export type DailyPuzzle = typeof dailyPuzzles.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
