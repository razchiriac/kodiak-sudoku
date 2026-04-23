import { describe, it, expect } from "vitest";
import { peers, isMainDiag, isAntiDiag } from "./board";
import { findConflicts, isLegalPlacement, isComplete } from "./validate";
import { solve, computeCandidates } from "./solver";
import { parseBoard } from "./board";

// RAZ-18 — Tests for diagonal variant support. These verify that
// the peer graph, validation, and solver correctly handle the two
// extra diagonal constraint units.

describe("diagonal peer graph", () => {
  it("center cell (40) has extra diagonal peers", () => {
    const standard = peers(40);
    const diagonal = peers(40, "diagonal");
    // Cell 40 (row 4, col 4) is on BOTH diagonals, so the diagonal
    // variant should add peers from both.
    expect(diagonal.length).toBeGreaterThan(standard.length);
  });

  it("corner cell (0) gains 8 main-diagonal peers", () => {
    const standard = new Set(peers(0));
    const diagonal = new Set(peers(0, "diagonal"));
    // Cell 0 is on the main diagonal. It should gain peers at
    // (1,1), (2,2), ..., (8,8) = indices 10, 20, 30, 40, 50, 60, 70, 80.
    // Some of those might already be peers via row/col/box.
    const mainDiag = [10, 20, 30, 40, 50, 60, 70, 80];
    for (const d of mainDiag) {
      expect(diagonal.has(d)).toBe(true);
    }
    // Cell 0 is NOT on the anti-diagonal, so peers at anti-diag
    // positions that aren't standard peers shouldn't be added.
    // e.g. cell 72 (row 8, col 0) — same column, already a peer.
    // cell 8 (row 0, col 8) — same row, already a peer.
    // But cell 16 (row 1, col 7) on the anti-diag should NOT be
    // a diagonal peer of cell 0.
    expect(diagonal.has(16)).toBe(standard.has(16));
  });

  it("off-diagonal cell has no extra peers", () => {
    // Cell 1 (row 0, col 1) is on neither diagonal.
    const standard = peers(1);
    const diagonal = peers(1, "diagonal");
    expect(diagonal.length).toBe(standard.length);
  });
});

describe("isMainDiag / isAntiDiag", () => {
  it("correctly identifies main diagonal cells", () => {
    expect(isMainDiag(0)).toBe(true);   // (0,0)
    expect(isMainDiag(10)).toBe(true);  // (1,1)
    expect(isMainDiag(40)).toBe(true);  // (4,4) center
    expect(isMainDiag(80)).toBe(true);  // (8,8)
    expect(isMainDiag(1)).toBe(false);  // (0,1)
  });

  it("correctly identifies anti-diagonal cells", () => {
    expect(isAntiDiag(8)).toBe(true);   // (0,8)
    expect(isAntiDiag(16)).toBe(true);  // (1,7)
    expect(isAntiDiag(40)).toBe(true);  // (4,4) center
    expect(isAntiDiag(72)).toBe(true);  // (8,0)
    expect(isAntiDiag(0)).toBe(false);  // (0,0)
  });
});

describe("diagonal variant validation", () => {
  it("detects diagonal conflicts", () => {
    // Place the same digit on two main-diagonal cells that are NOT
    // in the same row, col, or box in standard sudoku.
    const board = new Uint8Array(81);
    board[0] = 5;  // (0,0) — main diagonal
    board[30] = 5; // (3,3) — main diagonal, different box
    // Standard: these are NOT peers (different row, col, box).
    const standardConflicts = findConflicts(board);
    expect(standardConflicts.size).toBe(0);
    // Diagonal: they ARE peers via the main diagonal.
    const diagonalConflicts = findConflicts(board, "diagonal");
    expect(diagonalConflicts.size).toBe(2);
    expect(diagonalConflicts.has(0)).toBe(true);
    expect(diagonalConflicts.has(30)).toBe(true);
  });

  it("isLegalPlacement respects diagonal constraint", () => {
    const board = new Uint8Array(81);
    board[0] = 5; // (0,0) main diagonal
    // Standard: placing 5 at (3,3) = index 30 is fine (different row/col/box).
    expect(isLegalPlacement(board, 30, 5)).toBe(true);
    // Diagonal: placing 5 at (3,3) = index 30 is illegal (same main diag).
    expect(isLegalPlacement(board, 30, 5, "diagonal")).toBe(false);
  });
});

describe("diagonal solver", () => {
  it("computeCandidates eliminates diagonal peers", () => {
    const board = new Uint8Array(81);
    board[0] = 5; // (0,0) main diagonal
    const standardCands = computeCandidates(board);
    const diagCands = computeCandidates(board, "diagonal");
    // Cell 30 = (3,3) is on the main diagonal. Standard: 5 is a
    // candidate. Diagonal: 5 should be eliminated.
    const bit5 = 1 << 4; // digit 5 → bit 4
    expect((standardCands[30] & bit5) !== 0).toBe(true);
    expect((diagCands[30] & bit5) !== 0).toBe(false);
  });

  it("solves a standard puzzle in both modes", () => {
    // A known standard puzzle. Both standard and diagonal solve should
    // find a solution (because if the original solution happens to
    // satisfy diagonal constraints, great; if not, the solver will
    // find a different one or null for diagonal).
    const puzzle = parseBoard(
      "530070000600195000098000060800060003400803001700020006060000280000419005000080079",
    );
    const stdSol = solve(puzzle);
    expect(stdSol).not.toBeNull();
    // Diagonal solve might or might not find a solution for this
    // specific puzzle — we just check it doesn't crash.
    const diagSol = solve(puzzle, "diagonal");
    // The result can be null or a valid board; both are acceptable.
    if (diagSol) {
      expect(isComplete(diagSol, "diagonal")).toBe(true);
    }
  });
});
