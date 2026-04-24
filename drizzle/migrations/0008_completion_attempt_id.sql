-- RAZ-81: Idempotent completion submits.
--
-- Background. submitCompletionAction is the server boundary that records
-- a successful Sudoku solve. The client (`runSubmit` in play-client.tsx)
-- can call it more than once for the same play session in a few cases:
--   1. The first POST stalls on a flaky network and never reaches the
--      server. The browser eventually retries the RSC POST. Both can
--      land on Vercel within seconds.
--   2. The user navigates back into the same puzzle URL after solving;
--      the server-loaded saved_games row still has the solved board, so
--      the completion `useEffect` triggers again (the previous submit
--      didn't clean up saved_games because the player thought it failed).
--   3. RAZ-81's new client-side auto-retry (one extra attempt on
--      transient TypeError/AbortError before surfacing the modal error)
--      explicitly fires twice on a flaky network — and we DON'T want
--      that to insert two completed_games rows.
--
-- For 'daily' mode the existing partial unique index
-- `completed_games_daily_user_bucket_uniq` already enforces dedupe
-- per (user, date, difficulty). For 'random' mode there is no
-- such constraint — and we don't want one keyed on (user, puzzle)
-- because legitimate replays of the same random puzzle on different
-- days SHOULD count separately. So we add a per-attempt idempotency
-- key generated client-side, scoped to a single play session.
--
-- Shape:
--   - `attempt_id` is a UUID (text — we don't need uuid generation in
--     SQL because the client always provides one). Nullable so existing
--     rows from before this migration still validate. Going forward
--     the server action requires it via Zod.
--   - The unique index uses `WHERE attempt_id IS NOT NULL` so historic
--     NULL rows don't fight a single-NULL slot.
--
-- The application path on conflict: the action catches the unique
-- violation (sqlState 23505 + constraint name) and treats it as a
-- successful no-op submit, returning the same shape it would on a
-- fresh insert. This makes the entire submit endpoint safe to retry.

alter table "completed_games"
  add column if not exists "attempt_id" text;

create unique index if not exists "completed_games_attempt_id_uniq"
  on "completed_games" ("attempt_id")
  where "attempt_id" is not null;
