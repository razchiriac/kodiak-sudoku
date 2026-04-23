import { describe, expect, it } from "vitest";
import { isValidPuzzleString } from "./puzzle-doc";

// RAZ-9 — Smoke tests for the PDF route's input guard. The visual
// doc renderer itself isn't worth unit-testing (it's a thin
// declarative wrapper around @react-pdf/renderer primitives), but
// the string validator runs on every request and rejecting bad
// input early is what keeps the handler from throwing deep inside
// the renderer.

describe("isValidPuzzleString", () => {
  it("accepts a canonical 81-char puzzle string (0 for empties)", () => {
    const s =
      "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
    expect(s.length).toBe(81);
    expect(isValidPuzzleString(s)).toBe(true);
  });

  it("accepts dots as empty markers", () => {
    const s =
      "53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79";
    expect(s.length).toBe(81);
    expect(isValidPuzzleString(s)).toBe(true);
  });

  it("rejects wrong length", () => {
    expect(isValidPuzzleString("123")).toBe(false);
    expect(isValidPuzzleString("0".repeat(80))).toBe(false);
    expect(isValidPuzzleString("0".repeat(82))).toBe(false);
  });

  it("rejects unexpected characters even at the right length", () => {
    const s = "0".repeat(80) + "A";
    expect(isValidPuzzleString(s)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isValidPuzzleString(123 as unknown as string)).toBe(false);
    expect(isValidPuzzleString(null as unknown as string)).toBe(false);
  });
});
