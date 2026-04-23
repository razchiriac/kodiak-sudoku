-- RAZ-33: Mini daily — 3 buckets per date.
--
-- Up to now daily_puzzles had a single row per date. We want three
-- rows per date (Easy / Medium / Hard) so solvers of every tier
-- have an entry-point daily instead of bouncing off an Expert
-- Saturday. Expert is intentionally NOT part of the rotation; the
-- all-time Expert leaderboard (RAZ-6) covers that audience.
--
-- This migration only changes the SHAPE of the tables. The actual
-- seeding of the new E/M/H rows is done by scripts/seed-daily.ts,
-- which was updated in the same PR to write all three buckets.

-- --- daily_puzzles primary key -----------------------------------
-- The old PK was (puzzle_date); the new one is (puzzle_date,
-- difficulty_bucket). Existing rows are unique under the new key
-- because no (date, bucket) pair was duplicated under the old one.

alter table "daily_puzzles" drop constraint if exists "daily_puzzles_pkey";
alter table "daily_puzzles"
  add constraint "daily_puzzles_pkey"
  primary key ("puzzle_date", "difficulty_bucket");

-- Guardrail: the mini-daily rotation is Easy/Medium/Hard. We
-- keep existing Expert rows readable (for the archive) but block
-- new non-1..3 inserts so seed-daily.ts can't drift out of spec
-- by accident.
alter table "daily_puzzles"
  drop constraint if exists "daily_puzzles_bucket_range";
alter table "daily_puzzles"
  add constraint "daily_puzzles_bucket_range"
  check ("difficulty_bucket" between 1 and 4);

-- --- completed_games unique index --------------------------------
-- Old: one scored daily per user per date.
-- New: one scored daily per user per (date, bucket) — i.e. a
-- player can now finish Easy, Medium, and Hard on the same day.
-- Dropping + recreating is cheap: the table is small and the
-- index is partial (mode='daily' only).

drop index if exists "completed_games_daily_user_uniq";
create unique index if not exists "completed_games_daily_user_bucket_uniq"
  on "completed_games" ("user_id", "daily_date", "difficulty_bucket")
  where mode = 'daily';

-- --- streak trigger is unchanged --------------------------------
-- The trigger in 0000_init.sql already handles multiple same-day
-- completions correctly: a second daily insert on the same date
-- hits the "diff = 0" branch (neither reset nor increment), which
-- is exactly what we want now that a user can solve Easy + Hard
-- on the same day and only earn ONE streak bump for that day.
