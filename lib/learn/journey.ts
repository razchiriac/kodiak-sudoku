import type { Lesson } from "./lessons";
import type { Board } from "../sudoku/board";
import { computeCandidates, nextHint, type HintTechnique } from "../sudoku/solver";

// RAZ-47 — Deterministic lesson evaluator.
//
// Two responsibilities live here:
//
//   1. `evaluateLessonAttempt` — given a lesson and the player's
//      current board, decide whether they've passed, are still
//      working, or have placed a wrong digit. The route handler /
//      player UI calls this on every move; nothing else does.
//
//   2. `simulateLessonSolve` — used by the unit tests to guarantee
//      that every lesson in the catalog can be solved purely with
//      the named technique (or a strictly easier one). Runs the
//      project's own next-hint solver in a loop and asserts the
//      board converges. Catches authoring errors at test time so
//      a content typo can't sneak into prod and trap a player on
//      an unsolvable lesson.
//
// Keeping both helpers in one file (and free of any React import)
// means the journey logic can be unit-tested without spinning up
// a renderer.

export type LessonStatus =
  | { kind: "in-progress"; emptiesRemaining: number }
  | { kind: "mistake"; firstWrongIndex: number; expected: number; placed: number }
  | { kind: "passed" };

// Convert the lesson's puzzle string into a Uint8Array — same shape
// as `Board` from `lib/sudoku/board`. Exported because the player
// UI wants the same conversion (it doesn't talk to the game store).
export function lessonPuzzleToBoard(puzzle: string): Uint8Array {
  const board = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = puzzle[i];
    // '.' is accepted as a synonym for '0' so authors can paste
    // boards from common Sudoku notations without sed-ing first.
    if (ch === "0" || ch === "." || ch === undefined) {
      board[i] = 0;
    } else {
      board[i] = ch.charCodeAt(0) - 48;
    }
  }
  return board;
}

// Return a Uint8Array marking which cells are CLUES (1) vs editable
// (0). The lesson player passes this to the Cell component so the
// player can't overwrite a clue (same contract as the main game
// store's `fixed` field).
export function lessonFixedMask(puzzle: string): Uint8Array {
  const fixed = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = puzzle[i];
    fixed[i] = ch !== "0" && ch !== "." && ch !== undefined ? 1 : 0;
  }
  return fixed;
}

// Pure evaluator. The "first wrong index" semantics matter for the
// player UX: we surface a single concrete cell to point at rather
// than a vague "you have mistakes" alert.
export function evaluateLessonAttempt(
  lesson: Lesson,
  board: Uint8Array,
): LessonStatus {
  if (board.length !== 81) {
    throw new Error(
      `evaluateLessonAttempt: board must be length 81, got ${board.length}`,
    );
  }
  if (lesson.solution.length !== 81) {
    throw new Error(
      `evaluateLessonAttempt: lesson "${lesson.id}" solution must be length 81`,
    );
  }
  let empties = 0;
  let firstWrong: { index: number; expected: number; placed: number } | null =
    null;
  for (let i = 0; i < 81; i++) {
    const placed = board[i];
    if (placed === 0) {
      empties++;
      continue;
    }
    const expected = lesson.solution.charCodeAt(i) - 48;
    if (placed !== expected && firstWrong === null) {
      firstWrong = { index: i, expected, placed };
    }
  }
  // Mistake takes priority over "still working" — even if there are
  // empties left, we want the player to fix the wrong cell first
  // rather than dig deeper into a broken board.
  if (firstWrong !== null) {
    return {
      kind: "mistake",
      firstWrongIndex: firstWrong.index,
      expected: firstWrong.expected,
      placed: firstWrong.placed,
    };
  }
  if (empties === 0) return { kind: "passed" };
  return { kind: "in-progress", emptiesRemaining: empties };
}

// Test-time simulation: run the solver loop on a lesson's puzzle
// and confirm it converges (using only naked / hidden single +
// from-solution fallback). If the puzzle requires a technique we
// haven't taught yet, the solver still finds the placement via the
// solution-string fallback — which is fine for runtime gameplay
// (a hint always helps) but is the wrong thing to ship as a lesson
// purporting to teach naked singles. The test in journey.test.ts
// asserts the technique mix per lesson, not just convergence.
export type SimulateResult = {
  solved: boolean;
  steps: Array<{
    index: number;
    digit: number;
    technique: HintTechnique;
  }>;
};

export function simulateLessonSolve(lesson: Lesson): SimulateResult {
  const board: Board = lessonPuzzleToBoard(lesson.puzzle);
  const steps: SimulateResult["steps"] = [];
  // 81 is a hard cap — we can't take more steps than there are
  // cells to fill. The loop guard is just belt-and-braces against
  // a solver bug that returns the same hint twice.
  for (let safetyTick = 0; safetyTick < 81; safetyTick++) {
    // Fast empty check: scan the board once. Done = no zeros.
    let anyEmpty = false;
    for (let i = 0; i < 81; i++) {
      if (board[i] === 0) {
        anyEmpty = true;
        break;
      }
    }
    if (!anyEmpty) return { solved: true, steps };

    const hint = nextHint(board, { solution: lesson.solution });
    if (!hint) return { solved: false, steps };
    board[hint.index] = hint.digit;
    steps.push({
      index: hint.index,
      digit: hint.digit,
      technique: hint.technique,
    });
  }
  return { solved: false, steps };
}

// Tiny convenience: re-export computeCandidates for the player UI
// so it can render auto-notes if we choose to ever surface them
// inside a lesson. Keeps the player from importing from the
// solver module directly (one module to mock in tests).
export { computeCandidates };
