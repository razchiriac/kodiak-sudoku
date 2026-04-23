import { BOARD_SIZE, type Board, type CellIndex, type Variant, peers } from "./board";
import { isLegalPlacement } from "./validate";

// A "next-step" hint suggestion. Either we identified a confident placement
// using a basic technique, or we fell back to revealing a cell from the
// known solution (always correct but pedagogically less interesting).
//
// `unit` + `unitIndex` describe the Sudoku unit (row/column/box) the player
// should focus on for a "look here" nudge — the coarsest public information
// about a hint that still reduces their search space meaningfully.
//
//   - hidden-single: unit is set to the specific unit that forced the
//     deduction (the row, column, OR box where only one cell can hold the
//     digit). This is the most natural tier-1 message.
//   - naked-single & from-solution: we only know one cell, so we default to
//     the cell's box (3×3 sub-grid) — a small enough region to narrow the
//     search but not as revealing as the exact row+col would be.
//
// `unitIndex` is 0-indexed internally. The UI converts to 1-indexed for
// display so players don't see "column 0" which is jarring.
// RAZ-18: "diag" covers both the main and anti-diagonal for hint
// messaging. The UI can render "look at the diagonal" without
// distinguishing which one — a single nudge per step is enough.
export type HintUnit = "row" | "col" | "box" | "diag";

export type HintSuggestion = {
  index: CellIndex;
  digit: number;
  technique: "naked-single" | "hidden-single" | "from-solution";
  unit: HintUnit;
  unitIndex: number;
};

// Helper: which 3x3 box contains the given cell index? Used as the default
// region for techniques that don't carry an explicit unit (naked-single,
// from-solution).
function boxOf(index: CellIndex): number {
  const r = Math.floor(index / 9);
  const c = index % 9;
  return Math.floor(r / 3) * 3 + Math.floor(c / 3);
}

// Compute candidate digits for every empty cell as a Uint16 bitmask.
// We export this so the UI can offer "auto-notes" without re-implementing
// the logic in the React layer.
export function computeCandidates(board: Board, variant?: Variant): Uint16Array {
  const candidates = new Uint16Array(BOARD_SIZE);
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] !== 0) continue;
    let mask = 0b111111111; // digits 1..9
    for (const p of peers(i, variant)) {
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
      return {
        index: i,
        digit,
        technique: "naked-single",
        unit: "box",
        unitIndex: boxOf(i),
      };
    }
  }
  return null;
}

// Look for a hidden single in rows, columns, and boxes (+ diagonals
// for the diagonal variant): a digit that can only legally go in one
// cell within a unit. Slightly harder for humans to spot than a
// naked single, so we try naked first.
function findHiddenSingle(board: Board, candidates: Uint16Array, variant?: Variant): HintSuggestion | null {
  // Build the units once, each tagged with its kind + index so a match
  // carries enough info for the tier-1 region nudge.
  type TaggedUnit = { kind: HintUnit; idx: number; cells: CellIndex[] };
  const units: TaggedUnit[] = [];
  for (let r = 0; r < 9; r++) {
    const cells: CellIndex[] = [];
    for (let c = 0; c < 9; c++) cells.push(r * 9 + c);
    units.push({ kind: "row", idx: r, cells });
  }
  for (let c = 0; c < 9; c++) {
    const cells: CellIndex[] = [];
    for (let r = 0; r < 9; r++) cells.push(r * 9 + c);
    units.push({ kind: "col", idx: c, cells });
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const cells: CellIndex[] = [];
      for (let r = br * 3; r < br * 3 + 3; r++) {
        for (let c = bc * 3; c < bc * 3 + 3; c++) cells.push(r * 9 + c);
      }
      units.push({ kind: "box", idx: br * 3 + bc, cells });
    }
  }
  // RAZ-18: Add diagonal units for the diagonal variant.
  if (variant === "diagonal") {
    const mainDiag: CellIndex[] = [];
    const antiDiag: CellIndex[] = [];
    for (let k = 0; k < 9; k++) {
      mainDiag.push(k * 9 + k);
      antiDiag.push(k * 9 + (8 - k));
    }
    units.push({ kind: "diag", idx: 0, cells: mainDiag });
    units.push({ kind: "diag", idx: 1, cells: antiDiag });
  }

  for (const unit of units) {
    for (let digit = 1; digit <= 9; digit++) {
      const bit = 1 << (digit - 1);
      let count = 0;
      let where: CellIndex = -1;
      for (const idx of unit.cells) {
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
        return {
          index: where,
          digit,
          technique: "hidden-single",
          unit: unit.kind,
          unitIndex: unit.idx,
        };
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
  options: { selected?: CellIndex | null; solution?: string | null; variant?: Variant } = {},
): HintSuggestion | null {
  const v = options.variant;
  const candidates = computeCandidates(board, v);

  // Prefer the selected cell if it's empty and has exactly one candidate.
  if (options.selected != null && board[options.selected] === 0) {
    const mask = candidates[options.selected];
    if (mask !== 0 && (mask & (mask - 1)) === 0) {
      return {
        index: options.selected,
        digit: Math.log2(mask) + 1,
        technique: "naked-single",
        unit: "box",
        unitIndex: boxOf(options.selected),
      };
    }
  }

  return (
    findNakedSingle(board, candidates) ??
    findHiddenSingle(board, candidates, v) ??
    fromSolution(board, options.solution ?? null, options.selected ?? null, v)
  );
}

// Fallback hint: pick a cell from the solution. Prefers the selected cell
// when it is empty; otherwise picks the first empty cell. Returns null when
// no solution string is available (caller should then ask the server).
function fromSolution(
  board: Board,
  solution: string | null,
  selected: CellIndex | null,
  variant?: Variant,
): HintSuggestion | null {
  if (!solution || solution.length !== BOARD_SIZE) return null;
  if (selected != null && board[selected] === 0) {
    const ch = solution[selected];
    const digit = ch.charCodeAt(0) - 48;
    if (digit >= 1 && digit <= 9 && isLegalPlacement(board, selected, digit, variant)) {
      return {
        index: selected,
        digit,
        technique: "from-solution",
        unit: "box",
        unitIndex: boxOf(selected),
      };
    }
  }
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] !== 0) continue;
    const ch = solution[i];
    const digit = ch.charCodeAt(0) - 48;
    if (digit >= 1 && digit <= 9 && isLegalPlacement(board, i, digit, variant)) {
      return {
        index: i,
        digit,
        technique: "from-solution",
        unit: "box",
        unitIndex: boxOf(i),
      };
    }
  }
  return null;
}

// Backtracking solver used by the import script to validate a solution
// matches a puzzle. Not used at runtime by the UI. Returns the first
// solution found (the dataset is assumed to have unique solutions).
export function solve(board: Board, variant?: Variant): Board | null {
  const work = new Uint8Array(board);
  const ok = backtrack(work, variant);
  return ok ? work : null;
}

function backtrack(work: Board, variant?: Variant): boolean {
  // Pick the empty cell with the fewest candidates (MRV heuristic). This
  // makes worst-case puzzles tractable in milliseconds.
  let bestIdx = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (work[i] !== 0) continue;
    let mask = 0b111111111;
    for (const p of peers(i, variant)) if (work[p] !== 0) mask &= ~(1 << (work[p] - 1));
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
    if (backtrack(work, variant)) return true;
  }
  work[bestIdx] = 0;
  return false;
}
