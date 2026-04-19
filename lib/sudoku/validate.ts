import { BOARD_SIZE, type Board, type CellIndex, peers } from "./board";

// Find every cell that conflicts with at least one peer (same row, col, or
// box has a duplicate digit). Returns a Set so callers can check membership
// in O(1) when rendering each cell.
export function findConflicts(board: Board): Set<CellIndex> {
  const conflicts = new Set<CellIndex>();
  for (let i = 0; i < BOARD_SIZE; i++) {
    const v = board[i];
    if (v === 0) continue;
    for (const p of peers(i)) {
      if (board[p] === v) {
        conflicts.add(i);
        conflicts.add(p);
      }
    }
  }
  return conflicts;
}

// Returns true iff every cell is filled (no zeros). Does NOT verify the
// solution; pair with findConflicts() for the "no conflicts and full" win
// state, or with isCorrect() for solution-equality.
export function isFilled(board: Board): boolean {
  for (let i = 0; i < BOARD_SIZE; i++) if (board[i] === 0) return false;
  return true;
}

// Returns true iff the board is filled and has no conflicts. This is the
// pure-Sudoku win condition; we still verify against the stored solution
// server-side before recording a completion.
export function isComplete(board: Board): boolean {
  if (!isFilled(board)) return false;
  return findConflicts(board).size === 0;
}

// Strict equality with a known solution (also an 81-char string or Board).
// Used server-side; we never trust client win claims.
export function isCorrect(board: Board, solution: Board | string): boolean {
  if (typeof solution === "string") {
    if (solution.length !== BOARD_SIZE) return false;
    for (let i = 0; i < BOARD_SIZE; i++) {
      if (board[i].toString() !== solution[i]) return false;
    }
    return true;
  }
  for (let i = 0; i < BOARD_SIZE; i++) if (board[i] !== solution[i]) return false;
  return true;
}

// Returns true iff placing `digit` in `index` would create no immediate
// conflict with peers. Used by the "strict" mode to prevent invalid moves.
export function isLegalPlacement(board: Board, index: CellIndex, digit: number): boolean {
  if (digit < 1 || digit > 9) return false;
  for (const p of peers(index)) if (board[p] === digit) return false;
  return true;
}
