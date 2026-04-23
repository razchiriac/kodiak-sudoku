import { describe, expect, it } from "vitest";
import { CLUE_TARGETS, augmentToClueCount, countClues } from "./augment";

// RAZ-38 — unit tests for the clue-augmentation helper.

// A 17-clue minimum puzzle paired with its full 81-digit solution.
// This is the classic Arto Inkala-style puzzle — the exact digits
// don't matter for these tests, only that the pair is internally
// consistent (clues match the solution).
const PUZZLE17 =
  "000000010400000000020000000000050407008000300001090000300400200050100000000806000";
const SOLUTION =
  "693784512487512936125963874932651487568247391741398625319475268856129743274836159";

// Deterministic RNG for reproducible assertions. `makeRng(seed)`
// returns a mulberry32-style PRNG so "random" draws in tests are
// fully predictable between runs.
function makeRng(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

describe("countClues", () => {
  it("counts non-zero digits, treating '0' and '.' as empty", () => {
    expect(countClues(PUZZLE17)).toBe(17);
    expect(countClues(SOLUTION)).toBe(81);
    expect(countClues("0".repeat(81))).toBe(0);
    expect(countClues(".".repeat(81))).toBe(0);
  });
});

describe("augmentToClueCount", () => {
  it("raises clue count to the target by revealing extra solution cells", () => {
    const augmented = augmentToClueCount(PUZZLE17, SOLUTION, 40, makeRng(1));
    expect(countClues(augmented)).toBe(40);
  });

  it("preserves existing clues untouched (no real clue is ever moved)", () => {
    const augmented = augmentToClueCount(PUZZLE17, SOLUTION, 40, makeRng(2));
    // Every non-empty position in the source must be preserved
    // (with the exact same digit) in the output. This is the
    // safety guarantee that matters: we never rewrite a real clue.
    for (let i = 0; i < 81; i++) {
      if (PUZZLE17[i] !== "0") {
        expect(augmented[i]).toBe(PUZZLE17[i]);
      }
    }
  });

  it("newly revealed cells always come from the solution", () => {
    const augmented = augmentToClueCount(PUZZLE17, SOLUTION, 40, makeRng(3));
    for (let i = 0; i < 81; i++) {
      // Anywhere the augmented puzzle has a digit that the source
      // didn't, that digit must match the solution — otherwise
      // we've invented a value.
      if (PUZZLE17[i] === "0" && augmented[i] !== "0") {
        expect(augmented[i]).toBe(SOLUTION[i]);
      }
    }
  });

  it("is idempotent when the puzzle already meets the target", () => {
    // First run raises to 40. Second run asking for 40 should
    // return the same string. Third run asking for 30 (below
    // current) should also return unchanged — we never remove
    // clues.
    const once = augmentToClueCount(PUZZLE17, SOLUTION, 40, makeRng(1));
    expect(countClues(once)).toBe(40);
    const twice = augmentToClueCount(once, SOLUTION, 40, makeRng(9));
    expect(twice).toBe(once);
    const thrice = augmentToClueCount(once, SOLUTION, 30, makeRng(9));
    expect(thrice).toBe(once);
  });

  it("rejects a puzzle whose clues disagree with the solution", () => {
    // Corrupt the first clue on purpose — an augmented puzzle
    // with an inconsistent clue/solution pair is a data bug we
    // want to surface loudly, not patch around.
    const badPuzzle = "9" + PUZZLE17.slice(1);
    expect(() => augmentToClueCount(badPuzzle, SOLUTION, 30)).toThrow(
      /disagrees with solution/,
    );
  });

  it("rejects wrong-length inputs", () => {
    expect(() => augmentToClueCount("123", SOLUTION, 30)).toThrow(
      /puzzle length/,
    );
    expect(() => augmentToClueCount(PUZZLE17, "123", 30)).toThrow(
      /solution length/,
    );
  });

  it("caps at the number of available blanks (never exceeds 81 clues)", () => {
    // Asking for 200 clues on a 17-clue puzzle should reveal all
    // 64 blanks and return the full solution, not loop forever.
    const filled = augmentToClueCount(PUZZLE17, SOLUTION, 200, makeRng(5));
    expect(filled).toBe(SOLUTION);
  });

  it("CLUE_TARGETS cover the three augment-able buckets with sane bands", () => {
    // Sanity-check the shipped constants so we catch accidental
    // edits (e.g. someone swapping min/target or picking a target
    // above the DB's clue_count check constraint max of 40).
    expect(CLUE_TARGETS[1].target).toBeLessThanOrEqual(40);
    expect(CLUE_TARGETS[1].target).toBeGreaterThan(CLUE_TARGETS[2].target);
    expect(CLUE_TARGETS[2].target).toBeGreaterThan(CLUE_TARGETS[3].target);
    for (const k of [1, 2, 3] as const) {
      expect(CLUE_TARGETS[k].target).toBeGreaterThanOrEqual(
        CLUE_TARGETS[k].min,
      );
    }
  });
});
