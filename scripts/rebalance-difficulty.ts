/* eslint-disable no-console */
import { Client } from "pg";
import { CLUE_TARGETS, augmentToClueCount, countClues } from "../lib/sudoku/augment";

// RAZ-38 — One-off backfill that brings existing puzzles into the
// target clue-count ranges per difficulty bucket.
//
// Background: the Kaggle `sudoku-3m` dataset we imported sits near
// the minimum clue count (~24 clues) regardless of Kaggle rating.
// That means every bucket felt like Expert to players — Easy and
// Medium were indistinguishable from Hard / Expert in practice.
//
// This script reveals additional cells from each puzzle's known
// solution to raise the clue count, per the bands defined in
// `lib/sudoku/augment.ts`:
//
//   bucket 1 (Easy)   -> 40 clues
//   bucket 2 (Medium) -> 33 clues
//   bucket 3 (Hard)   -> 29 clues
//   bucket 4 (Expert) -> unchanged
//
// Safety:
//   - Revealing extra clues from the known solution strictly
//     preserves uniqueness (clues only constrain), so every
//     rebalanced puzzle remains a valid unique-solution puzzle.
//   - Idempotent: puzzles already at/above their target clue count
//     are skipped, so re-running the script doesn't drift.
//   - In-progress saved_games keep their player-entered `board`
//     state; if a player had correctly filled one of the newly
//     revealed cells, that cell now shows as a clue (visually
//     unchanged). Wrong fills get overwritten by the correct
//     clue, which is a friendly side effect.
//   - completed_games carry a denormalized `difficulty_bucket`
//     column so historical completions keep their original label.
//
// Usage:
//
//   npm run db:rebalance-difficulty
//
//   # Dry run — report what would change, don't touch the DB:
//   npm run db:rebalance-difficulty -- --dry-run
//
//   # Limit for smoke-testing locally:
//   npm run db:rebalance-difficulty -- --limit 1000

type Args = { dryRun: boolean; limit: number | null };

function parseArgs(): Args {
  const args: Args = { dryRun: false, limit: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit") args.limit = Number(process.argv[++i]);
  }
  return args;
}

async function main() {
  const { dryRun, limit } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pg = new Client({ connectionString: url });
  await pg.connect();

  try {
    // Report current state first — a reference point for "did it
    // actually change anything".
    const before = await pg.query<{
      difficulty_bucket: number;
      n: string;
      avg_clues: string;
    }>(
      `select difficulty_bucket,
              count(*)::text as n,
              round(avg(clue_count)::numeric, 2)::text as avg_clues
         from puzzles group by 1 order by 1`,
    );
    console.log("\nBefore:");
    for (const r of before.rows) {
      console.log(
        `  bucket ${r.difficulty_bucket}: ${r.n} puzzles, avg clues ${r.avg_clues}`,
      );
    }

    // Process one bucket at a time, streaming in batches so we
    // don't hold 90k rows in memory. Each batch is its own
    // transaction, keeping locks short.
    for (const bucket of [1, 2, 3] as const) {
      const { target } = CLUE_TARGETS[bucket];
      console.log(
        `\nRebalancing bucket ${bucket} -> target ${target} clues${
          dryRun ? " (dry-run)" : ""
        }...`,
      );

      const pageSize = 2_000;
      let processed = 0;
      let updated = 0;
      let skipped = 0;
      let lastId = 0;

      while (true) {
        if (limit && processed >= limit) break;

        const pageLimit = limit
          ? Math.min(pageSize, limit - processed)
          : pageSize;

        // Keyset pagination on (id) keeps page boundaries stable
        // even as earlier rows get updated. We only select rows
        // whose clue_count is below the target — that makes the
        // script naturally idempotent and a re-run short-circuits
        // on already-balanced rows.
        const page = await pg.query<{
          id: number;
          puzzle: string;
          solution: string;
          clue_count: number;
        }>(
          `select id, puzzle, solution, clue_count
             from puzzles
            where difficulty_bucket = $1
              and id > $2
              and clue_count < $3
            order by id
            limit $4`,
          [bucket, lastId, target, pageLimit],
        );

        if (page.rows.length === 0) break;

        if (!dryRun) await pg.query("begin");

        for (const row of page.rows) {
          processed++;
          lastId = row.id;

          const newPuzzle = augmentToClueCount(row.puzzle, row.solution, target);
          const newCount = countClues(newPuzzle);

          if (newPuzzle === row.puzzle) {
            skipped++;
            continue;
          }

          if (!dryRun) {
            await pg.query(
              `update puzzles set puzzle = $1, clue_count = $2 where id = $3`,
              [newPuzzle, newCount, row.id],
            );
          }
          updated++;
        }

        if (!dryRun) await pg.query("commit");

        // Periodic heartbeat so a long run shows progress.
        if (processed % 10_000 < pageSize) {
          console.log(
            `  ...bucket ${bucket}: processed ${processed}, updated ${updated}`,
          );
        }
      }

      console.log(
        `  bucket ${bucket}: processed ${processed}, updated ${updated}, skipped ${skipped}`,
      );
    }

    const after = await pg.query<{
      difficulty_bucket: number;
      n: string;
      avg_clues: string;
      min_clues: number;
      max_clues: number;
    }>(
      `select difficulty_bucket,
              count(*)::text as n,
              round(avg(clue_count)::numeric, 2)::text as avg_clues,
              min(clue_count) as min_clues,
              max(clue_count) as max_clues
         from puzzles group by 1 order by 1`,
    );
    console.log("\nAfter:");
    for (const r of after.rows) {
      console.log(
        `  bucket ${r.difficulty_bucket}: ${r.n} puzzles, clues avg ${r.avg_clues} (min ${r.min_clues}, max ${r.max_clues})`,
      );
    }
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
