import { BOARD_SIZE, type Board, type CellIndex, peers } from "./board";
import { isLegalPlacement } from "./validate";

// A "next-step" hint suggestion. Either we identified a confident placement
// using a basic technique, or we fell back to revealing a cell from the
// known solution (always correct but pedagogically less interesting).
export type HintSuggestion = {
  index: CellIndex;
  digit: number;
  technique: "naked-single" | "hidden-single" | "from-solution";
};

// Compute candidate digits for every empty cell as a Uint16 bitmask.
// We export this so the UI can offer "auto-notes" without re-implementing
// the logic in the React layer.
export function computeCandidates(board: Board): Uint16Array {
  const candidates = new Uint16Array(BOARD_SIZE);
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] !== 0) continue;
    let mask = 0b111111111; // digits 1..9
    for (const p of peers(i)) {
      if (board[p] !== 0) mask &= ~(1 << (board[p] - 1));
    }
    candidates[i] = mask;
  }
  return candidates;
}

// Look for a naked single: an empty cell whose candidate set has exactly
// one digit. This is the simplest deduction and is a great hint to start
// with because it teaches scanning.
function findNakedSingle(board: Board, candidates: Uint16Array): HintSuggestion | null {
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] !== 0) continue;
    const mask = candidates[i];
    if (mask === 0) continue;
    // popcount === 1 check: mask is a power of two
    if ((mask & (mask - 1)) === 0) {
      const digit = Math.log2(mask) + 1;
      return { index: i, digit, technique: "naked-single" };
    }
  }
  return null;
}

// Look for a hidden single in rows, columns, and boxes: a digit that can
// only legally go in one cell within a unit. Slightly harder for humans to
// spot than a naked single, so we try naked first.
function findHiddenSingle(board: Board, candidates: Uint16Array): HintSuggestion | null {
  // Build all 27 units (9 rows + 9 cols + 9 boxes) once.
  const units: CellIndex[][] = [];
  for (let r = 0; r < 9; r++) {
    const row: CellIndex[] = [];
    for (let c = 0; c < 9; c++) row.push(r * 9 + c);
    units.push(row);
  }
  for (let c = 0; c < 9; c++) {
    const col: CellIndex[] = [];
    for (let r = 0; r < 9; r++) col.push(r * 9 + c);
    units.push(col);
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const box: CellIndex[] = [];
      for (let r = br * 3; r < br * 3 + 3; r++) {
        for (let c = bc * 3; c < bc * 3 + 3; c++) box.push(r * 9 + c);
      }
      units.push(box);
    }
  }

  for (const unit of units) {
    for (let digit = 1; digit <= 9; digit++) {
      const bit = 1 << (digit - 1);
      let count = 0;
      let where: CellIndex = -1;
      for (const idx of unit) {
        if (board[idx] === digit) {
          count = -1; // already placed in this unit
          break;
        }
        if (board[idx] === 0 && (candidates[idx] & bit) !== 0) {
          count++;
          where = idx;
          if (count > 1) break;
        }
      }
      if (count === 1 && where !== -1) {
        return { index: where, digit, technique: "hidden-single" };
      }
    }
  }
  return null;
}

// Compute the next hint to suggest for the given board. Strategy:
//   1) prefer the user's selected cell if a single placement is forced
//      there (best UX: respects user focus).
//   2) try naked single anywhere on the board.
//   3) try hidden single anywhere on the board.
//   4) fall back to the solution string (server-only path; client does not
//      have the solution for daily puzzles).
export function nextHint(
  board: Board,
  options: { selected?: CellIndex | null; solution?: string | null } = {},
): HintSuggestion | null {
  const candidates = computeCandidates(board);

  // Prefer the selected cell if it's empty and has exactly one candidate.
  if (options.selected != null && board[options.selected] === 0) {
    const mask = candidates[options.selected];
    if (mask !== 0 && (mask & (mask - 1)) === 0) {
      return {
        index: options.selected,
        digit: Math.log2(mask) + 1,
        technique: "naked-single",
      };
    }
  }

  return (
    findNakedSingle(board, candidates) ??
    findHiddenSingle(board, candidates) ??
    fromSolution(board, options.solution ?? null, options.selected ?? null)
  );
}

// Fallback hint: pick a cell from the solution. Prefers the selected cell
// when it is empty; otherwise picks the first empty cell. Returns null when
// no solution string is available (caller should then ask the server).
function fromSolution(
  board: Board,
  solution: string | null,
  selected: CellIndex | null,
): HintSuggestion | null {
  if (!solution || solution.length !== BOARD_SIZE) return null;
  if (selected != null && board[selected] === 0) {
    const ch = solution[selected];
    const digit = ch.charCodeAt(0) - 48;
    if (digit >= 1 && digit <= 9 && isLegalPlacement(board, selected, digit)) {
      return { index: selected, digit, technique: "from-solution" };
    }
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] !== 0) continue;
    const ch = solution[i];
    const digit = ch.charCodeAt(0) - 48;
    if (digit >= 1 && digit <= 9 && isLegalPlacement(board, i, digit)) {
      return { index: i, digit, technique: "from-solution" };
    }
  }
  return null;
}

// Backtracking solver used by the import script to validate a solution
// matches a puzzle. Not used at runtime by the UI. Returns the first
// solution found (the dataset is assumed to have unique solutions).
export function solve(board: Board): Board | null {
  const work = new Uint8Array(board);
  const ok = backtrack(work);
  return ok ? work : null;
}

function backtrack(work: Board): boolean {
  // Pick the empty cell with the fewest candidates (MRV heuristic). This
  // makes worst-case puzzles tractable in milliseconds.
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
  if (bestIdx === -1) return true; // solved
  for (let d = 1; d <= 9; d++) {
    if ((bestMask & (1 << (d - 1))) === 0) continue;
    work[bestIdx] = d;
    if (backtrack(work)) return true;
  }
  work[bestIdx] = 0;
  return false;
}
