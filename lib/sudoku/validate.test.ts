import { describe, expect, it } from "vitest";
import { parseBoard } from "./board";
import { findConflicts, isComplete, isCorrect, isFilled, isLegalPlacement } from "./validate";

const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

describe("findConflicts", () => {
  it("returns empty set on a fresh puzzle (clues are conflict-free)", () => {
    const board = parseBoard(PUZZLE);
    expect(findConflicts(board).size).toBe(0);
  });

  it("flags duplicates in the same row", () => {
    const board = parseBoard(PUZZLE);
    board[2] = 5; // same row as the '5' at index 0
    const c = findConflicts(board);
    expect(c.has(0)).toBe(true);
    expect(c.has(2)).toBe(true);
  });

  it("flags duplicates in the same box", () => {
    const board = parseBoard(PUZZLE);
    board[10] = 5; // index 10 is in box 0 with the '5' at index 0
    const c = findConflicts(board);
    expect(c.has(0)).toBe(true);
    expect(c.has(10)).toBe(true);
  });
});

describe("isFilled / isComplete / isCorrect", () => {
  it("the full solution is complete and correct", () => {
    const board = parseBoard(SOLUTION);
    expect(isFilled(board)).toBe(true);
    expect(isComplete(board)).toBe(true);
    expect(isCorrect(board, SOLUTION)).toBe(true);
  });

  it("a filled-but-wrong board is not complete", () => {
    const board = parseBoard(SOLUTION);
    board[0] = board[0] === 1 ? 2 : 1; // introduce a conflict
    expect(isFilled(board)).toBe(true);
    expect(isComplete(board)).toBe(false);
    expect(isCorrect(board, SOLUTION)).toBe(false);
  });

  it("an unfilled board is not complete", () => {
    expect(isComplete(parseBoard(PUZZLE))).toBe(false);
  });
});

describe("isLegalPlacement", () => {
  it("rejects a digit already in the row", () => {
    const board = parseBoard(PUZZLE);
    expect(isLegalPlacement(board, 1, 5)).toBe(false); // 5 at index 0
  });
  it("accepts a digit not in any peer", () => {
    const board = parseBoard(PUZZLE);
    expect(isLegalPlacement(board, 2, 1)).toBe(true);
  });
});
