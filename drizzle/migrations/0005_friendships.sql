-- RAZ-12: Friends / private leaderboards.
--
-- `friendships` holds a single row per unordered pair of users.
-- We enforce `user_a < user_b` via a check constraint so the
-- table stores each relationship exactly once, regardless of
-- who initiated. `requested_by` records the initiator so the
-- other side can accept / decline.
--
-- Status values:
--   pending  — request sent, awaiting response from the other party.
--   accepted — mutual friendship; both sides see each other on the
--              "Friends" leaderboard tab.
--   blocked  — reserved for future UI; treated as "not friends" by
--              queries and blocks new requests. No block UI ships
--              in this migration, but the column accepts it so we
--              don't have to migrate later.
--
-- We deliberately do NOT add a separate `requests` table (one
-- table handles the whole lifecycle: send → pending row;
-- accept → status=accepted; decline → delete; remove friend →
-- delete). Single-table designs like this are easier to reason
-- about; the trade-off is that historical requests disappear on
-- decline, which is fine for this product.

create table if not exists "friendships" (
  "user_a" uuid not null references "profiles"("id") on delete cascade,
  "user_b" uuid not null references "profiles"("id") on delete cascade,
  -- status is a free-text column bounded by a check constraint
  -- so we can extend it without a migration (our project rule
  -- says "maps, not enums").
  "status" text not null check ("status" in ('pending','accepted','blocked')),
  "requested_by" uuid not null references "profiles"("id") on delete cascade,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  primary key ("user_a", "user_b"),
  -- Canonicalise pair ordering so there's only ever one row per
  -- unordered pair. Queries that need "my friends" union both
  -- columns against the caller's id.
  check ("user_a" < "user_b"),
  -- The initiator must be one of the two parties. Anything else
  -- is a malformed row — a defense-in-depth guard.
  check ("requested_by" in ("user_a", "user_b"))
);

-- Lookups are almost always "rows where I am user_a OR user_b",
-- so two single-column indexes cover the access patterns.
-- Postgres can BitmapOr them when the caller needs both.
create index if not exists "friendships_user_a_idx" on "friendships" ("user_a");
create index if not exists "friendships_user_b_idx" on "friendships" ("user_b");

alter table "friendships" enable row level security;

-- Users can read rows they're a party to. Everything else (no
-- INSERT / UPDATE from client) goes through server actions that
-- use the service role, so no write policies are necessary.
create policy "friendships_read_own" on "friendships"
  for select using (auth.uid() = "user_a" or auth.uid() = "user_b");
