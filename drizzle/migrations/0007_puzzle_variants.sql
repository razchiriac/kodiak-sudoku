-- RAZ-18: Puzzle variants.
--
-- Add a `variant` text column to the puzzles table. Default is
-- 'standard' for the classic 9x9 Sudoku. 'diagonal' adds the
-- two main diagonals as extra constraint units.
--
-- Text (not enum) per project convention so we can add new
-- variants later without a migration.

alter table "puzzles" add column if not exists "variant" text not null default 'standard';

-- Check constraint limits the value to known variants. We use
-- DROP IF EXISTS + re-create so the migration is idempotent.
alter table "puzzles" drop constraint if exists "puzzles_variant_check";
alter table "puzzles" add constraint "puzzles_variant_check"
  check ("variant" in ('standard', 'diagonal'));

-- Index for random play filtered by variant + difficulty.
create index if not exists "puzzles_variant_difficulty_idx"
  on "puzzles" ("variant", "difficulty_bucket");
