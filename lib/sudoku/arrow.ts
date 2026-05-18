/**
 * RAZ-120: Arrow Sudoku engine utilities.
 *
 * Arrow Sudoku places circles on the board with arrows extending from them.
 * The constraint: the digits along each arrow must sum to the digit in the
 * circle cell. This module defines the Arrow type and provides pure validation
 * helpers for checking arrow constraints against a board state.
 *
 * Framework-free — no React imports. Uses the same Board type as the rest
 * of lib/sudoku/*.
 */

import type { Board, CellIndex } from "./board";

/**
 * An arrow constraint on the board.
 *
 * - `circle`: flat index (0–80) of the circle cell (the sum target).
 * - `cells`: ordered array of flat indices along the arrow body. The sum
 *   of digits in these cells must equal the digit in `circle`.
 *
 * Arrows can extend in any direction (orthogonal or diagonal) and may
 * curve — `cells` simply lists the path in order from the circle outward.
 */
export interface Arrow {
  circle: CellIndex;
  cells: CellIndex[];
}

/**
 * Returns true when all cells in the arrow (circle + body) are filled AND
 * the sum of the body digits equals the circle digit.
 *
 * An arrow with any empty cell (value 0) is considered "not yet satisfiable"
 * and returns false — this is intentional so the overlay can distinguish
 * between "incomplete" (gray) and "satisfied" (green).
 */
export function isArrowSatisfied(arrow: Arrow, board: Board): boolean {
  const circleDigit = board[arrow.circle];
  // Circle or any body cell still empty → not satisfied yet
  if (circleDigit === 0) return false;

  let sum = 0;
  for (const idx of arrow.cells) {
    const d = board[idx];
    if (d === 0) return false;
    sum += d;
  }

  return sum === circleDigit;
}

/**
 * Returns the indices (into the arrows array) of arrows that are currently
 * violated — meaning all cells are filled but the sum doesn't match.
 *
 * Arrows with any empty cell are ignored (they're incomplete, not violated).
 * This distinction matters for coloring: incomplete arrows stay neutral,
 * violated arrows turn red.
 */
export function getArrowViolations(arrows: readonly Arrow[], board: Board): number[] {
  const violations: number[] = [];

  for (let i = 0; i < arrows.length; i++) {
    const arrow = arrows[i];
    const circleDigit = board[arrow.circle];
    // Skip arrows that haven't been fully filled yet
    if (circleDigit === 0) continue;

    let allFilled = true;
    let sum = 0;
    for (const idx of arrow.cells) {
      const d = board[idx];
      if (d === 0) {
        allFilled = false;
        break;
      }
      sum += d;
    }

    // Only flag as violated when fully filled and sum doesn't match
    if (allFilled && sum !== circleDigit) {
      violations.push(i);
    }
  }

  return violations;
}
