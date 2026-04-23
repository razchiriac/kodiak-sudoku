/* eslint-disable no-console */
import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { parse } from "csv-parse";
import copy from "pg-copy-streams";
import { findConflicts, isFilled } from "../lib/sudoku/validate";
import { parseBoard } from "../lib/sudoku/board";
import {
  CLUE_TARGETS,
  augmentToClueCount,
  countClues,
} from "../lib/sudoku/augment";

// Import a curated subset of the Kaggle "3 Million Sudoku Puzzles with
// Ratings" dataset into the puzzles table. We deliberately do NOT import
// all 3M rows: the free Supabase tier caps DB size, and ~150k puzzles is
// already enough for years of unique daily play.
//
//   npm run puzzles:import -- --csv data/raw/sudoku-3m.csv --per-bucket 30000
//
// The script is idempotent: rows with an existing `puzzle` text are
// skipped via ON CONFLICT in the staging-to-real INSERT.

type Row = {
  puzzle: string;
  solution: string;
  clueCount: number;
  ratingRaw: number;
};

type CliArgs = {
  csv: string;
  perBucket: number;
  limit: number | null;
  cutoffs: [number, number, number] | null;
};

function parseArgs(): CliArgs {
  const args: CliArgs = {
    csv: "data/raw/sudoku-3m.csv",
    perBucket: 30_000,
    limit: null,
    cutoffs: null,
  };
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i];
    if (arg === "--csv") args.csv = process.argv[++i];
    else if (arg === "--per-bucket") args.perBucket = Number(process.argv[++i]);
    else if (arg === "--limit") args.limit = Number(process.argv[++i]);
    else if (arg === "--cutoffs") args.cutoffs = JSON.parse(process.argv[++i]);
  }
  return args;
}

// Validate one row from the dataset. Returns the parsed Row or a skip
// reason. Tolerant of multiple Kaggle CSV column-name variants.
function validateRow(rec: Record<string, string>): Row | { skip: string } {
  const puzzle = (rec.puzzle ?? rec.quizzes ?? "").trim();
  const solution = (rec.solution ?? rec.solutions ?? "").trim();
  const ratingStr = rec.difficulty ?? rec.rating ?? "0";
  const cluesStr = rec.clues;

  if (puzzle.length !== 81) return { skip: "puzzle length" };
  if (solution.length !== 81) return { skip: "solution length" };

  const normalizedPuzzle = puzzle.replace(/\./g, "0");
  const normalizedSolution = solution.replace(/\./g, "0");
  if (!/^[0-9]{81}$/.test(normalizedPuzzle)) return { skip: "puzzle chars" };
  if (!/^[1-9]{81}$/.test(normalizedSolution)) return { skip: "solution chars" };

  // Solution must be a complete valid grid AND agree with all clues.
  // Skipping bad rows here is safer than discovering a bad puzzle in
  // production where it would just frustrate the player.
  try {
    const sBoard = parseBoard(normalizedSolution);
    if (!isFilled(sBoard) || findConflicts(sBoard).size > 0) {
      return { skip: "solution invalid" };
    }
    for (let i = 0; i < 81; i++) {
      if (normalizedPuzzle[i] !== "0" && normalizedPuzzle[i] !== normalizedSolution[i]) {
        return { skip: "puzzle disagrees with solution" };
      }
    }
  } catch {
    return { skip: "parse error" };
  }

  let clueCount = cluesStr ? Number(cluesStr) : NaN;
  if (!Number.isFinite(clueCount)) {
    clueCount = 0;
    for (const ch of normalizedPuzzle) if (ch !== "0") clueCount++;
  }
  if (clueCount < 17 || clueCount > 40) return { skip: "clue count out of range" };

  const ratingRaw = Number(ratingStr);
  if (!Number.isFinite(ratingRaw)) return { skip: "rating not a number" };

  return { puzzle: normalizedPuzzle, solution: normalizedSolution, clueCount, ratingRaw };
}

function bucketFor(ratingRaw: number, cutoffs: [number, number, number]): number {
  if (ratingRaw <= cutoffs[0]) return 1;
  if (ratingRaw <= cutoffs[1]) return 2;
  if (ratingRaw <= cutoffs[2]) return 3;
  return 4;
}

// Reservoir sampling: keep at most `size` items uniformly at random from a
// stream of unknown length. Constant memory, single pass.
class Reservoir<T> {
  private items: T[] = [];
  private seen = 0;
  constructor(private readonly size: number) {}
  add(item: T) {
    this.seen++;
    if (this.items.length < this.size) {
      this.items.push(item);
    } else {
      const j = Math.floor(Math.random() * this.seen);
      if (j < this.size) this.items[j] = item;
    }
  }
  values(): T[] {
    return this.items;
  }
}

// Sample the rating column in a first pass to derive bucket cutoffs from
// quartiles. 100k samples is more than enough to estimate quantiles for a
// 3M row dataset.
async function computeCutoffs(csvPath: string, sampleSize = 100_000): Promise<[number, number, number]> {
  const reservoir = new Reservoir<number>(sampleSize);
  await pipeline(
    createReadStream(csvPath),
    parse({ columns: true, skip_empty_lines: true }),
    new Transform({
      objectMode: true,
      transform(rec: Record<string, string>, _enc, cb) {
        const v = Number(rec.difficulty ?? rec.rating ?? "0");
        if (Number.isFinite(v)) reservoir.add(v);
        cb();
      },
    }),
  );
  const sorted = reservoir.values().sort((a, b) => a - b);
  const q = (p: number) => sorted[Math.floor(sorted.length * p)] ?? 0;
  return [q(0.25), q(0.55), q(0.85)];
}

async function main() {
  const args = parseArgs();
  const csvPath = path.resolve(process.cwd(), args.csv);
  if (!existsSync(csvPath)) {
    throw new Error(`CSV not found at ${csvPath}. See scripts/README.md.`);
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Step 1: figure out the rating cutoffs (or use --cutoffs).
  const cutoffs = args.cutoffs ?? (await computeCutoffs(csvPath));
  console.log(`Difficulty cutoffs (Easy<=${cutoffs[0]}, Medium<=${cutoffs[1]}, Hard<=${cutoffs[2]}, Expert>):`);

  // Step 2: stream the file, validate, and reservoir-sample per bucket.
  const buckets: Reservoir<Row & { bucket: number }>[] = [
    new Reservoir(args.perBucket),
    new Reservoir(args.perBucket),
    new Reservoir(args.perBucket),
    new Reservoir(args.perBucket),
  ];
  let total = 0;
  let kept = 0;
  let skipped = 0;
  const skipReasons = new Map<string, number>();

  await pipeline(
    createReadStream(csvPath),
    parse({ columns: true, skip_empty_lines: true }),
    new Transform({
      objectMode: true,
      transform(rec: Record<string, string>, _enc, cb) {
        total++;
        const v = validateRow(rec);
        if ("skip" in v) {
          skipped++;
          skipReasons.set(v.skip, (skipReasons.get(v.skip) ?? 0) + 1);
        } else {
          const bucket = bucketFor(v.ratingRaw, cutoffs);
          buckets[bucket - 1].add({ ...v, bucket });
          kept++;
        }
        if (args.limit && total >= args.limit) {
          cb(new Error("__limit_reached__"));
        } else {
          cb();
        }
      },
    }),
  ).catch((e) => {
    if (e?.message !== "__limit_reached__") throw e;
  });

  console.log(`Read ${total} rows, validated ${kept}, skipped ${skipped}`);
  for (const [reason, n] of skipReasons) console.log(`  skipped (${reason}): ${n}`);
  for (let i = 0; i < 4; i++) console.log(`  bucket ${i + 1}: ${buckets[i].values().length} sampled`);

  // Step 3: bulk load via COPY into a staging table, then INSERT into the
  // real puzzles table with ON CONFLICT DO NOTHING for idempotency.
  const { Client } = await import("pg");
  const pg = new Client({ connectionString: url });
  await pg.connect();

  // Wrap staging table creation, COPY, and final INSERT in one
  // transaction. Without BEGIN, each statement auto-commits and the
  // `on commit drop` temporary table disappears before COPY can use it.
  await pg.query("begin");
  await pg.query(`
    create temporary table puzzles_stage (
      puzzle char(81),
      solution char(81),
      clue_count smallint,
      rating_raw real,
      difficulty_bucket smallint
    ) on commit drop
  `);

  const copyStream = pg.query(
    copy.from(
      `copy puzzles_stage (puzzle, solution, clue_count, rating_raw, difficulty_bucket) from stdin with (format text)`,
    ),
  );

  // Concat then shuffle so consecutive primary keys don't all share a
  // bucket. Random row picks (which we do by `id mod N`) stay uniform.
  const allRows = ([] as (Row & { bucket: number })[]).concat(...buckets.map((b) => b.values()));
  for (let i = allRows.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allRows[i], allRows[j]] = [allRows[j], allRows[i]];
  }

  // RAZ-38: Raise clue counts for Easy / Medium / Hard to the
  // per-bucket targets defined in `lib/sudoku/augment.ts`. Without
  // this, the Kaggle dataset's uniformly-low clue counts (~24
  // across all ratings) make every bucket feel like Expert. We
  // apply the augmentation here rather than post-insert so the
  // staging COPY already carries the final clue_count values, and
  // future imports stay consistent with the shipped seed data.
  for (const row of allRows) {
    const bucket = row.bucket as 1 | 2 | 3 | 4;
    if (bucket === 4) continue;
    const target = CLUE_TARGETS[bucket].target;
    const augmented = augmentToClueCount(row.puzzle, row.solution, target);
    row.puzzle = augmented;
    row.clueCount = countClues(augmented);
  }

  const writer = new Transform({
    objectMode: true,
    transform(row: Row & { bucket: number }, _enc, cb) {
      this.push(`${row.puzzle}\t${row.solution}\t${row.clueCount}\t${row.ratingRaw}\t${row.bucket}\n`);
      cb();
    },
  });
  await pipeline(
    async function* () {
      for (const r of allRows) yield r;
    },
    writer,
    copyStream,
  );

  const inserted = await pg.query(`
    insert into puzzles (puzzle, solution, clue_count, rating_raw, difficulty_bucket)
    select puzzle, solution, clue_count, rating_raw, difficulty_bucket
    from puzzles_stage
    on conflict (puzzle) do nothing
  `);
  await pg.query("commit");
  console.log(`Inserted ${inserted.rowCount} new puzzles.`);

  // Quick sanity check: count per bucket in the live table.
  const summary = await pg.query<{ difficulty_bucket: number; n: string }>(
    `select difficulty_bucket, count(*)::text as n from puzzles group by 1 order by 1`,
  );
  for (const r of summary.rows) console.log(`  table bucket ${r.difficulty_bucket}: ${r.n}`);

  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
