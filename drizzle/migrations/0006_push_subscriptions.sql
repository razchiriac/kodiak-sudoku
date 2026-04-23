-- RAZ-7: Web Push subscriptions for daily reminders.
--
-- Stores one PushSubscription per (user, endpoint). The endpoint
-- column is the unique identifier that the Push API returns when a
-- user subscribes; it includes the browser-specific delivery URL.
-- The full subscription JSON (endpoint + keys) lives in `sub_json`
-- so we can pass it straight to the web-push library at send time.
--
-- `notify_at` stores the user's preferred notification hour in
-- their local timezone string (e.g. "09:00"). The cron iterates
-- subscriptions whose `notify_at` matches the current hour in the
-- subscription's timezone. We store timezone as an IANA identifier
-- (e.g. "America/New_York") so the cron can compute local time.
--
-- Why not a separate "settings" table? Because the subscription is
-- the only push-specific state, and coupling it with the
-- notification preference means we never have an orphaned toggle
-- with no subscription to send to.

create table if not exists "push_subscriptions" (
  "id" bigserial primary key,
  "user_id" uuid not null references "profiles"("id") on delete cascade,
  -- The push endpoint URL from PushSubscription. Unique per browser
  -- instance; if the user re-subscribes from the same browser we
  -- upsert using this.
  "endpoint" text not null,
  -- Full PushSubscription JSON, passed verbatim to web-push.sendNotification().
  "sub_json" jsonb not null,
  -- Preferred local hour for the reminder, e.g. "09:00".
  "notify_at" text not null default '09:00',
  -- IANA timezone, e.g. "America/New_York". Needed to convert
  -- notify_at into UTC for the cron's WHERE clause.
  "timezone" text not null default 'UTC',
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  unique ("user_id", "endpoint")
);

create index if not exists "push_subs_user_idx"
  on "push_subscriptions" ("user_id");

-- The cron queries "whose local hour matches the current UTC hour".
-- This index covers that access pattern.
create index if not exists "push_subs_notify_tz_idx"
  on "push_subscriptions" ("notify_at", "timezone");

alter table "push_subscriptions" enable row level security;

-- Users can read their own subscriptions (for the toggle UI).
create policy "push_subs_read_own" on "push_subscriptions"
  for select using (auth.uid() = "user_id");
