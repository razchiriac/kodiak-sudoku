import { describe, expect, it } from "vitest";
import {
  buildFixedMask,
  clearCellNotes,
  clearNotesOnEmptyCells,
  computeAllCandidates,
  computeMistakes,
  digitCounts,
  emptyNotes,
  hasNote,
  normalizePastedPuzzle,
  notesMatchComputedCandidates,
  parseBoard,
  peers,
  prunePeerNotes,
  serializeBoard,
  toggleNote,
} from "./board";

const SAMPLE_PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";

describe("parseBoard / serializeBoard", () => {
  it("round-trips a puzzle string", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    expect(serializeBoard(board)).toBe(SAMPLE_PUZZLE);
  });

  it("treats '.' as empty", () => {
    const board = parseBoard(SAMPLE_PUZZLE.replaceAll("0", "."));
    expect(serializeBoard(board)).toBe(SAMPLE_PUZZLE);
  });

  it("rejects wrong length", () => {
    expect(() => parseBoard("123")).toThrow();
  });
});

describe("normalizePastedPuzzle", () => {
  it("accepts a canonical 81-digit string", () => {
    const res = normalizePastedPuzzle(SAMPLE_PUZZLE);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.digits).toBe(SAMPLE_PUZZLE);
  });

  it("treats `.` as empty", () => {
    const dotted = SAMPLE_PUZZLE.replaceAll("0", ".");
    const res = normalizePastedPuzzle(dotted);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.digits).toBe(SAMPLE_PUZZLE);
  });

  it("strips whitespace, pipes, plus, and dashes", () => {
    // Simulate paste from a pretty-printed grid.
    const pretty = [
      "+---+---+---+",
      "| 5 3 . | . 7 . | . . . |",
      "| 6 . . | 1 9 5 | . . . |",
      "| . 9 8 | . . . | . 6 . |",
      "+---+---+---+",
      "| 8 . . | . 6 . | . . 3 |",
      "| 4 . . | 8 . 3 | . . 1 |",
      "| 7 . . | . 2 . | . . 6 |",
      "+---+---+---+",
      "| . 6 . | . . . | 2 8 . |",
      "| . . . | 4 1 9 | . . 5 |",
      "| . . . | . 8 . | . 7 9 |",
      "+---+---+---+",
    ].join("\n");
    const res = normalizePastedPuzzle(pretty);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.digits).toBe(SAMPLE_PUZZLE);
  });

  it("rejects too-short input with a descriptive error", () => {
    const res = normalizePastedPuzzle("1234");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/81/);
  });

  it("rejects too-long input with a descriptive error", () => {
    const res = normalizePastedPuzzle(SAMPLE_PUZZLE + "0");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/82/);
  });
});

describe("buildFixedMask", () => {
  it("marks clue cells as fixed", () => {
    const mask = buildFixedMask(SAMPLE_PUZZLE);
    expect(mask[0]).toBe(1); // '5' is a clue
    expect(mask[2]).toBe(0); // '0' is empty -> editable
    expect(mask.length).toBe(81);
  });
});

describe("peers", () => {
  it("returns 20 peers for any cell", () => {
    for (let i = 0; i < 81; i++) {
      expect(peers(i).length).toBe(20);
    }
  });

  it("never includes the cell itself", () => {
    for (let i = 0; i < 81; i++) {
      expect(peers(i)).not.toContain(i);
    }
  });

  it("includes the entire row, column, and box", () => {
    // Cell 0 (row 0, col 0, box 0) should peer with cells 1..8 (rest of row),
    // 9, 18, 27... (rest of col), and 10, 11, 19, 20 (rest of box).
    const p = new Set(peers(0));
    for (let c = 1; c < 9; c++) expect(p.has(c)).toBe(true);
    for (let r = 1; r < 9; r++) expect(p.has(r * 9)).toBe(true);
    expect(p.has(10)).toBe(true);
    expect(p.has(20)).toBe(true);
  });
});

describe("notes", () => {
  it("toggles single digits without affecting others", () => {
    let n = emptyNotes();
    n = toggleNote(n, 5, 3);
    n = toggleNote(n, 5, 7);
    expect(hasNote(n, 5, 3)).toBe(true);
    expect(hasNote(n, 5, 7)).toBe(true);
    expect(hasNote(n, 5, 1)).toBe(false);
    n = toggleNote(n, 5, 3);
    expect(hasNote(n, 5, 3)).toBe(false);
    expect(hasNote(n, 5, 7)).toBe(true);
  });

  it("clears all notes from a cell", () => {
    let n = emptyNotes();
    n = toggleNote(n, 5, 1);
    n = toggleNote(n, 5, 2);
    n = clearCellNotes(n, 5);
    expect(n[5]).toBe(0);
  });

  it("prunes a digit from all peers", () => {
    let n = emptyNotes();
    for (let i = 0; i < 81; i++) n = toggleNote(n, i, 4);
    n = prunePeerNotes(n, 0, 4);
    for (const p of peers(0)) expect(hasNote(n, p, 4)).toBe(false);
    expect(hasNote(n, 0, 4)).toBe(true); // cell itself unchanged
  });
});

describe("digitCounts", () => {
  it("counts each digit on the board", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    const counts = digitCounts(board);
    expect(counts[0]).toBe(51); // empty cells in this puzzle (30 clues)
    let total = 0;
    for (let d = 0; d <= 9; d++) total += counts[d];
    expect(total).toBe(81);
  });
});

// RAZ-15: mistake derivation. We solve the sample puzzle at test
// setup time rather than hardcoding a solution string so the test
// can't silently drift out of sync with the sample.
import { solve } from "./solver";
const SAMPLE_SOLUTION = (() => {
  const solved = solve(parseBoard(SAMPLE_PUZZLE));
  if (!solved) throw new Error("sample puzzle failed to solve");
  return serializeBoard(solved);
})();

describe("computeMistakes", () => {
  it("returns an empty set when the board matches the solution", () => {
    const board = parseBoard(SAMPLE_SOLUTION);
    const fixed = buildFixedMask(SAMPLE_PUZZLE);
    expect(computeMistakes(board, fixed, SAMPLE_SOLUTION).size).toBe(0);
  });

  it("flags a non-fixed cell whose value disagrees with the solution", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    const fixed = buildFixedMask(SAMPLE_PUZZLE);
    // Cell 2 is empty in the puzzle ('0') but should be '4' in the
    // solution. Place a deliberate wrong digit and expect it flagged.
    board[2] = 9;
    const mistakes = computeMistakes(board, fixed, SAMPLE_SOLUTION);
    expect(mistakes.has(2)).toBe(true);
    expect(mistakes.size).toBe(1);
  });

  it("never flags fixed clue cells even if they somehow disagree", () => {
    // Defensive: clues by construction match the solution, but we
    // still want the helper to skip them so a corrupted store can't
    // red-tint a clue the user can't even edit.
    const board = parseBoard(SAMPLE_PUZZLE);
    const fixed = buildFixedMask(SAMPLE_PUZZLE);
    // Cell 0 is a clue ('5'). Corrupt the solution so cell 0 expects
    // a different digit — the helper should still ignore it.
    const badSolution = "1" + SAMPLE_SOLUTION.slice(1);
    expect(computeMistakes(board, fixed, badSolution).has(0)).toBe(false);
  });

  it("never flags empty cells", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    const fixed = buildFixedMask(SAMPLE_PUZZLE);
    // The puzzle has 51 zeros; none of them should be flagged as
    // mistakes because "no value" isn't wrong.
    expect(computeMistakes(board, fixed, SAMPLE_SOLUTION).size).toBe(0);
  });

  it("returns an empty set when no solution is available (daily puzzles)", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    board[2] = 9; // would be a mistake if we had the solution
    const fixed = buildFixedMask(SAMPLE_PUZZLE);
    expect(computeMistakes(board, fixed, null).size).toBe(0);
    expect(computeMistakes(board, fixed, "").size).toBe(0);
  });
});

describe("RAZ-43 notesMatchComputedCandidates / clearNotesOnEmptyCells", () => {
  it("notesMatchComputedCandidates is true for computeAllCandidates output", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    const notes = computeAllCandidates(board);
    expect(notesMatchComputedCandidates(board, notes)).toBe(true);
  });

  it("notesMatchComputedCandidates is false when a note mask differs", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    const notes = computeAllCandidates(board);
    // Cell 2 is empty in the sample puzzle — flip one candidate bit.
    notes[2] ^= 1;
    expect(notesMatchComputedCandidates(board, notes)).toBe(false);
  });

  it("clearNotesOnEmptyCells zeros pencil marks only on empty cells", () => {
    const board = parseBoard(SAMPLE_PUZZLE);
    const notes = computeAllCandidates(board);
    const cleared = clearNotesOnEmptyCells(board, notes);
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0) expect(cleared[i]).toBe(0);
    }
  });
});
