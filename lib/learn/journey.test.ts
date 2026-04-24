// RAZ-47 — Tests for the lesson evaluator, the test-time simulator,
// and the lesson catalog itself.
//
// Why all three live in one file:
//   - The evaluator and the simulator are siblings in `journey.ts`
//     and share the same Board/Lesson types; testing them together
//     keeps the imports tight.
//   - The "every lesson is solvable with the named technique" check
//     is the most important sanity gate in the whole feature. It
//     belongs next to the simulator that powers it so a content
//     author who breaks a lesson sees the failure in the same file.
//
// What we test:
//   1. evaluateLessonAttempt — covers the three return shapes
//      ("in-progress", "mistake", "passed") and edge cases like
//      empty boards, fully-solved boards, and mistakes that occur
//      after empties (mistake takes priority).
//   2. lessonPuzzleToBoard / lessonFixedMask — basic round-trip
//      sanity. These are tiny but the player UI relies on them so
//      a regression here means clue cells become editable, which
//      is the worst class of bug for this feature.
//   3. simulateLessonSolve — runs the project's own next-hint
//      solver against every lesson and asserts it converges, AND
//      that every step uses the lesson's named technique (or a
//      strictly easier one). A "mixed" lesson is allowed to use
//      both naked + hidden singles. No lesson is ever allowed to
//      fall back to "from-solution" — that would mean the puzzle
//      requires a technique we haven't taught.

import { describe, expect, it } from "vitest";
import {
  evaluateLessonAttempt,
  lessonFixedMask,
  lessonPuzzleToBoard,
  simulateLessonSolve,
} from "./journey";
import { LESSONS, getLessonById, type Lesson } from "./lessons";
import type { HintTechnique } from "../sudoku/solver";

// Tiny helper: turn an 81-char string into a Uint8Array board. Used
// by the evaluator tests to construct "player attempts" without
// going through the puzzle/clue mask machinery.
function boardFromString(s: string): Uint8Array {
  const b = new Uint8Array(81);
  for (let i = 0; i < 81; i++) {
    const ch = s[i];
    b[i] = ch === "0" || ch === "." ? 0 : ch.charCodeAt(0) - 48;
  }
  return b;
}

describe("lessonPuzzleToBoard", () => {
  it("turns digit characters into 1..9 and treats '0' / '.' as empty", () => {
    const puzzle = "1".repeat(40) + "0" + "." + "9".repeat(39);
    const board = lessonPuzzleToBoard(puzzle);
    expect(board.length).toBe(81);
    expect(board[0]).toBe(1);
    expect(board[39]).toBe(1);
    // index 40 was '0', index 41 was '.' — both empty
    expect(board[40]).toBe(0);
    expect(board[41]).toBe(0);
    expect(board[42]).toBe(9);
    expect(board[80]).toBe(9);
  });

  it("returns a Uint8Array (player UI assumes Uint8 indexing semantics)", () => {
    const board = lessonPuzzleToBoard("0".repeat(81));
    expect(board).toBeInstanceOf(Uint8Array);
  });
});

describe("lessonFixedMask", () => {
  it("marks clue cells with 1 and empty cells with 0", () => {
    // Two clues, the rest empty — easy to eyeball the mask.
    const puzzle = "5" + "0".repeat(79) + "9";
    const mask = lessonFixedMask(puzzle);
    expect(mask[0]).toBe(1);
    expect(mask[1]).toBe(0);
    expect(mask[80]).toBe(1);
    // Every other cell is empty → mask is 0.
    for (let i = 1; i < 80; i++) expect(mask[i]).toBe(0);
  });

  it("treats '.' as an empty cell, same as '0'", () => {
    const mask = lessonFixedMask(".0" + "1".repeat(79));
    expect(mask[0]).toBe(0);
    expect(mask[1]).toBe(0);
    expect(mask[2]).toBe(1);
  });
});

describe("evaluateLessonAttempt", () => {
  // Build a synthetic lesson on the fly so these tests don't depend
  // on the catalog's specific contents (which can change).
  const lesson: Lesson = {
    id: "test-only-lesson",
    title: "Test Lesson",
    tagline: "for unit tests",
    technique: "naked-single",
    difficultyBucket: 1,
    intro: "n/a",
    puzzle: "0".repeat(81),
    solution:
      "534678912" +
      "672195348" +
      "198342567" +
      "859761423" +
      "426853791" +
      "713924856" +
      "961537284" +
      "287419635" +
      "345286179",
  };

  it("returns 'in-progress' with the correct empties remaining for a partially filled board", () => {
    // Empty board → 81 empties remaining.
    const board = boardFromString("0".repeat(81));
    const status = evaluateLessonAttempt(lesson, board);
    expect(status.kind).toBe("in-progress");
    if (status.kind === "in-progress") {
      expect(status.emptiesRemaining).toBe(81);
    }
  });

  it("returns 'in-progress' with the right count when most cells are filled correctly", () => {
    // Fill the first 80 cells from the solution, leave one empty.
    const partial = lesson.solution.slice(0, 80) + "0";
    const status = evaluateLessonAttempt(lesson, boardFromString(partial));
    expect(status.kind).toBe("in-progress");
    if (status.kind === "in-progress") {
      expect(status.emptiesRemaining).toBe(1);
    }
  });

  it("returns 'passed' when the board exactly matches the solution", () => {
    const status = evaluateLessonAttempt(
      lesson,
      boardFromString(lesson.solution),
    );
    expect(status.kind).toBe("passed");
  });

  it("returns 'mistake' with the first wrong index when the player places a wrong digit", () => {
    // Put a wrong digit in cell 5; rest matches the solution.
    const wrong = lesson.solution.split("");
    // cell 5 in the solution is '8' — flip it to '1' (which is wrong
    // by row, so the evaluator should flag it).
    wrong[5] = "1";
    const status = evaluateLessonAttempt(lesson, boardFromString(wrong.join("")));
    expect(status.kind).toBe("mistake");
    if (status.kind === "mistake") {
      expect(status.firstWrongIndex).toBe(5);
      expect(status.expected).toBe(8);
      expect(status.placed).toBe(1);
    }
  });

  it("prioritizes a mistake over remaining empties (UX: fix the wrong cell first)", () => {
    // Put a wrong digit AND leave a later cell empty. The evaluator
    // should still surface the mistake, not say 'in-progress'.
    const chars = lesson.solution.split("");
    chars[3] = "9"; // wrong (real digit at 3 is '6')
    chars[80] = "0"; // empty (solution had '9' there)
    const status = evaluateLessonAttempt(lesson, boardFromString(chars.join("")));
    expect(status.kind).toBe("mistake");
    if (status.kind === "mistake") {
      expect(status.firstWrongIndex).toBe(3);
    }
  });

  it("throws on a mis-sized board (defensive — UI should never construct one, but worth catching loudly)", () => {
    const tooSmall = new Uint8Array(80);
    expect(() => evaluateLessonAttempt(lesson, tooSmall)).toThrow(/length 81/);
  });
});

describe("getLessonById", () => {
  it("returns the lesson when the id exists", () => {
    const first = LESSONS[0];
    if (!first) throw new Error("expected at least one lesson in the catalog");
    expect(getLessonById(first.id)?.id).toBe(first.id);
  });

  it("returns undefined for an unknown id (so the route can clean-404)", () => {
    expect(getLessonById("definitely-not-a-real-lesson-id")).toBeUndefined();
  });
});

describe("LESSONS catalog sanity", () => {
  // These tests are the load-bearing safety net: they run against
  // EVERY lesson, so a typo in the puzzle/solution or a lesson that
  // requires a more advanced technique than its label claims will
  // fail CI loudly before the bad content reaches a player.

  it("every lesson has a valid 81-char puzzle and 81-char solution", () => {
    for (const lesson of LESSONS) {
      expect(
        lesson.puzzle.length,
        `lesson "${lesson.id}" puzzle length`,
      ).toBe(81);
      expect(
        lesson.solution.length,
        `lesson "${lesson.id}" solution length`,
      ).toBe(81);
      // Every solution character is 1..9 (no zeros, no dots).
      for (let i = 0; i < 81; i++) {
        const ch = lesson.solution.charCodeAt(i) - 48;
        expect(
          ch >= 1 && ch <= 9,
          `lesson "${lesson.id}" solution[${i}] must be 1..9, got "${lesson.solution[i]}"`,
        ).toBe(true);
      }
      // Every clue in the puzzle agrees with the solution at that
      // index. A clue that disagrees with the solution is the worst
      // class of authoring bug (lesson is unsolvable, player gets
      // stuck).
      for (let i = 0; i < 81; i++) {
        const p = lesson.puzzle[i];
        if (p !== "0" && p !== ".") {
          expect(
            p,
            `lesson "${lesson.id}" puzzle[${i}] must match solution[${i}]`,
          ).toBe(lesson.solution[i]);
        }
      }
    }
  });

  it("every lesson has at least one empty cell (otherwise nothing to teach)", () => {
    for (const lesson of LESSONS) {
      const empties = [...lesson.puzzle].filter(
        (ch) => ch === "0" || ch === ".",
      ).length;
      expect(empties, `lesson "${lesson.id}" empties`).toBeGreaterThan(0);
    }
  });

  it("lesson ids are unique (ids double as localStorage keys)", () => {
    const ids = LESSONS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps the singles-tier lessons in the intended unlock order", () => {
    // RAZ-84: the journey map renders the catalog in array order, so
    // this is a content contract, not just a style preference. The
    // player should learn naked singles first, then hidden singles,
    // then a mixed checkpoint that asks them to choose between both.
    expect(LESSONS.map((l) => l.id)).toEqual([
      "naked-single-intro",
      "naked-single-practice",
      "hidden-single-intro",
      "hidden-single-practice",
      "singles-mixed-practice",
      "pointing-pair-intro",
      "box-line-reduction-intro",
      "intersections-mixed-practice",
      "naked-pair-intro",
      "naked-triple-intro",
      "hidden-pair-intro",
      "subset-mixed-practice",
      "x-wing-intro",
      "swordfish-intro",
      "capstone-mixed-practice",
    ]);
  });

  it("simulator solves every lesson without ever falling back to 'from-solution'", () => {
    // The "from-solution" technique means the solver couldn't find a
    // naked or hidden single, so it just looked up the answer. That's
    // fine for the in-app hint button (always-helpful UX) but it is
    // NEVER acceptable for a lesson, because the lesson is supposed
    // to teach the technique it uses.
    for (const lesson of LESSONS) {
      const result = simulateLessonSolve(lesson);
      expect(
        result.solved,
        `lesson "${lesson.id}" must converge using its named technique`,
      ).toBe(true);
      for (const step of result.steps) {
        expect(
          step.technique,
          `lesson "${lesson.id}" step at index ${step.index} fell back to from-solution; the puzzle requires a technique the lesson doesn't teach`,
        ).not.toBe("from-solution");
      }
    }
  });

  it("a 'naked-single' lesson is solvable using only naked-single steps", () => {
    // Strictly stricter than the previous test: for lessons explicitly
    // labelled 'naked-single', NO step is allowed to use hidden-single
    // either. (Hidden-single is harder; if a naked-single lesson needs
    // it, the lesson is mislabelled.)
    for (const lesson of LESSONS) {
      if (lesson.technique !== "naked-single") continue;
      const result = simulateLessonSolve(lesson);
      for (const step of result.steps) {
        expect(
          step.technique,
          `lesson "${lesson.id}" is labelled naked-single but step at index ${step.index} required ${step.technique}`,
        ).toBe("naked-single");
      }
    }
  });

  it("a 'hidden-single' lesson starts with a hidden-single step", () => {
    // This is the RAZ-84 safety net. Hidden-single boards need decoy
    // empties; otherwise the first move silently becomes a naked
    // single and the lesson teaches the wrong habit. Later steps may
    // become naked singles as the board opens up — that is fine.
    for (const lesson of LESSONS) {
      if (lesson.technique !== "hidden-single") continue;
      const result = simulateLessonSolve(lesson);
      expect(result.steps[0]?.technique, `lesson "${lesson.id}" first step`).toBe(
        "hidden-single",
      );
    }
  });

  it("single-technique lessons start with their named deterministic technique", () => {
    // These lessons are curated so the opening move demonstrates the
    // named pattern immediately. X-Wing and Swordfish are advanced
    // practice boards from public strategy examples; those remain
    // solved without fallback but are not first-move contracts because
    // simpler cleanup may appear before the fish pattern is useful.
    const expectedFirstTechniqueById = new Map([
      ["pointing-pair-intro", "pointing-pair"],
      ["box-line-reduction-intro", "box-line-reduction"],
      ["naked-pair-intro", "naked-pair"],
      ["naked-triple-intro", "naked-triple"],
      ["hidden-pair-intro", "hidden-pair"],
    ]);
    for (const lesson of LESSONS) {
      const expected = expectedFirstTechniqueById.get(lesson.id);
      if (!expected) continue;
      const result = simulateLessonSolve(lesson);
      expect(result.steps[0]?.technique, `lesson "${lesson.id}" first step`).toBe(
        expected,
      );
    }
  });

  it("mixed lessons use their required technique mix", () => {
    // A mixed lesson should be more than a relabelled practice board:
    // it must make the player switch between the strategies its title
    // promises.
    const expectedById = new Map<string, HintTechnique[]>([
      ["singles-mixed-practice", ["naked-single", "hidden-single"]],
      [
        "intersections-mixed-practice",
        ["pointing-pair", "box-line-reduction"],
      ],
      [
        "subset-mixed-practice",
        ["naked-pair", "naked-triple", "hidden-pair"],
      ],
      [
        "capstone-mixed-practice",
        ["pointing-pair", "naked-pair", "hidden-pair"],
      ],
    ]);
    for (const lesson of LESSONS) {
      if (lesson.technique !== "mixed") continue;
      const result = simulateLessonSolve(lesson);
      const techniques = new Set(result.steps.map((s) => s.technique));
      const expected = expectedById.get(lesson.id);
      if (!expected) throw new Error(`missing expected mix for ${lesson.id}`);
      for (const technique of expected) {
        expect(
          techniques.has(technique),
          `lesson "${lesson.id}" includes ${technique}`,
        ).toBe(true);
      }
    }
  });
});
