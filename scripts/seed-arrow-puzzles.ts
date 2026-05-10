/* eslint-disable no-console */
import { Client } from "pg";

/**
 * RAZ-120: Arrow Sudoku puzzle seeder.
 *
 * Generates arrow puzzles by:
 *   1. Starting from a known valid solved 9x9 grid.
 *   2. Applying random valid transformations (digit relabel, row/col swaps).
 *   3. Defining arrow constraints that hold true on the solved grid.
 *   4. Digging cells to create a playable puzzle.
 *
 * Arrow constraints: the digit in the circle cell equals the sum of
 * digits along the arrow body cells.
 *
 * Usage:
 *   npx tsx scripts/seed-arrow-puzzles.ts
 *   (or: DATABASE_URL=postgres://... npx tsx scripts/seed-arrow-puzzles.ts)
 */

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

// Number of arrow puzzles to generate per difficulty bucket (1=Easy, 2=Med, 3=Hard).
const PER_BUCKET = 4;

// Clue ranges per bucket (slightly more givens than standard due to arrow hints).
const TARGET_CLUES: Record<number, [number, number]> = {
  1: [34, 38],
  2: [28, 33],
  3: [24, 27],
};

const RATING_FOR_BUCKET: Record<number, number> = {
  1: 2.0,
  2: 4.0,
  3: 6.0,
};

interface Arrow {
  circle: number;
  cells: number[];
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function gridFromString(s: string): number[] {
  return Array.from(s, (c) => c.charCodeAt(0) - 48);
}

function gridToString(g: number[]): string {
  return g.map((d) => String.fromCharCode(d + 48)).join("");
}

function relabelDigits(g: number[]): number[] {
  const perm = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  return g.map((d) => (d === 0 ? 0 : perm[d - 1]));
}

function swapRowsInBand(g: number[]): number[] {
  const out = [...g];
  const band = Math.floor(Math.random() * 3);
  const rows = shuffle([0, 1, 2]).slice(0, 2).map((r) => band * 3 + r);
  for (let c = 0; c < 9; c++) {
    const a = rows[0] * 9 + c;
    const b = rows[1] * 9 + c;
    [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}

function swapColsInStack(g: number[]): number[] {
  const out = [...g];
  const stack = Math.floor(Math.random() * 3);
  const cols = shuffle([0, 1, 2]).slice(0, 2).map((c) => stack * 3 + c);
  for (let r = 0; r < 9; r++) {
    const a = r * 9 + cols[0];
    const b = r * 9 + cols[1];
    [out[a], out[b]] = [out[b], out[a]];
  }
  return out;
}

function transpose(g: number[]): number[] {
  const out = new Array(81);
  for (let r = 0; r < 9; r++)
    for (let c = 0; c < 9; c++) out[c * 9 + r] = g[r * 9 + c];
  return out;
}

/** Generate a random valid solution by transforming the base grid. */
function randomSolution(): number[] {
  let g = gridFromString(BASE_SOLUTION);
  for (let i = 0; i < 10; i++) {
    g = relabelDigits(g);
    g = swapRowsInBand(g);
    g = swapColsInStack(g);
    if (Math.random() < 0.5) g = transpose(g);
  }
  return g;
}

/**
 * Try to find valid arrow constraints on the given solution grid.
 * An arrow is valid when the circle cell digit equals the sum of
 * the body cell digits. We try random paths (2-4 cells long) extending
 * from each candidate circle cell.
 */
function findArrows(solution: number[], count: number): Arrow[] {
  const arrows: Arrow[] = [];
  const used = new Set<number>();

  // Directional offsets: right, down, left, up, and diagonals.
  const DIRS = [
    [0, 1], [1, 0], [0, -1], [-1, 0],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];

  const attempts = shuffle(Array.from({ length: 81 }, (_, i) => i));

  for (const circleIdx of attempts) {
    if (arrows.length >= count) break;
    if (used.has(circleIdx)) continue;

    const circleDigit = solution[circleIdx];
    // Circle cell needs value >= 3 to be summable by 2+ body cells
    if (circleDigit < 3) continue;

    const row = Math.floor(circleIdx / 9);
    const col = circleIdx % 9;

    // Try each direction for a straight-line arrow
    for (const [dr, dc] of shuffle(DIRS)) {
      const bodyCells: number[] = [];
      let sum = 0;
      let r = row + dr;
      let c = col + dc;

      // Extend the arrow 2-4 cells in one direction
      const maxLen = Math.min(4, circleDigit); // sum can't exceed circle digit
      while (bodyCells.length < maxLen && r >= 0 && r < 9 && c >= 0 && c < 9) {
        const idx = r * 9 + c;
        if (used.has(idx)) break;
        sum += solution[idx];
        if (sum > circleDigit) break;
        bodyCells.push(idx);
        if (sum === circleDigit && bodyCells.length >= 2) break;
        r += dr;
        c += dc;
      }

      // Valid arrow: 2+ body cells whose digits sum to the circle digit
      if (bodyCells.length >= 2 && sum === circleDigit) {
        arrows.push({ circle: circleIdx, cells: bodyCells });
        used.add(circleIdx);
        for (const idx of bodyCells) used.add(idx);
        break;
      }
    }
  }

  return arrows;
}

/** Simple brute-force solver that counts solutions up to `limit`. */
function countSolutions(puzzle: number[], limit: number): number {
  const board = [...puzzle];
  let count = 0;

  function peers(idx: number): number[] {
    const r = Math.floor(idx / 9);
    const c = idx % 9;
    const br = Math.floor(r / 3) * 3;
    const bc = Math.floor(c / 3) * 3;
    const p: number[] = [];
    for (let i = 0; i < 9; i++) {
      if (i !== c) p.push(r * 9 + i);
      if (i !== r) p.push(i * 9 + c);
    }
    for (let dr = 0; dr < 3; dr++)
      for (let dc = 0; dc < 3; dc++) {
        const idx2 = (br + dr) * 9 + (bc + dc);
        if (idx2 !== idx) p.push(idx2);
      }
    return [...new Set(p)];
  }

  function solve(): boolean {
    // Find next empty cell
    let best = -1;
    let bestCount = 10;
    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0) continue;
      const used = new Set(peers(i).map((p) => board[p]).filter((d) => d > 0));
      const avail = 9 - used.size;
      if (avail < bestCount) {
        bestCount = avail;
        best = i;
        if (avail === 0) return false;
      }
    }
    if (best === -1) {
      count++;
      return count >= limit;
    }
    const peerVals = new Set(peers(best).map((p) => board[p]));
    for (let d = 1; d <= 9; d++) {
      if (peerVals.has(d)) continue;
      board[best] = d;
      if (solve()) return true;
    }
    board[best] = 0;
    return false;
  }

  solve();
  return count;
}

/** Dig cells to create a playable puzzle with unique solution. */
function dig(solution: number[], lo: number, hi: number): number[] | null {
  const puzzle = [...solution];
  const order = shuffle(Array.from({ length: 81 }, (_, i) => i));
  let clues = 81;

  for (const idx of order) {
    if (clues <= lo) break;
    const saved = puzzle[idx];
    puzzle[idx] = 0;
    if (countSolutions(puzzle, 2) !== 1) {
      puzzle[idx] = saved;
    } else {
      clues--;
    }
  }
  if (clues > hi) return null;
  return puzzle;
}

interface GeneratedPuzzle {
  puzzle: string;
  solution: string;
  clues: number;
  arrows: Arrow[];
}

function generateArrowPuzzle(bucket: number): GeneratedPuzzle {
  const [lo, hi] = TARGET_CLUES[bucket];
  // Number of arrows scales with difficulty (more arrows = more constraints = easier)
  const arrowCount = bucket === 1 ? 5 : bucket === 2 ? 4 : 3;

  for (let attempt = 0; attempt < 30; attempt++) {
    const solution = randomSolution();
    const arrows = findArrows(solution, arrowCount);
    if (arrows.length < arrowCount) continue;

    const puzzleBoard = dig(solution, lo, hi);
    if (!puzzleBoard) continue;

    let clues = 0;
    for (let i = 0; i < 81; i++) if (puzzleBoard[i] !== 0) clues++;

    return {
      puzzle: gridToString(puzzleBoard),
      solution: gridToString(solution),
      clues,
      arrows,
    };
  }
  throw new Error(`Failed to generate arrow puzzle for bucket ${bucket}`);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const client = new Client({ connectionString: url });
  await client.connect();

  console.log("Seeding arrow puzzles...");

  const rows: GeneratedPuzzle[] = [];
  const buckets: number[] = [];

  for (const bucket of [1, 2, 3]) {
    process.stdout.write(`  Bucket ${bucket}: generating ${PER_BUCKET} puzzles`);
    for (let i = 0; i < PER_BUCKET; i++) {
      rows.push(generateArrowPuzzle(bucket));
      buckets.push(bucket);
      process.stdout.write(".");
    }
    process.stdout.write("\n");
  }

  // Batch insert with variant='arrow' and variant_data containing arrows.
  const values: string[] = [];
  const params: (string | number)[] = [];
  let p = 1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const bucket = buckets[i];
    const variantData = JSON.stringify({ arrows: r.arrows });
    values.push(`($${p++}, $${p++}, $${p++}, $${p++}, $${p++}, 'arrow', $${p++}::jsonb)`);
    params.push(r.puzzle, r.solution, r.clues, RATING_FOR_BUCKET[bucket], bucket, variantData);
  }

  const result = await client.query(
    `INSERT INTO puzzles (puzzle, solution, clue_count, rating_raw, difficulty_bucket, variant, variant_data)
     VALUES ${values.join(", ")}
     ON CONFLICT (puzzle) DO NOTHING`,
    params,
  );
  console.log(`\nInserted ${result.rowCount} arrow puzzles.`);

  const summary = await client.query<{ variant: string; difficulty_bucket: number; n: string }>(
    `SELECT variant, difficulty_bucket, count(*)::text AS n
     FROM puzzles WHERE variant = 'arrow'
     GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  for (const r of summary.rows) {
    console.log(`  ${r.variant} bucket ${r.difficulty_bucket}: ${r.n}`);
  }

  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
