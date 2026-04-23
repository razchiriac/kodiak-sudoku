-- RAZ-29: Rate-limit the hint endpoint.
--
-- We keep a tiny append-only log of (bucket, key, timestamp) tuples that
-- the server counts within a sliding window to decide whether the next
-- call is allowed. The alternative — a Redis counter — would be faster,
-- but we don't run Redis and Postgres is cheap for the call rates we
-- expect (a hint is a deliberate user action, not a chatty API).
--
-- Why a generic table rather than hint-specific:
--   * We'll want to rate-limit other surfaces soon (sign-in attempts,
--     paste-puzzle imports, challenge-link generation). A single table
--     means one migration and one set of indexes.
--   * The `bucket` column names the surface; the `key` column names the
--     actor. `key` is typically either `u:<uuid>` for signed-in users or
--     `ip:<hash>` for anonymous callers, but the table doesn't care.
--
-- Retention: we expect to prune this table to the last 24 hours via a
-- separate cron job (scoped out here; ticket RAZ-29 specifies only the
-- enforcement side). In the interim the `created_at` index keeps scans
-- cheap even with hundreds of thousands of rows.

create table if not exists "rate_limit_events" (
  "id" bigserial primary key,
  -- e.g. 'hint', 'sign_in', 'paste_puzzle'. Short text, no enum —
  -- adding a new bucket should be zero-migration.
  "bucket" text not null,
  -- The actor being limited. Opaque string so the table can serve both
  -- user-id and IP-derived keys without a schema change.
  "key" text not null,
  "created_at" timestamptz not null default now()
);

-- Single composite index is enough: every rate-limit query is of the
-- form `where bucket = $1 and key = $2 and created_at > $3`. Including
-- `created_at` as the trailing column turns each check into a cheap
-- range scan.
create index if not exists "rate_limit_events_lookup_idx"
  on "rate_limit_events" ("bucket", "key", "created_at" desc);

-- Defense in depth: all writes/reads go through the Drizzle connection
-- (service role via the direct postgres URL), so RLS never fires for
-- legitimate traffic. Enabling RLS with NO policies means a leaked
-- anon/authenticated JWT can't read or write the table.
alter table "rate_limit_events" enable row level security;
