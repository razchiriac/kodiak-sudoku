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
// RAZ-84 expands the singles tier with curated hidden-single and
// mixed-singles lessons. The important authoring rule for every
// hidden-single board is: the FIRST solver step must be hidden-single,
// not naked-single. That forces the lesson to teach "scan the unit for
// the only possible home for a digit" instead of quietly degrading into
// another naked-single drill. The tests assert this contract.
//
// Pointing-pair, box-line, subset, and advanced lessons still need
// solver support before they can be tested honestly. Do NOT add those
// as static catalog entries until `nextHint()` knows their techniques;
// otherwise the lesson would either stall or fall back to the solution.

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

// LESSON 3 — Hidden Singles, intro.
//
// Unlike naked-single lessons, a hidden-single lesson needs "decoy"
// empty cells. If we only clear a few cells from a solved board, each
// target usually becomes a naked single because its peers already
// eliminate every other digit. This curated board has 41 empty cells:
// enough ambiguity that the opening move is NOT obvious from one cell's
// candidate list, while still being solvable by hidden/naked singles
// only. The first five solver steps are hidden singles in rows 1, 2, 4,
// 3, and 7, which gives the player repeated practice with the unit-scan
// idea before the board collapses into easier naked singles.
const HIDDEN_SINGLE_INTRO_PUZZLE =
  "010300805" +
  "839650020" +
  "200081030" +
  "102730009" +
  "080006010" +
  "060510302" +
  "096803100" +
  "508090263" +
  "000065000";

const HIDDEN_SINGLE_INTRO_SOLUTION =
  "614372895" +
  "839654721" +
  "275981436" +
  "152738649" +
  "983246517" +
  "467519382" +
  "796823154" +
  "548197263" +
  "321465978";

// LESSON 4 — Hidden Singles, practice.
//
// A denser practice board with seven hidden-single steps before the
// naked singles take over. The first move is r1c4 = 5 by scanning row 1:
// several cells have multiple candidates, but 5 has only one legal home.
const HIDDEN_SINGLE_PRACTICE_PUZZLE =
  "903000080" +
  "000070050" +
  "850936001" +
  "190820700" +
  "508709320" +
  "020050198" +
  "200065837" +
  "005097012" +
  "030000509";

const HIDDEN_SINGLE_PRACTICE_SOLUTION =
  "973541286" +
  "641278953" +
  "852936471" +
  "194823765" +
  "568719324" +
  "327654198" +
  "219465837" +
  "485397612" +
  "736182549";

// LESSON 5 — Mixed Singles practice.
//
// This one intentionally mixes hidden singles and naked singles. The
// player should no longer ask "which technique is this lesson about?"
// and instead practice the real solving loop: scan a unit for hidden
// singles, then grab naked singles as the board opens up.
const SINGLES_MIXED_PUZZLE =
  "090501082" +
  "200830045" +
  "385040160" +
  "950308004" +
  "020090070" +
  "041700000" +
  "100000430" +
  "508409006" +
  "409003850";

const SINGLES_MIXED_SOLUTION =
  "794561382" +
  "216837945" +
  "385942167" +
  "957328614" +
  "623194578" +
  "841756293" +
  "172685439" +
  "538419726" +
  "469273851";

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
  {
    id: "hidden-single-intro",
    title: "Hidden Singles",
    tagline: "Find the only home for a digit inside one unit.",
    technique: "hidden-single",
    difficultyBucket: 2,
    intro: [
      "A **hidden single** is different from a naked single. The cell may still have multiple candidate digits, but one digit has only one possible home in a row, column, or 3×3 box.",
      "**How to scan:** pick a unit, choose one missing digit, and ask: “where could this digit go?” If only one empty cell can accept it, that cell is a hidden single.",
      "This board starts with several hidden singles. Do not just look for cells with one candidate — scan rows, columns, and boxes for digits with one legal home.",
    ].join("\n\n"),
    puzzle: HIDDEN_SINGLE_INTRO_PUZZLE,
    solution: HIDDEN_SINGLE_INTRO_SOLUTION,
  },
  {
    id: "hidden-single-practice",
    title: "Hidden Singles — Practice",
    tagline: "Scan each unit until a digit has only one landing spot.",
    technique: "hidden-single",
    difficultyBucket: 2,
    intro: [
      "Hidden singles often appear before the board looks easy. A row can have five empty cells and still force one digit because the other empty cells are blocked by their columns or boxes.",
      "**Tip:** write down the missing digits for a row, then test one digit at a time. You are not asking “what can this cell be?” — you are asking “where can this digit go?”",
      "Solve the board using hidden singles first, then clean up any naked singles that appear afterward.",
    ].join("\n\n"),
    puzzle: HIDDEN_SINGLE_PRACTICE_PUZZLE,
    solution: HIDDEN_SINGLE_PRACTICE_SOLUTION,
  },
  {
    id: "singles-mixed-practice",
    title: "Singles — Mixed Practice",
    tagline: "Use naked and hidden singles together.",
    technique: "mixed",
    difficultyBucket: 2,
    intro: [
      "Real puzzles do not announce which technique comes next. This checkpoint mixes **naked singles** and **hidden singles** so you can practice choosing the right scan.",
      "If one cell has a single candidate, place it. If no cell looks forced, scan a row, column, or box for a digit with only one possible home.",
      "The lesson completes when the board is solved. No advanced techniques are required.",
    ].join("\n\n"),
    puzzle: SINGLES_MIXED_PUZZLE,
    solution: SINGLES_MIXED_SOLUTION,
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
