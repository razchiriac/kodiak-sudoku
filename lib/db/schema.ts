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
  primaryKey,
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
  // RAZ-8: Streak freeze bank. Earned at every 7-day streak milestone
  // (capped at 3), spent automatically by the streak trigger to forgive
  // missed days. Stored as smallint because the cap is 3; check
  // constraint in migration 0001 enforces 0..3.
  streakFreezesAvailable: smallint("streak_freezes_available")
    .notNull()
    .default(0),
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
    // RAZ-33: One scored daily completion per user per (date,
    // bucket). Three mini-daily tiers per day means a user can
    // score three rows for one date — but only one per tier.
    // Enforced at the DB for defense in depth.
    uniqueIndex("completed_games_daily_user_bucket_uniq")
      .on(t.userId, t.dailyDate, t.difficultyBucket)
      .where(sql`${t.mode} = 'daily'`),
  ],
);

// Daily puzzle assignments. Pre-seeded for the next 365 days by
// scripts/seed-daily.ts so the user-facing path is a simple SELECT.
export const dailyPuzzles = pgTable(
  "daily_puzzles",
  {
    puzzleDate: date("puzzle_date").notNull(),
    puzzleId: bigint("puzzle_id", { mode: "number" })
      .notNull()
      .references(() => puzzles.id),
    difficultyBucket: smallint("difficulty_bucket").notNull(),
  },
  (t) => [
    // RAZ-33: composite PK so one date can carry up to three
    // buckets (Easy/Medium/Hard). The physical migration is
    // drizzle/migrations/0004_mini_daily.sql.
    primaryKey({ columns: [t.puzzleDate, t.difficultyBucket] }),
    index("daily_puzzles_puzzle_idx").on(t.puzzleId),
  ],
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

// RAZ-29: sliding-window rate-limit log. One row per successful call
// to a rate-limited surface. See drizzle/migrations/0002 for the
// bucket/key convention. Kept as a generic log rather than a hint-
// specific table so the next rate-limited action reuses it.
export const rateLimitEvents = pgTable(
  "rate_limit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    bucket: text("bucket").notNull(),
    key: text("key").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("rate_limit_events_lookup_idx").on(t.bucket, t.key, t.createdAt),
  ],
);

// RAZ-10: Achievements. One row per (user, key); keys live in
// lib/server/achievements.ts so we can add new badges without a
// migration. The profile page reads this table directly.
export const achievements = pgTable(
  "achievements",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    index("achievements_user_earned_idx").on(t.userId, t.earnedAt.desc()),
  ],
);

// RAZ-12: Friendships. One row per unordered pair, status-driven
// lifecycle (pending → accepted, delete on decline/remove). See
// drizzle/migrations/0005_friendships.sql for the shape and
// invariants. We enforce user_a < user_b via a DB check; the
// helper `canonicalPair()` in lib/server/friends.ts mirrors that
// at the app layer.
export const friendships = pgTable(
  "friendships",
  {
    userA: uuid("user_a")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    userB: uuid("user_b")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userA, t.userB] }),
    index("friendships_user_a_idx").on(t.userA),
    index("friendships_user_b_idx").on(t.userB),
    check("friendships_status_check", sql`${t.status} in ('pending','accepted','blocked')`),
  ],
);

// RAZ-7: Web Push subscriptions for daily reminders. One row per
// (user, endpoint). Stores the full PushSubscription JSON so the
// cron can hand it straight to web-push.sendNotification().
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    subJson: jsonb("sub_json").notNull(),
    notifyAt: text("notify_at").notNull().default("09:00"),
    timezone: text("timezone").notNull().default("UTC"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("push_subs_user_endpoint_uniq").on(t.userId, t.endpoint),
    index("push_subs_user_idx").on(t.userId),
    index("push_subs_notify_tz_idx").on(t.notifyAt, t.timezone),
  ],
);

export type Puzzle = typeof puzzles.$inferSelect;
export type SavedGame = typeof savedGames.$inferSelect;
export type CompletedGame = typeof completedGames.$inferSelect;
export type DailyPuzzle = typeof dailyPuzzles.$inferSelect;
export type Profile = typeof profiles.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
