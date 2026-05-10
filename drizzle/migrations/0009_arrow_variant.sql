-- RAZ-120: Arrow Sudoku variant support.
--
-- 1. Add 'arrow' to the puzzles_variant_check constraint so
--    arrow puzzles can be inserted.
-- 2. Add a nullable JSONB column `variant_data` for storing
--    variant-specific metadata (e.g. arrow definitions). Standard
--    and diagonal puzzles leave this NULL; arrow puzzles store
--    their arrow constraint definitions here.

-- Widen the variant check to include 'arrow'.
alter table "puzzles" drop constraint if exists "puzzles_variant_check";
alter table "puzzles" add constraint "puzzles_variant_check"
  check ("variant" in ('standard', 'diagonal', 'arrow'));

-- Variant-specific metadata. For arrow puzzles this holds:
--   { "arrows": [{ "circle": <int>, "cells": [<int>, ...] }, ...] }
-- NULL for standard and diagonal variants (they need no extra data).
alter table "puzzles" add column if not exists "variant_data" jsonb;
