// Core board types and helpers for the Sudoku engine.
// Everything here is framework-free pure TypeScript so it can be unit
// tested in isolation and reused on the server when verifying completions.

// Sudoku digit. 0 means "empty cell". We use number (not a union) at runtime
// because storing in Uint8Array makes per-keystroke work allocation-free.
export type Digit = number;

// Cell index from 0 to 80, row-major (index = row * 9 + col).
export type CellIndex = number;

// Board is a fixed-length Uint8Array of 81 digits.
export type Board = Uint8Array;

// Notes (pencil marks) are stored as a Uint16Array of 81 bitmasks.
// Bit (d-1) is set iff digit d (1..9) is a candidate in that cell.
// Using a typed array gives O(1) toggling and trivial cloning for history.
export type Notes = Uint16Array;

// 1 = clue (immutable), 0 = editable. Same shape as Board.
export type FixedMask = Uint8Array;

export const BOARD_SIZE = 81;
export const GRID_DIM = 9;
export const BOX_DIM = 3;

// Build the static peer table once at module load. peers[i] is the set of
// cell indices that share a row, column, or 3x3 box with cell i (excluding
// i itself). Conflict detection becomes a simple lookup.
const PEERS: ReadonlyArray<ReadonlyArray<CellIndex>> = (() => {
  const result: CellIndex[][] = [];
  for (let i = 0; i < BOARD_SIZE; i++) {
    const row = Math.floor(i / GRID_DIM);
    const col = i % GRID_DIM;
    const boxRow = Math.floor(row / BOX_DIM) * BOX_DIM;
    const boxCol = Math.floor(col / BOX_DIM) * BOX_DIM;
    const set = new Set<CellIndex>();
    for (let c = 0; c < GRID_DIM; c++) set.add(row * GRID_DIM + c);
    for (let r = 0; r < GRID_DIM; r++) set.add(r * GRID_DIM + col);
    for (let r = boxRow; r < boxRow + BOX_DIM; r++) {
      for (let c = boxCol; c < boxCol + BOX_DIM; c++) {
        set.add(r * GRID_DIM + c);
      }
    }
    set.delete(i);
    result.push([...set]);
  }
  return result;
})();

// Returns the static peer set for a cell. Cheap O(1) array access; do not
// mutate the returned array.
export function peers(index: CellIndex): ReadonlyArray<CellIndex> {
  return PEERS[index];
}

export function rowOf(index: CellIndex): number {
  return Math.floor(index / GRID_DIM);
}

export function colOf(index: CellIndex): number {
  return index % GRID_DIM;
}

export function boxOf(index: CellIndex): number {
  return Math.floor(rowOf(index) / BOX_DIM) * BOX_DIM + Math.floor(colOf(index) / BOX_DIM);
}

// Parse the canonical 81-character puzzle string used in the Kaggle dataset
// and our DB. Accepts both `0` and `.` as empty markers so we are tolerant
// of either source format.
export function parseBoard(str: string): Board {
  if (str.length !== BOARD_SIZE) {
    throw new Error(`Board string must be ${BOARD_SIZE} chars, got ${str.length}`);
  }
  const out = new Uint8Array(BOARD_SIZE);
  for (let i = 0; i < BOARD_SIZE; i++) {
    const ch = str[i];
    if (ch === "." || ch === "0") {
      out[i] = 0;
    } else {
      const n = ch.charCodeAt(0) - 48; // '0' is 48
      if (n < 1 || n > 9) throw new Error(`Invalid digit '${ch}' at index ${i}`);
      out[i] = n;
    }
  }
  return out;
}

// Serialize a board back to an 81-char string. Empty cells become "0" so
// the output round-trips through DB columns of type CHAR(81).
export function serializeBoard(board: Board): string {
  let s = "";
  for (let i = 0; i < BOARD_SIZE; i++) s += board[i].toString();
  return s;
}

// Build a fixed mask from the original puzzle string. Cells that contain a
// clue are immutable; players can never overwrite or erase them.
export function buildFixedMask(puzzle: string): FixedMask {
  const board = parseBoard(puzzle);
  const mask = new Uint8Array(BOARD_SIZE);
  for (let i = 0; i < BOARD_SIZE; i++) mask[i] = board[i] === 0 ? 0 : 1;
  return mask;
}

// Make an empty notes buffer.
export function emptyNotes(): Notes {
  return new Uint16Array(BOARD_SIZE);
}

// Toggle a single candidate digit at a cell. Returns a new Notes buffer so
// callers can store the previous value in undo history.
export function toggleNote(notes: Notes, index: CellIndex, digit: Digit): Notes {
  if (digit < 1 || digit > 9) return notes;
  const next = new Uint16Array(notes);
  next[index] ^= 1 << (digit - 1);
  return next;
}

// Clear all notes from a single cell. Used when the player places a value:
// the manual notes for that cell no longer make sense.
export function clearCellNotes(notes: Notes, index: CellIndex): Notes {
  if (notes[index] === 0) return notes;
  const next = new Uint16Array(notes);
  next[index] = 0;
  return next;
}

// Auto-prune notes in a cell's peers when a value is placed. This is the
// "smart notes" behavior; callers should only invoke it when the user has
// the setting enabled.
export function prunePeerNotes(notes: Notes, index: CellIndex, digit: Digit): Notes {
  if (digit < 1 || digit > 9) return notes;
  const bit = 1 << (digit - 1);
  const next = new Uint16Array(notes);
  for (const p of peers(index)) next[p] &= ~bit;
  return next;
}

// Returns true if `digit` is currently set as a candidate in `notes[index]`.
export function hasNote(notes: Notes, index: CellIndex, digit: Digit): boolean {
  if (digit < 1 || digit > 9) return false;
  return (notes[index] & (1 << (digit - 1))) !== 0;
}

// Count remaining occurrences of each digit (1..9) on the board. Used by
// the number pad to show which digits still need to be placed and to
// disable digits that have all 9 already placed.
export function digitCounts(board: Board): number[] {
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < BOARD_SIZE; i++) counts[board[i]]++;
  return counts;
}

// RAZ-15: derive the set of indices whose current value disagrees with
// the puzzle solution. A "mistake" is any non-fixed cell that has a
// value AND the value doesn't match the corresponding character of the
// solution string. Returns an empty set when `solution` is null/empty
// so callers can unconditionally call this helper even when the
// solution isn't available (e.g. daily puzzles). Pure and
// framework-free so it's trivially unit-testable.
//
// The solution is expected as an 81-char string of '1'..'9'. We decode
// each char as a digit via charCodeAt - 48 rather than parseInt for
// speed — this runs on every board mutation while mistake highlighting
// is on, and the hot path should stay allocation-free.
export function computeMistakes(
  board: Board,
  fixed: FixedMask,
  solution: string | null,
): Set<CellIndex> {
  const out = new Set<CellIndex>();
  if (!solution || solution.length < BOARD_SIZE) return out;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (fixed[i]) continue; // clues can't be "wrong"
    const v = board[i];
    if (v === 0) continue; // empty cells are neither right nor wrong
    const expected = solution.charCodeAt(i) - 48;
    if (v !== expected) out.add(i);
  }
  return out;
}

// Compute the full set of legal candidate digits for every empty cell.
// For each empty cell, we start with all nine bits set and turn off any
// digit that already appears in the cell's row, column, or 3x3 box.
// Filled cells get a zero mask (no notes).
//
// This powers the "auto-notes" action: one tap and the player gets a
// freshly-correct pencil-mark grid to start narrowing down. We always
// return a brand new Uint16Array so the caller can pass the previous
// notes buffer to the history stack without aliasing.
export function computeAllCandidates(board: Board): Notes {
  const notes = new Uint16Array(BOARD_SIZE);
  // 0b1_1111_1111 = bits 0..8 set, i.e. digits 1..9 are all candidates.
  const ALL = 0b1_1111_1111;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (board[i] !== 0) continue;
    let mask = ALL;
    for (const p of peers(i)) {
      const v = board[p];
      if (v !== 0) mask &= ~(1 << (v - 1));
    }
    notes[i] = mask;
  }
  return notes;
}
