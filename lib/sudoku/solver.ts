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

export type HintTechnique =
  | "naked-single"
  | "hidden-single"
  | "pointing-pair"
  | "box-line-reduction"
  | "naked-pair"
  | "naked-triple"
  | "hidden-pair"
  | "x-wing"
  | "swordfish"
  | "from-solution";

export type HintSuggestion = {
  index: CellIndex;
  digit: number;
  technique: HintTechnique;
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
type TaggedUnit = { kind: HintUnit; idx: number; cells: CellIndex[] };

function buildUnits(variant?: Variant): TaggedUnit[] {
  // Build the units once, each tagged with its kind + index so a match
  // carries enough info for the tier-1 region nudge.
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
  return units;
}

function findHiddenSingle(
  board: Board,
  candidates: Uint16Array,
  variant?: Variant,
): HintSuggestion | null {
  const units = buildUnits(variant);
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

function cloneCandidates(candidates: Uint16Array): Uint16Array {
  return new Uint16Array(candidates);
}

function candidateCount(mask: number): number {
  let count = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    count++;
  }
  return count;
}

function overrideTechnique(
  hint: HintSuggestion | null,
  technique: HintTechnique,
  unit: HintUnit,
  unitIndex: number,
): HintSuggestion | null {
  if (!hint) return null;
  return { ...hint, technique, unit, unitIndex };
}

function firstForcedPlacement(
  board: Board,
  candidates: Uint16Array,
  technique: HintTechnique,
  unit: HintUnit,
  unitIndex: number,
  variant?: Variant,
): HintSuggestion | null {
  return overrideTechnique(
    findNakedSingle(board, candidates) ?? findHiddenSingle(board, candidates, variant),
    technique,
    unit,
    unitIndex,
  );
}

function rowCells(row: number): CellIndex[] {
  const cells: CellIndex[] = [];
  for (let c = 0; c < 9; c++) cells.push(row * 9 + c);
  return cells;
}

function colCells(col: number): CellIndex[] {
  const cells: CellIndex[] = [];
  for (let r = 0; r < 9; r++) cells.push(r * 9 + col);
  return cells;
}

function boxCells(box: number): CellIndex[] {
  const cells: CellIndex[] = [];
  const br = Math.floor(box / 3) * 3;
  const bc = (box % 3) * 3;
  for (let r = br; r < br + 3; r++) {
    for (let c = bc; c < bc + 3; c++) cells.push(r * 9 + c);
  }
  return cells;
}

function findPointingPair(
  board: Board,
  candidates: Uint16Array,
  variant?: Variant,
): HintSuggestion | null {
  // Pointing pair/triple: all candidates for a digit inside one box
  // sit on the same row/column, so that digit can be removed from the
  // rest of that row/column. We return the first placement made forced
  // by that removal.
  for (let box = 0; box < 9; box++) {
    const boxSet = new Set(boxCells(box));
    for (let digit = 1; digit <= 9; digit++) {
      const bit = 1 << (digit - 1);
      const where = boxCells(box).filter(
        (idx) => board[idx] === 0 && (candidates[idx] & bit) !== 0,
      );
      if (where.length < 2 || where.length > 3) continue;
      const row = Math.floor(where[0] / 9);
      const sameRow = where.every((idx) => Math.floor(idx / 9) === row);
      const col = where[0] % 9;
      const sameCol = where.every((idx) => idx % 9 === col);
      if (!sameRow && !sameCol) continue;
      const next = cloneCandidates(candidates);
      let changed = false;
      const peersToTrim = sameRow ? rowCells(row) : colCells(col);
      for (const idx of peersToTrim) {
        if (boxSet.has(idx) || board[idx] !== 0) continue;
        if ((next[idx] & bit) !== 0) {
          next[idx] &= ~bit;
          changed = true;
        }
      }
      if (!changed) continue;
      const hint = firstForcedPlacement(
        board,
        next,
        "pointing-pair",
        sameRow ? "row" : "col",
        sameRow ? row : col,
        variant,
      );
      if (hint) return hint;
    }
  }
  return null;
}

function findBoxLineReduction(
  board: Board,
  candidates: Uint16Array,
  variant?: Variant,
): HintSuggestion | null {
  // Box-line reduction: all candidates for a digit in a row/column sit
  // inside the same box, so that digit can be removed from the rest of
  // that box.
  const units = [
    ...Array.from({ length: 9 }, (_, idx) => ({
      kind: "row" as const,
      idx,
      cells: rowCells(idx),
    })),
    ...Array.from({ length: 9 }, (_, idx) => ({
      kind: "col" as const,
      idx,
      cells: colCells(idx),
    })),
  ];
  for (const unit of units) {
    for (let digit = 1; digit <= 9; digit++) {
      const bit = 1 << (digit - 1);
      const where = unit.cells.filter(
        (idx) => board[idx] === 0 && (candidates[idx] & bit) !== 0,
      );
      if (where.length < 2 || where.length > 3) continue;
      const box = boxOf(where[0]);
      if (!where.every((idx) => boxOf(idx) === box)) continue;
      const unitSet = new Set(unit.cells);
      const next = cloneCandidates(candidates);
      let changed = false;
      for (const idx of boxCells(box)) {
        if (unitSet.has(idx) || board[idx] !== 0) continue;
        if ((next[idx] & bit) !== 0) {
          next[idx] &= ~bit;
          changed = true;
        }
      }
      if (!changed) continue;
      const hint = firstForcedPlacement(
        board,
        next,
        "box-line-reduction",
        "box",
        box,
        variant,
      );
      if (hint) return hint;
    }
  }
  return null;
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  function visit(start: number, combo: T[]) {
    if (combo.length === size) {
      out.push(combo.slice());
      return;
    }
    for (let i = start; i <= items.length - (size - combo.length); i++) {
      combo.push(items[i]);
      visit(i + 1, combo);
      combo.pop();
    }
  }
  visit(0, []);
  return out;
}

function findNakedSubset(
  board: Board,
  candidates: Uint16Array,
  size: 2 | 3,
  variant?: Variant,
): HintSuggestion | null {
  const technique = size === 2 ? "naked-pair" : "naked-triple";
  for (const unit of buildUnits(variant)) {
    const empties = unit.cells.filter((idx) => board[idx] === 0);
    for (const combo of combinations(empties, size)) {
      let union = 0;
      let valid = true;
      for (const idx of combo) {
        const mask = candidates[idx];
        const count = candidateCount(mask);
        if (count < 2 || count > size) {
          valid = false;
          break;
        }
        union |= mask;
      }
      if (!valid || candidateCount(union) !== size) continue;
      const comboSet = new Set(combo);
      const next = cloneCandidates(candidates);
      let changed = false;
      for (const idx of empties) {
        if (comboSet.has(idx)) continue;
        const trimmed = next[idx] & ~union;
        if (trimmed !== next[idx]) {
          next[idx] = trimmed;
          changed = true;
        }
      }
      if (!changed) continue;
      const hint = firstForcedPlacement(
        board,
        next,
        technique,
        unit.kind,
        unit.idx,
        variant,
      );
      if (hint) return hint;
    }
  }
  return null;
}

function findHiddenPair(
  board: Board,
  candidates: Uint16Array,
  variant?: Variant,
): HintSuggestion | null {
  for (const unit of buildUnits(variant)) {
    const digitCells = new Map<number, CellIndex[]>();
    for (let digit = 1; digit <= 9; digit++) {
      const bit = 1 << (digit - 1);
      digitCells.set(
        digit,
        unit.cells.filter((idx) => board[idx] === 0 && (candidates[idx] & bit) !== 0),
      );
    }
    for (let a = 1; a <= 8; a++) {
      for (let b = a + 1; b <= 9; b++) {
        const cells = new Set([...(digitCells.get(a) ?? []), ...(digitCells.get(b) ?? [])]);
        if (cells.size !== 2) continue;
        const keep = (1 << (a - 1)) | (1 << (b - 1));
        const next = cloneCandidates(candidates);
        let changed = false;
        for (const idx of cells) {
          const trimmed = next[idx] & keep;
          if (trimmed !== next[idx]) {
            next[idx] = trimmed;
            changed = true;
          }
        }
        if (!changed) continue;
        const hint = firstForcedPlacement(
          board,
          next,
          "hidden-pair",
          unit.kind,
          unit.idx,
          variant,
        );
        if (hint) return hint;
      }
    }
  }
  return null;
}

function findFish(
  board: Board,
  candidates: Uint16Array,
  size: 2 | 3,
  variant?: Variant,
): HintSuggestion | null {
  const technique = size === 2 ? "x-wing" : "swordfish";
  for (let digit = 1; digit <= 9; digit++) {
    const bit = 1 << (digit - 1);
    for (const orientation of ["row", "col"] as const) {
      const bases: Array<{ idx: number; positions: number[] }> = [];
      for (let idx = 0; idx < 9; idx++) {
        const cells = orientation === "row" ? rowCells(idx) : colCells(idx);
        const positions = cells
          .filter((cell) => board[cell] === 0 && (candidates[cell] & bit) !== 0)
          .map((cell) => (orientation === "row" ? cell % 9 : Math.floor(cell / 9)));
        if (positions.length >= 2 && positions.length <= size) {
          bases.push({ idx, positions });
        }
      }
      for (const combo of combinations(bases, size)) {
        const union = new Set<number>();
        for (const base of combo) {
          for (const pos of base.positions) union.add(pos);
        }
        if (union.size !== size) continue;
        const baseSet = new Set(combo.map((base) => base.idx));
        const next = cloneCandidates(candidates);
        let changed = false;
        for (const pos of union) {
          for (let other = 0; other < 9; other++) {
            if (baseSet.has(other)) continue;
            const cell = orientation === "row" ? other * 9 + pos : pos * 9 + other;
            if (board[cell] !== 0 || (next[cell] & bit) === 0) continue;
            next[cell] &= ~bit;
            changed = true;
          }
        }
        if (!changed) continue;
        const hint = firstForcedPlacement(
          board,
          next,
          technique,
          orientation,
          combo[0].idx,
          variant,
        );
        if (hint) return hint;
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
    findPointingPair(board, candidates, v) ??
    findBoxLineReduction(board, candidates, v) ??
    findNakedSubset(board, candidates, 2, v) ??
    findNakedSubset(board, candidates, 3, v) ??
    findHiddenPair(board, candidates, v) ??
    findFish(board, candidates, 2, v) ??
    findFish(board, candidates, 3, v) ??
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
