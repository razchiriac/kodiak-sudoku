import { describe, expect, it } from "vitest";
import { parseBoard, serializeBoard } from "./board";
import { computeCandidates, nextHint, solve } from "./solver";

const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

describe("computeCandidates", () => {
  it("returns 0 for filled cells and a non-empty mask for empty ones", () => {
    const board = parseBoard(PUZZLE);
    const c = computeCandidates(board);
    for (let i = 0; i < 81; i++) {
      if (board[i] !== 0) expect(c[i]).toBe(0);
      else expect(c[i]).toBeGreaterThan(0);
    }
  });
});

describe("nextHint", () => {
  it("finds a single placement on a typical puzzle", () => {
    const board = parseBoard(PUZZLE);
    const h = nextHint(board, { solution: SOLUTION });
    expect(h).not.toBeNull();
    if (!h) return;
    // The suggested digit must match the known solution at that index.
    expect(SOLUTION[h.index]).toBe(h.digit.toString());
  });

  it("falls back to the solution when no technique applies", () => {
    // Empty board has many candidates; naked/hidden single won't work.
    const board = new Uint8Array(81);
    const h = nextHint(board, { solution: SOLUTION });
    expect(h?.technique).toBe("from-solution");
  });

  it("returns null when there is no solution and no technique", () => {
    const board = new Uint8Array(81);
    expect(nextHint(board)).toBeNull();
  });
});

describe("solve", () => {
  it("solves a real puzzle to its known solution", () => {
    const board = parseBoard(PUZZLE);
    const solved = solve(board);
    expect(solved).not.toBeNull();
    expect(serializeBoard(solved!)).toBe(SOLUTION);
  });
});
