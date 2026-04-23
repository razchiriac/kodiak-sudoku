// RAZ-38 — Puzzle augmentation helpers.
//
// Our imported puzzle set (Kaggle `sudoku-3m`) sits near the minimum
// clue count (~24 clues per puzzle regardless of rating). For most
// players, felt difficulty is dominated by clue count rather than
// technique difficulty — a 24-clue puzzle feels Expert even if its
// Kaggle rating would place it at "Easy" by solver metrics.
//
// This module turns a low-clue puzzle into a higher-clue one by
// revealing additional cells from its known solution. Adding clues
// strictly reduces the set of candidate digits per cell, so:
//
//   - Uniqueness of the solution is preserved (a unique-solution
//     puzzle remains unique-solution when you add clues from that
//     solution).
//   - Technique difficulty falls monotonically — more clues mean
//     more naked-single opportunities.
//
// The callers are:
//
//   1. scripts/rebalance-difficulty.ts — one-off backfill to bring
//      the existing DB into the new clue-count ranges per bucket.
//   2. scripts/import-puzzles.ts — future imports apply the same
//      transformation at ingest time so we don't regress.
//
// Both callers want deterministic behavior under tests (for
// reproducibility), so the RNG is injectable.

/** Target clue counts per difficulty bucket.
 *
 * These ranges match a rough consensus of newspaper-style difficulty:
 *
 *   Easy 38-45, Medium 32-37, Hard 28-31, Expert 22-27.
 *
 * We clamp Easy's top at 40 because our DB check constraint
 * (`puzzles_clue_range`) allows 17-40 clues. Expert is left at its
 * natural low-clue distribution (no augmentation needed).
 *
 * The `max` is the target we augment up to; `min` is documentary
 * for downstream asserts (e.g. Playwright). We don't aim for a
 * random spread within the band because a deterministic target
 * keeps the feel consistent per bucket.
 */
export const CLUE_TARGETS: Readonly<
  Record<1 | 2 | 3, { min: number; target: number }>
> = {
  // Easy: a truly easy puzzle is solvable with naked singles alone.
  // 40 clues plus a correct solution gives plenty of immediate wins.
  1: { min: 38, target: 40 },
  // Medium: hidden singles should still appear. 32 clues is the
  // sweet spot where the grid still looks sparse but moves flow.
  2: { min: 32, target: 33 },
  // Hard: keep the challenge of pointing pairs / naked pairs visible
  // but raise clue count just enough that the opening doesn't feel
  // impossible. A 4-5 clue bump from the 24-clue baseline.
  3: { min: 28, target: 29 },
};

/**
 * Reveal additional clues from `solution` until `puzzle` reaches
 * `targetClueCount`. Returns the augmented 81-char puzzle string.
 *
 * Idempotent: if the puzzle already has >= target clues, it's
 * returned unchanged. This matters for re-running the backfill
 * script safely.
 *
 * `rng` is injectable so tests can assert deterministic output.
 * In production we use `Math.random`.
 */
export function augmentToClueCount(
  puzzle: string,
  solution: string,
  targetClueCount: number,
  rng: () => number = Math.random,
): string {
  if (puzzle.length !== 81) {
    throw new Error(`augmentToClueCount: puzzle length ${puzzle.length}`);
  }
  if (solution.length !== 81) {
    throw new Error(`augmentToClueCount: solution length ${solution.length}`);
  }

  // Collect every cell currently empty ('0'). These are the
  // candidates we can reveal from the solution. We skip non-zero
  // positions entirely because revealing a clue that's already
  // present is a no-op, and revealing one that disagrees with the
  // solution would signal a corrupt puzzle/solution pair — we
  // surface that rather than silently rewrite a real clue.
  const blanks: number[] = [];
  for (let i = 0; i < 81; i++) {
    const p = puzzle[i];
    if (p === "0" || p === ".") {
      blanks.push(i);
    } else if (p !== solution[i]) {
      throw new Error(
        `augmentToClueCount: clue at ${i} disagrees with solution (${p} vs ${solution[i]})`,
      );
    }
  }

  const currentClues = 81 - blanks.length;
  if (currentClues >= targetClueCount) {
    // Already at/above target — return as-is. We deliberately
    // don't *remove* clues to match a lower target, because the
    // whole point of this helper is to safely raise clue count.
    return puzzle;
  }

  const toReveal = Math.min(targetClueCount - currentClues, blanks.length);

  // Fisher-Yates shuffle the blank list, then take the first
  // `toReveal` indices. This gives a uniform random subset without
  // the "pick with replacement, dedupe" cost.
  for (let i = blanks.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [blanks[i], blanks[j]] = [blanks[j], blanks[i]];
  }

  const chars = puzzle.split("");
  for (let k = 0; k < toReveal; k++) {
    const idx = blanks[k];
    chars[idx] = solution[idx];
  }
  return chars.join("");
}

/** Count non-zero digits in a puzzle string (i.e. clue count). */
export function countClues(puzzle: string): number {
  let n = 0;
  for (const ch of puzzle) {
    if (ch !== "0" && ch !== ".") n++;
  }
  return n;
}
