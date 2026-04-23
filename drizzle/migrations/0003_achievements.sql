-- RAZ-10: Achievements table.
--
-- One row per (user, achievement_key). Earned-once, no demotions,
-- no revocations — the system only ever INSERTs with ON CONFLICT
-- DO NOTHING, so the `earned_at` timestamp on each row reflects the
-- first time the user hit the criterion.
--
-- Why a single generic table rather than per-achievement columns
-- on `profiles`:
--   * Adding a new badge is a one-line insert into the ACHIEVEMENTS
--     constant in lib/server/achievements.ts — no migration.
--   * We keep a denormalized `earned_at` so the profile page can
--     sort badges chronologically without a second lookup.
--
-- Why not a Postgres trigger on `completed_games`:
--   * Achievement criteria cross tables (e.g. the streak ones read
--     `profiles.current_daily_streak`). Keeping the evaluator in
--     Node means the logic sits next to the test suite and can
--     iterate without a migration.
--   * Server actions already wrap the completion write, so hooking
--     in a post-insert evaluator there is a natural fit.

create table if not exists "achievements" (
  "user_id" uuid not null references "profiles"("id") on delete cascade,
  -- Short stable keys like "first-solve", "solve-100". The set
  -- of keys is owned by application code (see ACHIEVEMENTS in
  -- lib/server/achievements.ts); the DB doesn't enforce a
  -- whitelist because we want to add new badges without a
  -- migration.
  "key" text not null,
  "earned_at" timestamptz not null default now(),
  primary key ("user_id", "key")
);

-- The profile page loads a user's earned badges in chronological
-- order; this index covers that query without hitting the PK.
create index if not exists "achievements_user_earned_idx"
  on "achievements" ("user_id", "earned_at" desc);

-- RLS: achievements are public (they sit on public profile pages
-- alongside streak / stats). Writes are not exposed to the anon
-- or authenticated roles — the evaluator runs server-side via
-- the service role over the direct Postgres URL.
alter table "achievements" enable row level security;

create policy "achievements_public_read" on "achievements"
  for select using (true);
