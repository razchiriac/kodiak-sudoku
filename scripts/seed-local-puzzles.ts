/* eslint-disable no-console */
import { Client } from "pg";
import { BOARD_SIZE, peers, parseBoard } from "../lib/sudoku/board";
import { findConflicts, isFilled } from "../lib/sudoku/validate";

// Local-only puzzle seeder. Generates a small bank of valid Sudoku
// puzzles directly in the database, so you can play against `localhost`
// without downloading the 3M-row Kaggle dataset.
//
// Usage:
//   npm run puzzles:seed-local -- --per-bucket 20
//
// Strategy:
//   1) Start from one fully-solved grid.
//   2) Apply random valid transformations (digit relabel, row/col swaps
//      within bands, band swaps, stack swaps, transpose). Each transform
//      preserves Sudoku validity, so we get a fresh "unique" solution
//      grid effectively for free.
//   3) "Dig" cells out, after each removal verifying the puzzle still
//      has a unique solution. Stop when we hit the target clue count.

const BASE_SOLUTION =
  "534678912" +
  "672195348" +
  "198342567" +
  "859761423" +
  "426853791" +
  "713924856" +
  "961537284" +
  "287419635" +
  "345286179";

type Bucket = 1 | 2 | 3 | 4;

const TARGET_CLUES: Record<Bucket, [number, number]> = {
  1: [36, 40], // Easy
  2: [30, 35], // Medium
  3: [26, 29], // Hard
  4: [22, 25], // Expert
};

// Synthetic raw rating per bucket. The real importer derives this from
// Kaggle's ratings; here we just store something sensible so the column
// is non-null and ordered roughly by difficulty.
const RATING_FOR_BUCKET: Record<Bucket, number> = {
  1: 1.5,
  2: 3.5,
  3: 5.5,
  4: 7.5,
};

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gridFromString(s: string): Uint8Array {
  const g = new Uint8Array(81);
  for (let i = 0; i < 81; i++) g[i] = s.charCodeAt(i) - 48;
  return g;
}

function gridToString(g: Uint8Array): string {
  let s = "";
  for (let i = 0; i < 81; i++) s += String.fromCharCode(g[i] + 48);
  return s;
}

// Apply a random digit relabel: pick a permutation of 1..9 and remap
// every cell. Keeps the grid valid by construction.
function relabelDigits(g: Uint8Array): Uint8Array {
  const perm = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const out = new Uint8Array(81);
  for (let i = 0; i < 81; i++) out[i] = perm[g[i] - 1];
  return out;
}

// Swap two rows within the same band (rows 0..2, 3..5, or 6..8). Always
// preserves validity because the rows share the same boxes.
function swapRowsInBand(g: Uint8Array): Uint8Array {
  const band = Math.floor(Math.random() * 3);
  const rows = shuffle([0, 1, 2]).slice(0, 2).map((r) => band * 3 + r);
  const out = new Uint8Array(g);
  for (let c = 0; c < 9; c++) {
    const a = rows[0] * 9 + c;
    const b = rows[1] * 9 + c;
    [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}

function swapColsInStack(g: Uint8Array): Uint8Array {
  const stack = Math.floor(Math.random() * 3);
  const cols = shuffle([0, 1, 2]).slice(0, 2).map((c) => stack * 3 + c);
  const out = new Uint8Array(g);
  for (let r = 0; r < 9; r++) {
    const a = r * 9 + cols[0];
    const b = r * 9 + cols[1];
    [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}

function swapBands(g: Uint8Array): Uint8Array {
  const bands = shuffle([0, 1, 2]).slice(0, 2);
  const out = new Uint8Array(g);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      const a = (bands[0] * 3 + r) * 9 + c;
      const b = (bands[1] * 3 + r) * 9 + c;
      [out[a], out[b]] = [out[b], out[a]];
    }
  }
  return out;
}

function swapStacks(g: Uint8Array): Uint8Array {
  const stacks = shuffle([0, 1, 2]).slice(0, 2);
  const out = new Uint8Array(g);
  for (let c = 0; c < 3; c++) {
    for (let r = 0; r < 9; r++) {
      const a = r * 9 + stacks[0] * 3 + c;
      const b = r * 9 + stacks[1] * 3 + c;
      [out[a], out[b]] = [out[b], out[a]];
    }
  }
  return out;
}

function transpose(g: Uint8Array): Uint8Array {
  const out = new Uint8Array(81);
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) out[c * 9 + r] = g[r * 9 + c];
  }
  return out;
}

const TRANSFORMS = [
  relabelDigits,
  swapRowsInBand,
  swapColsInStack,
  swapBands,
  swapStacks,
  transpose,
];

function randomSolution(): Uint8Array {
  let g = gridFromString(BASE_SOLUTION);
  // 50 random transforms is plenty to reach a near-uniform sample of
  // the orbit reachable from the base grid.
  for (let i = 0; i < 50; i++) {
    const t = TRANSFORMS[Math.floor(Math.random() * TRANSFORMS.length)];
    g = t(g);
  }
  return g;
}

// Count solutions, capped at 2. We only care whether the count is 1 or
// >=2 (uniqueness check), so we abort early.
function countSolutions(board: Uint8Array, cap = 2): number {
  const work = new Uint8Array(board);
  let found = 0;
  function recurse(): boolean {
    let bestIdx = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (work[i] !== 0) continue;
      let mask = 0b111111111;
      for (const p of peers(i)) if (work[p] !== 0) mask &= ~(1 << (work[p] - 1));
      let count = 0;
      let m = mask;
      while (m) {
        m &= m - 1;
        count++;
      }
      if (count === 0) return false;
      if (count < bestCount) {
        bestCount = count;
        bestMask = mask;
        bestIdx = i;
        if (count === 1) break;
      }
    }
    if (bestIdx === -1) {
      found++;
      return found >= cap;
    }
    for (let d = 1; d <= 9; d++) {
      if ((bestMask & (1 << (d - 1))) === 0) continue;
      work[bestIdx] = d;
      if (recurse()) {
        work[bestIdx] = 0;
        return true;
      }
      work[bestIdx] = 0;
    }
    return false;
  }
  recurse();
  return found;
}

// Dig cells out of a full solution to produce a puzzle whose clue count
// falls in [lo, hi] AND whose solution is unique. We dig in a random
// order, restoring any cell whose removal would break uniqueness.
function dig(solution: Uint8Array, lo: number, hi: number): Uint8Array | null {
  const puzzle = new Uint8Array(solution);
  const order = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let clues = 81;
  for (const idx of order) {
    if (clues <= lo) break;
    const saved = puzzle[idx];
    puzzle[idx] = 0;
    if (countSolutions(puzzle, 2) !== 1) {
      puzzle[idx] = saved; // restore: this cell can't be removed
    } else {
      clues--;
    }
  }
  if (clues > hi) return null; // couldn't dig deep enough; caller retries
  return puzzle;
}

function generatePuzzleForBucket(bucket: Bucket): { puzzle: string; solution: string; clues: number } {
  const [lo, hi] = TARGET_CLUES[bucket];
  for (let attempt = 0; attempt < 20; attempt++) {
    const solution = randomSolution();
    const sBoard = parseBoard(gridToString(solution));
    if (!isFilled(sBoard) || findConflicts(sBoard).size > 0) continue;
    const puzzle = dig(solution, lo, hi);
    if (!puzzle) continue;
    let clues = 0;
    for (let i = 0; i < 81; i++) if (puzzle[i] !== 0) clues++;
    return {
      puzzle: gridToString(puzzle),
      solution: gridToString(solution),
      clues,
    };
  }
  throw new Error(`Failed to generate puzzle for bucket ${bucket} after 20 attempts`);
}

function parseArgs(): { perBucket: number } {
  const args = { perBucket: 12 };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === "--per-bucket") args.perBucket = Number(process.argv[++i]);
  }
  return args;
}

async function main() {
  const { perBucket } = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString: url });
  await client.connect();

  const rows: { puzzle: string; solution: string; clues: number; bucket: Bucket }[] = [];
  for (const bucket of [1, 2, 3, 4] as const) {
    process.stdout.write(`Generating ${perBucket} puzzles for bucket ${bucket}`);
    for (let i = 0; i < perBucket; i++) {
      rows.push({ ...generatePuzzleForBucket(bucket), bucket });
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }

  // Use one parameterized batch insert. Even at 200 rows this is plenty
  // fast for a local seed.
  const values: string[] = [];
  const params: (string | number)[] = [];
  let p = 1;
  for (const r of rows) {
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++})`);
    params.push(r.puzzle, r.solution, r.clues, RATING_FOR_BUCKET[r.bucket], r.bucket);
  }
  const result = await client.query(
    `insert into puzzles (puzzle, solution, clue_count, rating_raw, difficulty_bucket)
     values ${values.join(", ")}
     on conflict (puzzle) do nothing`,
    params,
  );
  console.log(`Inserted ${result.rowCount} new puzzles.`);

  const summary = await client.query<{ difficulty_bucket: number; n: string }>(
    `select difficulty_bucket, count(*)::text as n from puzzles group by 1 order by 1`,
  );
  for (const r of summary.rows) console.log(`  bucket ${r.difficulty_bucket}: ${r.n}`);

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
