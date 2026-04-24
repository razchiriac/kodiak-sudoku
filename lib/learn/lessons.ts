// RAZ-47 — Static lesson catalog for the Technique Journey.
//
// Each lesson is a self-contained learning moment:
//   - title + technique label for the journey map and lesson header,
//   - intro markdown that teaches the technique in plain language,
//   - puzzle: an 81-character board string ('0' = empty, '1'..'9' = clue),
//   - solution: the 81-character solved board the player must converge on.
//
// The "checkpoint" the rollout calls out is implicit in the data: a
// lesson is passed when every cell in the puzzle either matches its
// clue (which is enforced by the player UI — clue cells are read-only)
// or matches the solution. The validator in `journey.ts` is the single
// source of truth for that — keep it dumb so the content here can be
// authored and reviewed without thinking about edge cases.
//
// Authoring rules:
//   1. Every puzzle MUST be a position the player can solve using
//      ONLY the lesson's named technique (or strictly easier ones).
//      The unit test in `journey.test.ts` re-runs the solver against
//      the puzzle and asserts it converges, so a lesson that requires
//      a fancier technique fails CI loudly.
//   2. Keep `puzzle` near-complete (≥70 clue cells) for the
//      foundational lessons — the goal is teaching the pattern, not
//      solving a hard board. Longer practice puzzles live in their
//      own dedicated lesson tier.
//   3. Lesson IDs are stable forever — they're persisted in
//      localStorage (and eventually the DB) as completion keys.
//      Renaming a lesson is fine; renaming the id wipes progress.
//
// A note on the v0 catalog: this PR ships two naked-single-themed
// lessons to validate the framework end-to-end. Hidden-single,
// pointing-pair, and box-line-reduction lessons land in a follow-up
// once we curate puzzles whose first move *requires* the named
// technique (i.e. no naked single is available before then).

export type LessonTechnique = "naked-single" | "hidden-single" | "mixed";

export type Lesson = {
  // Stable, URL-safe identifier. NEVER renumber or repurpose — it
  // doubles as the localStorage key for completion state.
  id: string;
  // Display title shown on the journey map and lesson header.
  title: string;
  // Short marketing-style tagline (one sentence, sentence case).
  tagline: string;
  // Primary technique the lesson teaches. Drives the badge on the
  // journey map and the technique chip in the player.
  technique: LessonTechnique;
  // Difficulty hint shown next to the title. Same buckets the rest
  // of the app uses (1 = Easy ... 4 = Expert) so we can colour-code
  // consistently with the difficulty leaderboards.
  difficultyBucket: 1 | 2 | 3 | 4;
  // Lesson body in plain markdown (newlines as paragraph breaks).
  // Kept short on purpose — long-form pedagogy belongs in a future
  // dedicated curriculum doc, not jammed into a single React page.
  intro: string;
  // 81-char puzzle string. '0' (or '.') marks an empty cell.
  puzzle: string;
  // 81-char solution string. The validator compares board[i] to
  // solution[i] for every empty puzzle cell.
  solution: string;
};

// Reference solution shared by lessons 1 and 2 — a single 81-char
// solved board we can carve specific empty cells out of without
// having to re-verify uniqueness for each variant.
//
// Constructed by hand; the unit suite re-runs the solver against
// each lesson's puzzle to confirm it solves to this string, so a
// typo here is caught at test time.
const SHARED_SOLUTION =
  "534678912" +
  "672195348" +
  "198342567" +
  "859761423" +
  "426853791" +
  "713924856" +
  "961537284" +
  "287419635" +
  "345286179";

// Helper: clone the shared solution and clear a list of cell
// indices, returning the resulting puzzle string. Saves us
// hand-typing 81 chars per lesson and makes the cleared cells
// (the lesson's "targets") visible at a glance.
function carve(solution: string, emptyIndices: readonly number[]): string {
  const chars = solution.split("");
  for (const idx of emptyIndices) chars[idx] = "0";
  return chars.join("");
}

// LESSON 1 — Naked Single, three trivial cells.
//
// Each cleared cell has every other digit present in its row, column
// AND box, so the only legal candidate is the missing one. This is
// the "starter pack" the technique gets its name from: scan a unit
// for the cell where eight digits are already accounted for.
const NAKED_SINGLE_INTRO_EMPTY = [
  0, // r1c1 — only candidate is 5
  40, // r5c5 — only candidate is 5
  80, // r9c9 — only candidate is 9
] as const;

// LESSON 2 — Naked Single, a chain of eight cells.
//
// Eight empties spread around the board so the player has to scan
// rather than just clear three cells in a corner. Each cell is
// still a naked single because we picked positions whose row +
// column + box together still pin one digit. The unit test re-runs
// the solver and asserts it converges using only naked singles.
const NAKED_SINGLE_PRACTICE_EMPTY = [
  // top-left box (all three on its diagonal)
  0, // r1c1 = 5
  10, // r2c2 = 7
  20, // r3c3 = 8
  // middle row, opposite ends — keeps row 5 with two empties so
  // the player has to rule each one out by row + col + box
  36, // r5c1 = 4
  44, // r5c9 = 1
  // bottom-right box (mirrors the top-left structure)
  60, // r7c7 = 2
  70, // r8c8 = 3
  80, // r9c9 = 9
] as const;

export const LESSONS: readonly Lesson[] = [
  {
    id: "naked-single-intro",
    title: "Naked Singles",
    tagline: "Spot the cell where only one digit fits.",
    technique: "naked-single",
    difficultyBucket: 1,
    intro: [
      "A **naked single** is the simplest deduction in Sudoku: a cell whose row, column and 3×3 box already contain eight of the nine digits. The missing digit is the only legal value.",
      "Look for cells where most of the surrounding cells are filled. The fewer empty peers a cell has, the easier it is to find a naked single there.",
      "There are three empty cells in this practice board. Each one is a naked single — find them and place the right digit. Use 1–9 on your keyboard, or tap the number pad below.",
    ].join("\n\n"),
    puzzle: carve(SHARED_SOLUTION, NAKED_SINGLE_INTRO_EMPTY),
    solution: SHARED_SOLUTION,
  },
  {
    id: "naked-single-practice",
    title: "Naked Singles — Practice",
    tagline: "Eight cells, one technique. Scan the whole board.",
    technique: "naked-single",
    difficultyBucket: 1,
    intro: [
      "Same technique as the first lesson, but spread across the whole grid. Eight cells are empty; every one of them is still a naked single.",
      "**Tip:** scan row by row. The moment a row has only one empty cell, that cell is automatically a naked single — the row already accounts for eight digits.",
      "Fill every empty cell. The lesson completes the moment the board is solved.",
    ].join("\n\n"),
    puzzle: carve(SHARED_SOLUTION, NAKED_SINGLE_PRACTICE_EMPTY),
    solution: SHARED_SOLUTION,
  },
];

// O(1) lookup helper. Used by the route handler so a typo in the
// URL becomes a clean 404 rather than a confusing crash.
const LESSON_BY_ID: ReadonlyMap<string, Lesson> = new Map(
  LESSONS.map((l) => [l.id, l]),
);

export function getLessonById(id: string): Lesson | undefined {
  return LESSON_BY_ID.get(id);
}
