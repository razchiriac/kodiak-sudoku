-- Initial Sudoku schema. Created by hand because we want the same file to
-- contain both the Drizzle-generated DDL AND the Supabase-specific bits
-- (RLS policies, auth.users trigger, streak trigger). Drizzle does not
-- generate RLS or triggers, so we own this file going forward.

-- =============================================================================
-- Extensions
-- =============================================================================

-- tsm_system_rows powers our O(1) random-puzzle picker via TABLESAMPLE
-- system_rows(N). Ships with postgresql-contrib (Homebrew installs it
-- automatically) and is enabled by default on Supabase Postgres.
create extension if not exists tsm_system_rows;

-- =============================================================================
-- Tables
-- =============================================================================

create table if not exists "profiles" (
  "id" uuid primary key references auth.users(id) on delete cascade,
  "username" text unique,
  "display_name" text,
  "avatar_url" text,
  "current_daily_streak" integer not null default 0,
  "longest_daily_streak" integer not null default 0,
  "last_daily_completed_on" date,
  "created_at" timestamptz not null default now()
);

create table if not exists "puzzles" (
  "id" bigserial primary key,
  "puzzle" char(81) not null unique,
  "solution" char(81) not null,
  "clue_count" smallint not null,
  "rating_raw" real not null,
  "difficulty_bucket" smallint not null,
  "created_at" timestamptz not null default now(),
  constraint "puzzles_difficulty_range" check (difficulty_bucket between 1 and 4),
  constraint "puzzles_clue_range" check (clue_count between 17 and 40)
);
create index if not exists "puzzles_difficulty_idx" on "puzzles" ("difficulty_bucket");

create table if not exists "saved_games" (
  "id" bigserial primary key,
  "user_id" uuid not null references auth.users(id) on delete cascade,
  "puzzle_id" bigint not null references "puzzles"("id"),
  "board" char(81) not null,
  "notes_b64" text not null default '',
  "elapsed_ms" integer not null default 0,
  "mistakes" integer not null default 0,
  "hints_used" integer not null default 0,
  "is_paused" boolean not null default false,
  "started_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);
create unique index if not exists "saved_games_user_puzzle_uniq"
  on "saved_games" ("user_id", "puzzle_id");
create index if not exists "saved_games_user_updated_idx"
  on "saved_games" ("user_id", "updated_at" desc);

create table if not exists "completed_games" (
  "id" bigserial primary key,
  "user_id" uuid not null references auth.users(id) on delete cascade,
  "puzzle_id" bigint not null references "puzzles"("id"),
  "difficulty_bucket" smallint not null,
  "time_ms" integer not null,
  "mistakes" integer not null default 0,
  "hints_used" integer not null default 0,
  "mode" text not null,
  "daily_date" date,
  "completed_at" timestamptz not null default now(),
  constraint "completed_games_mode_check" check (mode in ('random','daily')),
  constraint "completed_games_difficulty_range" check (difficulty_bucket between 1 and 4)
);
create index if not exists "completed_games_user_completed_idx"
  on "completed_games" ("user_id", "completed_at" desc);
create index if not exists "completed_games_puzzle_idx"
  on "completed_games" ("puzzle_id");
create index if not exists "completed_games_daily_time_idx"
  on "completed_games" ("daily_date", "time_ms")
  where mode = 'daily';
create unique index if not exists "completed_games_daily_user_uniq"
  on "completed_games" ("user_id", "daily_date")
  where mode = 'daily';

create table if not exists "daily_puzzles" (
  "puzzle_date" date primary key,
  "puzzle_id" bigint not null references "puzzles"("id"),
  "difficulty_bucket" smallint not null
);
create index if not exists "daily_puzzles_puzzle_idx" on "daily_puzzles" ("puzzle_id");

create table if not exists "puzzle_attempts" (
  "id" bigserial primary key,
  "user_id" uuid,
  "puzzle_id" bigint not null references "puzzles"("id"),
  "event" text not null,
  "payload" jsonb,
  "created_at" timestamptz not null default now()
);
create index if not exists "puzzle_attempts_puzzle_idx"
  on "puzzle_attempts" ("puzzle_id", "created_at");

-- =============================================================================
-- Auto-create a profiles row on first sign-in. Doing this in the database
-- (instead of app code) means we never have to deal with "profile missing"
-- cases or race conditions in server actions.
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =============================================================================
-- Update daily streak whenever a 'daily' completion is inserted. This runs
-- in the same transaction as the insert so the profile is always in sync
-- and we never have to recompute streaks lazily.
-- =============================================================================

create or replace function public.update_daily_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_date date;
begin
  if new.mode <> 'daily' or new.daily_date is null then
    return new;
  end if;

  select last_daily_completed_on into prev_date
    from public.profiles where id = new.user_id;

  -- New streak: consecutive day extends, gap resets, same-day no-op (the
  -- unique index on (user_id, daily_date) prevents two scored rows per
  -- day, so the same-day branch is mostly defensive).
  if prev_date is null or new.daily_date - prev_date > 1 then
    update public.profiles
      set current_daily_streak = 1,
          longest_daily_streak = greatest(longest_daily_streak, 1),
          last_daily_completed_on = new.daily_date
      where id = new.user_id;
  elsif new.daily_date - prev_date = 1 then
    update public.profiles
      set current_daily_streak = current_daily_streak + 1,
          longest_daily_streak = greatest(longest_daily_streak, current_daily_streak + 1),
          last_daily_completed_on = new.daily_date
      where id = new.user_id;
  end if;

  return new;
end;
$$;

drop trigger if exists on_completed_game_daily on public.completed_games;
create trigger on_completed_game_daily
  after insert on public.completed_games
  for each row execute function public.update_daily_streak();

-- =============================================================================
-- Row Level Security. RLS is the single most important security control in
-- this app: with it on, even the anon-key client can only see what we
-- intend it to see.
-- =============================================================================

alter table "profiles" enable row level security;
alter table "saved_games" enable row level security;
alter table "completed_games" enable row level security;
alter table "puzzles" enable row level security;
alter table "daily_puzzles" enable row level security;
alter table "puzzle_attempts" enable row level security;

-- Profiles: anyone can read (so we can show display names on leaderboards),
-- but only the owner can update their own profile.
drop policy if exists "profiles read" on "profiles";
create policy "profiles read" on "profiles" for select using (true);
drop policy if exists "profiles update self" on "profiles";
create policy "profiles update self" on "profiles" for update
  using (auth.uid() = id) with check (auth.uid() = id);

-- Saved games: only the owner can read or write.
drop policy if exists "saved_games owner all" on "saved_games";
create policy "saved_games owner all" on "saved_games" for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Completed games: owner can read all of theirs; anyone can read daily-mode
-- rows (so the leaderboard works for anonymous visitors). Inserts only by
-- the owner.
drop policy if exists "completed_games owner read" on "completed_games";
create policy "completed_games owner read" on "completed_games" for select
  using (auth.uid() = user_id);
drop policy if exists "completed_games daily public read" on "completed_games";
create policy "completed_games daily public read" on "completed_games" for select
  using (mode = 'daily');
drop policy if exists "completed_games owner insert" on "completed_games";
create policy "completed_games owner insert" on "completed_games" for insert
  with check (auth.uid() = user_id);

-- Puzzles and daily puzzles: world-readable. They contain no user data and
-- the app would not function without read access from the browser.
drop policy if exists "puzzles read" on "puzzles";
create policy "puzzles read" on "puzzles" for select using (true);
drop policy if exists "daily_puzzles read" on "daily_puzzles";
create policy "daily_puzzles read" on "daily_puzzles" for select using (true);

-- Puzzle attempts: write-only for clients (we collect events but never
-- show them back); empty policy means no one but the service role can
-- read. Inserts allowed for any authenticated user, with user_id required
-- to match the caller (or null for anonymous).
drop policy if exists "puzzle_attempts insert" on "puzzle_attempts";
create policy "puzzle_attempts insert" on "puzzle_attempts" for insert
  with check (user_id is null or auth.uid() = user_id);
