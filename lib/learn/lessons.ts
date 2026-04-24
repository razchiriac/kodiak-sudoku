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

export type LessonTechnique =
  | "naked-single"
  | "hidden-single"
  | "pointing-pair"
  | "box-line-reduction"
  | "naked-pair"
  | "naked-triple"
  | "hidden-pair"
  | "x-wing"
  | "swordfish"
  | "mixed";

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

const POINTING_PAIR_INTRO_PUZZLE =
  "000380060" +
  "307250001" +
  "090070023" +
  "900005070" +
  "430700109" +
  "000010000" +
  "009002000" +
  "603000200" +
  "200800006";

const POINTING_PAIR_INTRO_SOLUTION =
  "521389764" +
  "367254981" +
  "894671523" +
  "918435672" +
  "436728159" +
  "752916348" +
  "149562837" +
  "683147295" +
  "275893416";

const BOX_LINE_REDUCTION_INTRO_PUZZLE =
  "001078946" +
  "000090000" +
  "040500700" +
  "002000000" +
  "000102000" +
  "400900008" +
  "208650000" +
  "034009600" +
  "000020800";

const BOX_LINE_REDUCTION_INTRO_SOLUTION =
  "521378946" +
  "786294153" +
  "349516782" +
  "912865437" +
  "873142569" +
  "465937218" +
  "298651374" +
  "134789625" +
  "657423891";

const INTERSECTIONS_MIXED_PUZZLE =
  "000000000" +
  "003700000" +
  "000000000" +
  "000040009" +
  "036001000" +
  "000025000" +
  "070000060" +
  "900000100" +
  "321900008";

const INTERSECTIONS_MIXED_SOLUTION =
  "684219375" +
  "153768294" +
  "297534816" +
  "812647539" +
  "536891742" +
  "749325681" +
  "475182963" +
  "968453127" +
  "321976458";

const NAKED_PAIR_INTRO_PUZZLE =
  "060325009" +
  "200809060" +
  "050000832" +
  "001082000" +
  "600704083" +
  "005003000" +
  "000007620" +
  "000200974" +
  "000000350";

const NAKED_PAIR_INTRO_SOLUTION =
  "468325719" +
  "237819465" +
  "159476832" +
  "341682597" +
  "692754183" +
  "875193246" +
  "983547621" +
  "516238974" +
  "724961358";

const NAKED_TRIPLE_INTRO_PUZZLE =
  "070003008" +
  "000754000" +
  "000860030" +
  "206300000" +
  "000000080" +
  "100500023" +
  "400100052" +
  "020000341" +
  "000400000";

const NAKED_TRIPLE_INTRO_SOLUTION =
  "572913468" +
  "638754219" +
  "941862537" +
  "256381794" +
  "394276185" +
  "187549623" +
  "469137852" +
  "725698341" +
  "813425976";

const HIDDEN_PAIR_INTRO_PUZZLE =
  "021070930" +
  "800020010" +
  "700090200" +
  "500002060" +
  "000000572" +
  "268507490" +
  "000040000" +
  "000000000" +
  "002000140";

const HIDDEN_PAIR_INTRO_SOLUTION =
  "421675938" +
  "859324617" +
  "736891254" +
  "547932861" +
  "193468572" +
  "268517493" +
  "615243789" +
  "974186325" +
  "382759146";

const SUBSET_MIXED_PUZZLE =
  "090300000" +
  "700804000" +
  "003002000" +
  "000000000" +
  "800000000" +
  "000086700" +
  "900008004" +
  "308927000" +
  "002000000";

const SUBSET_MIXED_SOLUTION =
  "294361587" +
  "716854392" +
  "583792146" +
  "657149823" +
  "829573461" +
  "431286759" +
  "975618234" +
  "348927615" +
  "162435978";

const X_WING_INTRO_PUZZLE =
  "100000569" +
  "402000008" +
  "050009040" +
  "000640801" +
  "000010000" +
  "208035000" +
  "040500010" +
  "900000402" +
  "621000005";

const X_WING_INTRO_SOLUTION =
  "187423569" +
  "492756138" +
  "356189247" +
  "539647821" +
  "764218953" +
  "218935674" +
  "843592716" +
  "975361482" +
  "621874395";

const SWORDFISH_INTRO_PUZZLE =
  "000308002" +
  "000040700" +
  "001970080" +
  "905003006" +
  "037000520" +
  "800500903" +
  "070096100" +
  "006030000" +
  "400807000";

const SWORDFISH_INTRO_SOLUTION =
  "759318642" +
  "382645791" +
  "641972385" +
  "925783416" +
  "137469528" +
  "864521973" +
  "578296134" +
  "296134857" +
  "413857269";

const CAPSTONE_MIXED_PUZZLE =
  "008000000" +
  "030008002" +
  "294005073" +
  "081009000" +
  "000800005" +
  "520000000" +
  "010000458" +
  "800003001" +
  "002500007";

const CAPSTONE_MIXED_SOLUTION =
  "168372549" +
  "735498612" +
  "294615873" +
  "481259736" +
  "679834125" +
  "523167984" +
  "317926458" +
  "856743291" +
  "942581367";

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
  {
    id: "pointing-pair-intro",
    title: "Pointing Pairs",
    tagline: "Use a box pattern to clean up a row or column.",
    technique: "pointing-pair",
    difficultyBucket: 3,
    intro: [
      "A **pointing pair** happens when every possible home for a digit inside one 3×3 box sits on the same row or column.",
      "That means the digit must land in that box somewhere on that line, so you can remove that digit from the rest of the same row or column outside the box.",
      "This lesson starts with a pointing-pair move. Use it to create the next forced placement, then keep solving with the singles you already know.",
    ].join("\n\n"),
    puzzle: POINTING_PAIR_INTRO_PUZZLE,
    solution: POINTING_PAIR_INTRO_SOLUTION,
  },
  {
    id: "box-line-reduction-intro",
    title: "Box-Line Reduction",
    tagline: "Use a row or column pattern to clean up a box.",
    technique: "box-line-reduction",
    difficultyBucket: 3,
    intro: [
      "**Box-line reduction** is the inverse of pointing pairs. If every possible home for a digit in one row or column sits inside the same 3×3 box, then that digit cannot appear elsewhere in the box.",
      "Look for a row or column where a digit is trapped inside one box. Remove that digit from the rest of that box, then place the newly forced value.",
      "The first move in this lesson is a box-line reduction. After that, the board opens into familiar singles and subset patterns.",
    ].join("\n\n"),
    puzzle: BOX_LINE_REDUCTION_INTRO_PUZZLE,
    solution: BOX_LINE_REDUCTION_INTRO_SOLUTION,
  },
  {
    id: "intersections-mixed-practice",
    title: "Intersections — Mixed Practice",
    tagline: "Switch between pointing pairs and box-line reductions.",
    technique: "mixed",
    difficultyBucket: 3,
    intro: [
      "Intersection techniques all ask the same question: is a digit trapped where a box and a line cross?",
      "Sometimes the box points into a line. Sometimes the line points back into a box. Practice both directions here, then use singles to clean up.",
      "This checkpoint includes both pointing-pair and box-line-reduction moments.",
    ].join("\n\n"),
    puzzle: INTERSECTIONS_MIXED_PUZZLE,
    solution: INTERSECTIONS_MIXED_SOLUTION,
  },
  {
    id: "naked-pair-intro",
    title: "Naked Pairs",
    tagline: "Two cells reserve two digits for themselves.",
    technique: "naked-pair",
    difficultyBucket: 3,
    intro: [
      "A **naked pair** appears when two cells in the same row, column, or box contain the exact same two candidates.",
      "Those two digits must occupy those two cells, so every other cell in the unit can remove both digits from its candidates.",
      "Use the pair to create a forced placement, then continue with singles.",
    ].join("\n\n"),
    puzzle: NAKED_PAIR_INTRO_PUZZLE,
    solution: NAKED_PAIR_INTRO_SOLUTION,
  },
  {
    id: "naked-triple-intro",
    title: "Naked Triples",
    tagline: "Three cells reserve three digits together.",
    technique: "naked-triple",
    difficultyBucket: 3,
    intro: [
      "A **naked triple** is the same idea as a naked pair, but spread across three cells and three digits.",
      "The three cells do not all need the exact same candidates. What matters is that their combined candidates are exactly three digits.",
      "Remove those three digits from the other cells in the unit, then place the digit that becomes forced.",
    ].join("\n\n"),
    puzzle: NAKED_TRIPLE_INTRO_PUZZLE,
    solution: NAKED_TRIPLE_INTRO_SOLUTION,
  },
  {
    id: "hidden-pair-intro",
    title: "Hidden Pairs",
    tagline: "Two digits hide inside the same two cells.",
    technique: "hidden-pair",
    difficultyBucket: 3,
    intro: [
      "A **hidden pair** appears when two digits can only go in the same two cells inside a row, column, or box.",
      "Those two cells may have extra candidates written in, but the pair lets you remove every other candidate from those cells.",
      "This lesson starts with a hidden-pair deduction and then collapses into easier placements.",
    ].join("\n\n"),
    puzzle: HIDDEN_PAIR_INTRO_PUZZLE,
    solution: HIDDEN_PAIR_INTRO_SOLUTION,
  },
  {
    id: "subset-mixed-practice",
    title: "Subsets — Mixed Practice",
    tagline: "Practice pairs, triples, and hidden pairs together.",
    technique: "mixed",
    difficultyBucket: 3,
    intro: [
      "Subset patterns reserve digits. Naked subsets reserve digits through visible candidate sets; hidden subsets reserve cells through where digits can appear.",
      "This checkpoint includes naked pairs, naked triples, and hidden pairs. When you get stuck, ask what a pair or triple is reserving.",
      "Finish the board without needing any fish techniques.",
    ].join("\n\n"),
    puzzle: SUBSET_MIXED_PUZZLE,
    solution: SUBSET_MIXED_SOLUTION,
  },
  {
    id: "x-wing-intro",
    title: "X-Wing",
    tagline: "Use two matching lines to eliminate a digit.",
    technique: "x-wing",
    difficultyBucket: 4,
    intro: [
      "An **X-Wing** appears when a digit can occupy the same two columns across two different rows (or the same two rows across two columns).",
      "The digit must form the corners of that rectangle, so you can remove it from the rest of those columns or rows.",
      "This advanced board is a curated X-Wing practice puzzle. Singles and pairs still appear along the way; use them whenever they unlock the next step.",
    ].join("\n\n"),
    puzzle: X_WING_INTRO_PUZZLE,
    solution: X_WING_INTRO_SOLUTION,
  },
  {
    id: "swordfish-intro",
    title: "Swordfish",
    tagline: "Track one digit across three rows or columns.",
    technique: "swordfish",
    difficultyBucket: 4,
    intro: [
      "A **Swordfish** is the three-line version of an X-Wing. One digit is confined to three columns across three rows, or three rows across three columns.",
      "Those three lines reserve the digit's homes, letting you remove the digit from the rest of the intersecting lines.",
      "This is a stretch technique. Use the easier singles and pairs as they appear, then look for the fish pattern when progress slows.",
    ].join("\n\n"),
    puzzle: SWORDFISH_INTRO_PUZZLE,
    solution: SWORDFISH_INTRO_SOLUTION,
  },
  {
    id: "capstone-mixed-practice",
    title: "Technique Journey Capstone",
    tagline: "Bring the whole toolkit together.",
    technique: "mixed",
    difficultyBucket: 4,
    intro: [
      "This capstone mixes singles, intersections, and subset patterns. It is meant to feel closer to a real Medium/Hard solve than a tiny isolated drill.",
      "Do not force one technique. Scan for the easiest available move, place it, and let the next pattern emerge.",
      "Completing this lesson means you can combine the core techniques from the journey instead of treating them as separate tricks.",
    ].join("\n\n"),
    puzzle: CAPSTONE_MIXED_PUZZLE,
    solution: CAPSTONE_MIXED_SOLUTION,
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
