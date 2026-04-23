-- RAZ-8: Streak freeze / grace day.
--
-- Adds a small bank of "freezes" to each profile that the streak trigger
-- spends to forgive missed days. The intent is to soften the cliff that
-- causes the #1 quit trigger ("I had a 40-day run and missed one day")
-- without cheapening the mechanic for the players who never miss.
--
-- Mechanics:
--   * Earn +1 freeze every time the streak crosses a multiple of 7
--     (so day 7, 14, 21, …). Capped at 3 banked.
--   * On the next daily completion after a gap, the trigger consumes
--     one freeze per missed day. If enough freezes are available,
--     the streak survives (incremented by 1 for today). Otherwise the
--     streak resets to 1 and no freezes are consumed (better UX than
--     "we burned your freezes AND reset you").
--   * Same-day completions are still blocked by the unique index.
--
-- Backfill: existing profiles get 0 freezes. Players begin earning
-- freezes again from their next 7-day milestone.

-- =============================================================================
-- Schema change: bank of freezes per profile.
-- =============================================================================

alter table "profiles"
  add column if not exists "streak_freezes_available" smallint not null default 0;

-- Hard cap enforced at the column level too. The trigger applies the same
-- cap, but the constraint is defense-in-depth against any hand-edits.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_freezes_range'
  ) then
    alter table "profiles"
      add constraint "profiles_freezes_range"
      check (streak_freezes_available between 0 and 3);
  end if;
end$$;

-- =============================================================================
-- Replace the streak trigger function with a freeze-aware version.
--
-- We replace, not patch, because plpgsql doesn't support partial edits and
-- we want the whole policy in one readable block. The trigger binding does
-- not need to change since the function name is the same.
-- =============================================================================

create or replace function public.update_daily_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_date date;
  cur_streak int;
  freezes int;
  missed int;
  new_streak int;
  freeze_award int;
begin
  -- Random-mode completions don't touch streaks.
  if new.mode <> 'daily' or new.daily_date is null then
    return new;
  end if;

  -- Read the current state in one round-trip so we can decide both the new
  -- streak value and the freeze adjustment without re-reading the row.
  select last_daily_completed_on,
         current_daily_streak,
         streak_freezes_available
    into prev_date, cur_streak, freezes
    from public.profiles
    where id = new.user_id;

  -- First-ever daily completion: nothing to extend, start at 1. Cannot
  -- earn a freeze yet (need to reach a multiple of 7 first).
  if prev_date is null then
    update public.profiles
      set current_daily_streak = 1,
          longest_daily_streak = greatest(longest_daily_streak, 1),
          last_daily_completed_on = new.daily_date
      where id = new.user_id;
    return new;
  end if;

  -- Same-day re-submit (defensive — the unique index normally blocks
  -- this). Treat as no-op so we don't accidentally decrement freezes.
  if new.daily_date = prev_date then
    return new;
  end if;

  if new.daily_date - prev_date = 1 then
    -- Consecutive day: streak +1, normal happy path.
    new_streak := cur_streak + 1;
    -- Award a freeze when we cross a 7-day milestone, capped at 3.
    freeze_award := case when new_streak % 7 = 0 then 1 else 0 end;
    update public.profiles
      set current_daily_streak = new_streak,
          longest_daily_streak = greatest(longest_daily_streak, new_streak),
          last_daily_completed_on = new.daily_date,
          streak_freezes_available = least(3, freezes + freeze_award)
      where id = new.user_id;
    return new;
  end if;

  -- Gap detected. Number of fully-missed days between prev_date and today.
  missed := (new.daily_date - prev_date) - 1;

  if missed > 0 and missed <= freezes then
    -- Freezes cover the gap. Streak still increments by 1 (just today;
    -- missed days don't retroactively count toward the streak number).
    new_streak := cur_streak + 1;
    freeze_award := case when new_streak % 7 = 0 then 1 else 0 end;
    update public.profiles
      set current_daily_streak = new_streak,
          longest_daily_streak = greatest(longest_daily_streak, new_streak),
          last_daily_completed_on = new.daily_date,
          -- Spend one freeze per missed day, then potentially earn back
          -- one if this completion crosses a milestone. Cap at 3.
          streak_freezes_available = least(3, freezes - missed + freeze_award)
      where id = new.user_id;
    return new;
  end if;

  -- Gap too large for our freeze bank: reset to 1. Don't burn the freezes
  -- the player has — keeping them feels less punishing and they'll need
  -- them when the new streak is short.
  update public.profiles
    set current_daily_streak = 1,
        longest_daily_streak = greatest(longest_daily_streak, 1),
        last_daily_completed_on = new.daily_date
    where id = new.user_id;
  return new;
end;
$$;

-- Trigger binding is unchanged from migration 0000 (same function name),
-- but re-declare for clarity if this file is replayed against a DB where
-- the trigger somehow got dropped.
drop trigger if exists on_completed_game_daily on public.completed_games;
create trigger on_completed_game_daily
  after insert on public.completed_games
  for each row execute function public.update_daily_streak();
