#!/usr/bin/env tsx
// RAZ-18: Generate diagonal Sudoku puzzles.
//
// Diagonal Sudoku adds two extra constraints: both main diagonals must
// contain 1-9 exactly once. This script generates puzzles by:
//   1. Filling an empty board respecting diagonal constraints via
//      backtracking (the `solve` function with variant="diagonal").
//   2. Removing clues one by one (in random order) while verifying
//      the puzzle still has a unique solution under diagonal rules.
//   3. Bucketing the result by clue count into Easy/Medium/Hard.
//
// Usage: npx tsx scripts/generate-diagonal.ts [count]
// Default count: 50 per bucket (150 total).

import { Client } from "pg";
import { solve } from "../lib/sudoku/solver";
import { serializeBoard, BOARD_SIZE } from "../lib/sudoku/board";
import type { Variant } from "../lib/sudoku/board";

const VARIANT: Variant = "diagonal";
const PER_BUCKET = Number(process.argv[2]) || 50;

// Diagonal puzzles have tighter constraints so fewer clues are needed.
// minClues stops clue removal early to control difficulty.
const BUCKET_DEFS: Array<{ bucket: number; minClues: number; maxClues: number }> = [
  { bucket: 1, minClues: 32, maxClues: 40 }, // Easy: keep many clues
  { bucket: 2, minClues: 26, maxClues: 31 }, // Medium
  { bucket: 3, minClues: 19, maxClues: 25 }, // Hard: remove as many as possible
];

function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Count solutions for a diagonal puzzle (up to limit). */
function countSolutions(board: Uint8Array, limit: number): number {
  let count = 0;
  const work = new Uint8Array(board);

  function bt(): boolean {
    let bestIdx = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (work[i] !== 0) continue;
      let mask = 0b111111111;
      // Compute peers for diagonal variant inline for performance.
      const row = Math.floor(i / 9);
      const col = i % 9;
      const boxRow = Math.floor(row / 3) * 3;
      const boxCol = Math.floor(col / 3) * 3;
      // Row peers
      for (let c = 0; c < 9; c++) {
        const v = work[row * 9 + c];
        if (v) mask &= ~(1 << (v - 1));
      }
      // Col peers
      for (let r = 0; r < 9; r++) {
        const v = work[r * 9 + col];
        if (v) mask &= ~(1 << (v - 1));
      }
      // Box peers
      for (let r = boxRow; r < boxRow + 3; r++) {
        for (let c = boxCol; c < boxCol + 3; c++) {
          const v = work[r * 9 + c];
          if (v) mask &= ~(1 << (v - 1));
        }
      }
      // Main diagonal
      if (row === col) {
        for (let k = 0; k < 9; k++) {
          const v = work[k * 9 + k];
          if (v) mask &= ~(1 << (v - 1));
        }
      }
      // Anti-diagonal
      if (row + col === 8) {
        for (let k = 0; k < 9; k++) {
          const v = work[k * 9 + (8 - k)];
          if (v) mask &= ~(1 << (v - 1));
        }
      }
      let c = 0;
      let m = mask;
      while (m) { m &= m - 1; c++; }
      if (c === 0) return false;
      if (c < bestCount) {
        bestCount = c;
        bestMask = mask;
        bestIdx = i;
        if (c === 1) break;
      }
    }
    if (bestIdx === -1) {
      count++;
      return count >= limit;
    }
    for (let d = 1; d <= 9; d++) {
      if ((bestMask & (1 << (d - 1))) === 0) continue;
      work[bestIdx] = d;
      if (bt()) return true;
      work[bestIdx] = 0;
    }
    return false;
  }

  bt();
  return count;
}

/** Generate one full diagonal solution by solving an empty board. */
function generateFullSolution(): Uint8Array | null {
  // Start with an empty board and add some random seed values
  // on the main diagonal to break symmetry and speed up solving.
  const board = new Uint8Array(BOARD_SIZE);
  // Shuffle digits 1-9 for the main diagonal seed.
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Place first 3 digits of the shuffled array on the main diagonal
  // (first box diagonal cells) to guide the solver.
  for (let k = 0; k < 3; k++) {
    board[k * 9 + k] = digits[k];
  }
  return solve(board, VARIANT);
}

/** Remove clues from a full solution to create a puzzle with a unique solution.
 *  Stops when reaching minClues to control difficulty level. */
function createPuzzle(
  solution: Uint8Array,
  minClues: number,
): { puzzle: string; clueCount: number } | null {
  const puzzle = new Uint8Array(solution);
  const indices = shuffle(Array.from({ length: BOARD_SIZE }, (_, i) => i));

  let clueCount = BOARD_SIZE;
  for (const idx of indices) {
    if (clueCount <= minClues) break; // Stop — reached target difficulty.
    const saved = puzzle[idx];
    puzzle[idx] = 0;

    // Check if puzzle still has a unique solution.
    if (countSolutions(puzzle, 2) !== 1) {
      puzzle[idx] = saved; // Restore — removing this clue creates ambiguity.
    } else {
      clueCount--;
    }
  }

  return { puzzle: serializeBoard(puzzle), clueCount };
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let totalInserted = 0;

  // Generate puzzles for each difficulty bucket separately so we can
  // control the clue-removal depth per bucket.
  for (const def of BUCKET_DEFS) {
    let inserted = 0;
    let attempts = 0;
    const maxAttempts = PER_BUCKET * 30;

    console.log(
      `Bucket ${def.bucket}: generating ${PER_BUCKET} puzzles (${def.minClues}-${def.maxClues} clues)...`,
    );

    while (inserted < PER_BUCKET && attempts < maxAttempts) {
      attempts++;
      const solution = generateFullSolution();
      if (!solution) continue;

      const result = createPuzzle(solution, def.minClues);
      if (!result) continue;

      const { puzzle: puzzleStr, clueCount } = result;
      if (clueCount < def.minClues || clueCount > def.maxClues) continue;

      const solutionStr = serializeBoard(solution);

      try {
        await client.query(
          `INSERT INTO puzzles (puzzle, solution, clue_count, rating_raw, difficulty_bucket, variant)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [puzzleStr, solutionStr, clueCount, 0, def.bucket, "diagonal"],
        );
        inserted++;
        totalInserted++;
        if (inserted % 10 === 0) {
          console.log(`  Bucket ${def.bucket}: ${inserted}/${PER_BUCKET}`);
        }
      } catch {
        // Duplicate puzzle string — skip.
      }
    }

    console.log(
      `  Bucket ${def.bucket} done: ${inserted} puzzles in ${attempts} attempts.`,
    );
  }

  await client.end();
  console.log(`Done. Generated ${totalInserted} diagonal puzzles total.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
