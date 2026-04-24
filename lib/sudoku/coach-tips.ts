// RAZ-49 — Adaptive Coach Mode (deterministic).
//
// Pure, framework-free tip detector. Given a snapshot of the live
// game (board, recent events, conflict set, hint context, settings)
// returns at most ONE prioritized "coaching tip" — a short
// dismissible message that explains WHY something just happened or
// nudges the player toward a better habit.
//
// Why a separate file from RAZ-48's `stuck-detection.ts`:
//   - That module answers ONE question: "is the player stuck?".
//     Its detectors look at idle time and oscillations and emit a
//     single "rescue" signal that opens the existing rescue chip.
//   - RAZ-49 is broader: it surfaces tips for a richer set of
//     trigger conditions that have nothing to do with being stuck
//     (just made a conflict, just used a hint, hasn't tried notes
//     yet, has been making rapid mistakes). The tip taxonomy and
//     UI surface are different from rescue — both can stack.
//
// Why a separate file from RAZ-58's `lib/server/coach.ts`:
//   - That module is server-side and OPTIONAL — it only runs when
//     the player explicitly opens the AI Coach panel and (worse)
//     requires a paid OpenAI key to do its real job.
//   - RAZ-49 is client-side and ALWAYS-on (subject to the flag +
//     per-user opt-out). Every tip here is a pure function of
//     local state; there is no network round-trip and no model
//     call, so the tip surface is free, instant, and deterministic.
//
// Determinism contract:
//   For the SAME inputs (board hash + same recent events + same
//   suppressed kinds + same elapsedMs bucket), `extractTip()`
//   returns the SAME tip. The acceptance criteria call this out
//   explicitly so it's the load-bearing test in the unit suite.
//   Non-deterministic inputs (e.g. wall-clock Date.now()) are
//   intentionally NOT consulted — the caller passes elapsedMs.
//
// Cooldown / dedupe:
//   The engine itself is stateless. The caller passes
//   `suppressedKinds` (a set of tip kinds that are currently in
//   cooldown OR have been snoozed for the puzzle). The engine
//   skips any detector whose kind is in that set. This keeps the
//   pure module test-friendly (no fake timers needed) and keeps
//   per-session bookkeeping in the React hook where it belongs
//   (same split as `detectStuck` + `useStuckDetector`).

import {
  BOARD_SIZE,
  GRID_DIM,
  boxOf,
  colOf,
  parseBoard,
  rowOf,
  type Board,
  type CellIndex,
  type Variant,
} from "./board";
import { findConflicts } from "./validate";
import type { InputEvent } from "./input-events";

// Tip kinds, ordered by intended priority (highest first). The
// engine evaluates detectors in this exact order and returns the
// first that fires. Keeping the list explicit (not just an alpha
// sort of detector functions) makes it trivial to verify priority
// in tests AND obvious from the source what the player will see
// when multiple tips would otherwise be eligible.
//
// Why this order:
//   1. conflict-explainer — A live constraint violation is the
//      most actionable thing on the board. The player NEEDS to
//      see "this 5 conflicts with the 5 in row N" before any
//      higher-level habit nudge will land.
//   2. technique-followup — When a hint was just applied, briefly
//      naming the technique converts a "magic answer" into a
//      learning moment. Time-windowed so it only fires while the
//      hint is fresh in the player's head.
//   3. mistake-streak — Several wrong placements in quick
//      succession suggests the player is guessing. A "slow down"
//      nudge here is more useful than the catch-all habit tip.
//   4. notes-encouragement — Lowest-priority, slowest cadence.
//      Fires once per puzzle for players who clearly aren't using
//      pencil marks on a hard board.
export const COACH_TIP_KINDS = [
  "conflict-explainer",
  "technique-followup",
  "mistake-streak",
  "notes-encouragement",
] as const;

export type CoachTipKind = (typeof COACH_TIP_KINDS)[number];

// Severity is used by the UI to pick a color and (potentially)
// loudness. We keep it coarse: "info" for habit / learning tips,
// "warn" for things the player almost certainly wants to act on.
// Mapped 1:1 from kind in `tipFor*` helpers — exposed on the tip
// so the renderer doesn't have to repeat the mapping.
export type CoachTipSeverity = "info" | "warn";

export type CoachTip = {
  // The kind of tip. Used for cooldown bookkeeping in the hook
  // AND telemetry tags. Not shown to the player directly.
  kind: CoachTipKind;
  // Human-readable headline — at most one sentence, plain
  // English, no emojis. Renderer concatenates this with the
  // optional secondary line below.
  message: string;
  // Optional secondary explanation. Shown beneath `message` in
  // the banner; null when the headline is enough on its own.
  // Kept short (~120 chars) so the banner stays unobtrusive.
  detail: string | null;
  // Severity. Picked by detector based on how actionable the tip
  // is — see CoachTipSeverity comment.
  severity: CoachTipSeverity;
  // Stable de-duplication key. The hook uses this to avoid
  // showing the same exact tip twice in a row even when the
  // detector would re-fire (e.g. the same conflict cell is still
  // there). Different from `kind` — two tips of kind
  // "conflict-explainer" pointing at different cells should NOT
  // be deduped. Format is `<kind>:<discriminator>`.
  dedupeKey: string;
  // Optional cell focus. When set, the UI may highlight the
  // referenced cell while the tip is visible. Detectors that
  // can't point at a single cell leave this null.
  focusCell: CellIndex | null;
};

// Snapshot the engine consumes. Mirrors what the React hook can
// read from the store cheaply. We avoid passing the whole game
// state so the engine is callable from tests with hand-rolled
// fixtures.
export type CoachTipInput = {
  // Current board state. Engine treats this as read-only and
  // never mutates.
  board: Board;
  // Original puzzle clue mask (1 = clue, 0 = editable). Used to
  // exclude clue cells from "user just placed a wrong digit"
  // signals.
  fixed: Uint8Array;
  // Sudoku variant — passed through to peer / conflict helpers.
  variant: Variant;
  // The puzzle's known solution as an 81-char string, or null
  // when the solution isn't available client-side (daily puzzles
  // before completion). When null the `mistake-streak` detector
  // falls back to using the conflict set as a proxy — good
  // enough for fairness because most "mistakes" do produce a
  // peer conflict.
  solution: string | null;
  // Set of cell indices currently in conflict (mirror of the
  // store's `conflicts` set). The conflict-explainer detector
  // picks the lowest-indexed conflict cell so the tip is
  // deterministic across re-renders.
  conflicts: ReadonlySet<CellIndex>;
  // Recent player input events, oldest first. Same ring buffer
  // RAZ-48 consumes. Engine slices the tail internally.
  events: readonly InputEvent[];
  // Elapsed game time in milliseconds (the store's `elapsedMs`,
  // pause-exclusive). Time anchor for the warmup gate AND the
  // `mistake-streak` window.
  elapsedMs: number;
  // Number of hints the player has used so far this attempt.
  // Combined with `lastHintAtMs` to power the technique-followup
  // detector — the tip should appear briefly AFTER a hint, not
  // before any have been used.
  hintsUsed: number;
  // Elapsed time of the most-recent hint placement, or null when
  // no hint has been used. The technique-followup detector fires
  // only inside `(lastHintAtMs, lastHintAtMs + WINDOW_MS]`.
  lastHintAtMs: number | null;
  // Most-recent hint's technique label, or null. Carried through
  // so the detector can produce a technique-specific message
  // ("That hint was a Naked Single — only one digit fits there
  // given its peers.") without re-running the solver.
  lastHintTechnique:
    | "naked-single"
    | "hidden-single"
    | "from-solution"
    | null;
  // Whether the player currently has notes-mode enabled. Used by
  // `notes-encouragement` — if they're already toggling notes,
  // the nudge would be misplaced.
  notesModeOn: boolean;
  // Total bitmask popcount across all cells in the player's
  // notes. The notes-encouragement detector fires when this is
  // very low for a hard puzzle.
  totalNotesPlaced: number;
  // Set of tip kinds suppressed for this puzzle (cooldowns +
  // snooze). The engine skips detectors whose kind is in this
  // set. Exposed as a parameter (rather than computed from a
  // timestamp) so the engine stays a pure function of its input.
  suppressedKinds: ReadonlySet<CoachTipKind>;
  // True while the timer is running. Engine returns null on
  // pause to match `detectStuck` — no point surfacing tips when
  // the player isn't looking at the board.
  isRunning: boolean;
  // True when the puzzle is solved. Engine returns null on
  // completion so the completion modal isn't covered with
  // banner noise.
  isComplete: boolean;
};

// --- Tunable thresholds ---------------------------------------------------
//
// All thresholds live as named constants so they're easy to tune
// from cohort signal post-launch. Keep them at module top so a
// reviewer can see all knobs in one spot.

// Minimum elapsed time before any tip is allowed. Without this a
// player who opens a puzzle and immediately makes a typo would
// get a tip in the first second, which feels intrusive. 20s is
// shorter than RAZ-48's `RESCUE_WARMUP_MS` (30s) because tips
// are softer than the rescue chip — we can be quicker to help.
const TIP_WARMUP_MS = 20_000;

// How long after a hint the technique-followup tip is eligible.
// 15s is enough for the player to read the toast that already
// rendered the tier-2 hint hint, then see the tip explaining the
// technique while context is still fresh. Past that the tip
// becomes noise.
const TECHNIQUE_FOLLOWUP_WINDOW_MS = 15_000;

// Number of WRONG value placements within `MISTAKE_STREAK_WINDOW_MS`
// to fire the mistake-streak nudge. Three is a true streak (one
// could be a typo, two could be experimentation, three is "I'm
// guessing"). Lower than this and we'd nag legitimate
// pattern-finding behavior; higher and we'd miss the window
// where a slow-down nudge actually helps.
const MISTAKE_STREAK_THRESHOLD = 3;

// Sliding-window for counting recent mistakes. 90s is roughly
// the time it takes to make and recognize three errors in a row
// — long enough to count a real streak without firing on a
// scattered mistake every few minutes.
const MISTAKE_STREAK_WINDOW_MS = 90_000;

// Notes-encouragement: minimum elapsed before we consider it.
// Players legitimately solve Easy puzzles without notes; the
// nudge is for someone who's clearly past the trivial cells and
// could benefit from pencil marks. 4 minutes lines up with the
// 75th-percentile Easy completion time.
const NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS = 4 * 60 * 1000;

// Notes-encouragement: minimum number of empty cells remaining.
// On an almost-finished board the tip would be useless. ~30 is
// "mid-game on a Hard puzzle".
const NOTES_ENCOURAGEMENT_MIN_EMPTY_CELLS = 30;

// Notes-encouragement: maximum total notes already placed. Above
// this threshold the player is clearly using notes already, so
// the tip would be wrong. We don't gate on EXACTLY zero so a
// player who placed a few exploratory notes still qualifies.
const NOTES_ENCOURAGEMENT_MAX_NOTES = 5;

// --- Detectors ------------------------------------------------------------
//
// Each detector is a pure function from CoachTipInput → CoachTip | null.
// They're invoked in the order declared in COACH_TIP_KINDS and the first
// non-null result wins. They MUST NOT consult anything outside the input
// (no module-level state, no Date.now, no random) so the engine stays a
// pure function and the test suite never needs fake timers.

// Conflict-explainer: when there's at least one conflict on the
// board, surface a human-readable explanation pointing at the
// SHARED unit (row, column, or box) that contains the duplicate.
//
// We pick the LOWEST-indexed conflict cell as the anchor — purely
// for determinism. Then we identify which unit the duplicate lives
// in by scanning the cell's row, column, and box for a peer with
// the same digit. We report ONE unit (the first found in row →
// col → box order); if multiple share the duplicate, the player
// can dismiss this tip and the next tick will surface another.
function detectConflictExplainer(input: CoachTipInput): CoachTip | null {
  if (input.conflicts.size === 0) return null;
  // Find the lowest-indexed conflict cell — `Set.values()` order
  // is insertion order, but the store builds the set by scanning
  // 0..80, so the iteration order is index-ascending in practice.
  // We don't rely on that — we explicitly take the min so the
  // tip is bit-exactly reproducible across runtimes.
  let anchor = -1;
  for (const idx of input.conflicts) {
    if (anchor === -1 || idx < anchor) anchor = idx;
  }
  if (anchor < 0) return null;
  const digit = input.board[anchor];
  if (digit === 0) return null; // shouldn't happen, but guards a bad input
  // Skip clue cells — their conflicts (if any) are a puzzle bug,
  // not something the player did. The tip would be misleading.
  if (input.fixed[anchor] === 1) return null;

  // Identify the unit containing the duplicate. We check row → col
  // → box in that order so the tip language is consistent.
  const r = rowOf(anchor);
  const c = colOf(anchor);

  // Row scan
  for (let cc = 0; cc < GRID_DIM; cc++) {
    const peer = r * GRID_DIM + cc;
    if (peer === anchor) continue;
    if (input.board[peer] === digit) {
      return {
        kind: "conflict-explainer",
        message: `That ${digit} clashes with another ${digit} in row ${r + 1}.`,
        detail:
          "Each row, column, and 3×3 box must contain every digit 1–9 exactly once.",
        severity: "warn",
        dedupeKey: `conflict-explainer:${anchor}:${digit}:row:${r}`,
        focusCell: anchor,
      };
    }
  }

  // Column scan
  for (let rr = 0; rr < GRID_DIM; rr++) {
    const peer = rr * GRID_DIM + c;
    if (peer === anchor) continue;
    if (input.board[peer] === digit) {
      return {
        kind: "conflict-explainer",
        message: `That ${digit} clashes with another ${digit} in column ${c + 1}.`,
        detail:
          "Each row, column, and 3×3 box must contain every digit 1–9 exactly once.",
        severity: "warn",
        dedupeKey: `conflict-explainer:${anchor}:${digit}:col:${c}`,
        focusCell: anchor,
      };
    }
  }

  // Box scan
  const b = boxOf(anchor);
  const boxRow = Math.floor(b / 3) * 3;
  const boxCol = (b % 3) * 3;
  for (let rr = boxRow; rr < boxRow + 3; rr++) {
    for (let cc = boxCol; cc < boxCol + 3; cc++) {
      const peer = rr * GRID_DIM + cc;
      if (peer === anchor) continue;
      if (input.board[peer] === digit) {
        return {
          kind: "conflict-explainer",
          message: `That ${digit} clashes with another ${digit} in this 3×3 box.`,
          detail:
            "Each row, column, and 3×3 box must contain every digit 1–9 exactly once.",
          severity: "warn",
          dedupeKey: `conflict-explainer:${anchor}:${digit}:box:${b}`,
          focusCell: anchor,
        };
      }
    }
  }

  // Conflict reported by the validator but no duplicate found in
  // peers. Could happen on a diagonal-variant puzzle where the
  // duplicate is on the diagonal — we don't render a unit-specific
  // tip in that case (would require diag-specific copy) and skip
  // gracefully rather than guessing.
  return null;
}

// Technique-followup: fires for `TECHNIQUE_FOLLOWUP_WINDOW_MS` after
// a hint is applied. Names the technique in plain English so the
// player connects "magic answer" to "deduction pattern".
function detectTechniqueFollowup(input: CoachTipInput): CoachTip | null {
  if (input.lastHintAtMs == null) return null;
  if (input.lastHintTechnique == null) return null;
  const sinceHint = input.elapsedMs - input.lastHintAtMs;
  if (sinceHint < 0) return null;
  if (sinceHint > TECHNIQUE_FOLLOWUP_WINDOW_MS) return null;
  // Skip "from-solution" hints — those don't carry a teachable
  // technique (the solver fell back to revealing a cell from the
  // stored solution because no basic deduction applied), so the
  // tip would be misleading.
  if (input.lastHintTechnique === "from-solution") return null;
  // Compose the message + detail per technique. We hard-code the
  // copy because translating between technique IDs and natural
  // language is exactly the kind of teaching moment this tip is
  // for; auto-generated text would be vague.
  if (input.lastHintTechnique === "naked-single") {
    return {
      kind: "technique-followup",
      message: "That hint was a Naked Single.",
      detail:
        "Only one digit can fit in that cell once you account for its row, column, and box neighbors.",
      severity: "info",
      dedupeKey: `technique-followup:naked-single:${input.lastHintAtMs}`,
      focusCell: null,
    };
  }
  // hidden-single
  return {
    kind: "technique-followup",
    message: "That hint was a Hidden Single.",
    detail:
      "Look at one row, column, or box at a time — sometimes a digit can only go in one cell within that unit, even if other digits could too.",
    severity: "info",
    dedupeKey: `technique-followup:hidden-single:${input.lastHintAtMs}`,
    focusCell: null,
  };
}

// Mistake-streak: counts wrong placements (or, when the solution
// isn't available, conflict-causing placements) inside the trailing
// window. Fires when the count crosses `MISTAKE_STREAK_THRESHOLD`.
//
// "Wrong" definition:
//   - With solution: digit placed != solution[cell] for that cell.
//   - Without solution: the placement is in a cell that is now in
//     the conflict set after the placement.
function detectMistakeStreak(input: CoachTipInput): CoachTip | null {
  if (input.elapsedMs < TIP_WARMUP_MS) return null;
  // Only consider value-placement events inside the window. Erases
  // and hint-applied placements don't count toward "the player
  // keeps making mistakes".
  const windowStart = input.elapsedMs - MISTAKE_STREAK_WINDOW_MS;
  let mistakes = 0;
  if (input.solution && input.solution.length === BOARD_SIZE) {
    for (const e of input.events) {
      if (e.k !== "v") continue;
      if (e.t < windowStart) continue;
      // Wrong if it doesn't match the solution. We use charCodeAt
      // - 48 to convert the ASCII digit to a number without an
      // intermediate string (avoids per-event allocations).
      const want = input.solution.charCodeAt(e.c) - 48;
      if (e.d !== want) mistakes++;
    }
  } else {
    // No solution: fall back to "did this placement currently
    // sit in the conflict set?". This undercounts mistakes that
    // were already corrected, but conflict-set membership is the
    // best client-side proxy without leaking the solution.
    for (const e of input.events) {
      if (e.k !== "v") continue;
      if (e.t < windowStart) continue;
      if (input.conflicts.has(e.c)) mistakes++;
    }
  }
  if (mistakes < MISTAKE_STREAK_THRESHOLD) return null;
  return {
    kind: "mistake-streak",
    message: `${mistakes} wrong placements in the last minute or so.`,
    detail:
      "Try slowing down: pick one empty cell and list the digits that ARE allowed there before placing one.",
    severity: "info",
    // Dedupe at the count granularity — re-firing as the count
    // grows is fine and feels responsive.
    dedupeKey: `mistake-streak:${mistakes}`,
    focusCell: null,
  };
}

// Notes-encouragement: gentle "consider using notes" nudge for a
// player who is mid-game on a non-trivial board and clearly hasn't
// adopted pencil marks. Fires AT MOST once per puzzle (per the
// caller's `suppressedKinds` after a dismiss).
function detectNotesEncouragement(input: CoachTipInput): CoachTip | null {
  if (input.elapsedMs < NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS) return null;
  if (input.notesModeOn) return null;
  if (input.totalNotesPlaced > NOTES_ENCOURAGEMENT_MAX_NOTES) return null;
  // Count empty cells. We could store this in the store but it's
  // a single 81-iteration loop — cheaper than maintaining yet
  // another mirror.
  let empty = 0;
  for (let i = 0; i < BOARD_SIZE; i++) {
    if (input.board[i] === 0) empty++;
  }
  if (empty < NOTES_ENCOURAGEMENT_MIN_EMPTY_CELLS) return null;
  return {
    kind: "notes-encouragement",
    message: "Try Notes mode for tricky cells.",
    detail:
      "Switch to notes (the pencil button or `N` on keyboard) and pencil in candidate digits — it's how most solvers crack the harder puzzles.",
    severity: "info",
    dedupeKey: `notes-encouragement:${input.elapsedMs >> 13}`,
    focusCell: null,
  };
}

// --- Public entry point ---------------------------------------------------
//
// `extractTip` runs the detectors in priority order, skipping any
// kind that is currently suppressed, and returns the first tip
// produced (or null when nothing is eligible).
export function extractTip(input: CoachTipInput): CoachTip | null {
  if (!input.isRunning) return null;
  if (input.isComplete) return null;
  if (input.elapsedMs < TIP_WARMUP_MS) {
    // Warmup window only blocks generic / habit tips. The
    // conflict-explainer is allowed to fire immediately because a
    // visible conflict on the board is always actionable, even
    // 5 seconds in.
    if (input.conflicts.size > 0 && !input.suppressedKinds.has("conflict-explainer")) {
      return detectConflictExplainer(input);
    }
    return null;
  }
  for (const kind of COACH_TIP_KINDS) {
    if (input.suppressedKinds.has(kind)) continue;
    const tip = runDetector(kind, input);
    if (tip) return tip;
  }
  return null;
}

// Tiny dispatch helper. Inlining the switch keeps detector ordering
// driven by the COACH_TIP_KINDS tuple (single source of truth) and
// gives the type checker a literal-narrowing handle so a new kind
// added to the tuple breaks the build until a detector exists.
function runDetector(
  kind: CoachTipKind,
  input: CoachTipInput,
): CoachTip | null {
  switch (kind) {
    case "conflict-explainer":
      return detectConflictExplainer(input);
    case "technique-followup":
      return detectTechniqueFollowup(input);
    case "mistake-streak":
      return detectMistakeStreak(input);
    case "notes-encouragement":
      return detectNotesEncouragement(input);
  }
}

// Internal-use export. Test-only convenience wrapper that builds a
// minimal CoachTipInput from an 81-char board string + sensible
// defaults so each test can focus on the field it's exercising.
// Public so the e2e / playwright harness can also use it.
export function makeTestInput(
  boardOrPuzzle: string,
  overrides: Partial<CoachTipInput> = {},
): CoachTipInput {
  const board = parseBoard(boardOrPuzzle);
  const fixed = new Uint8Array(BOARD_SIZE);
  for (let i = 0; i < BOARD_SIZE; i++) fixed[i] = board[i] !== 0 ? 1 : 0;
  return {
    board,
    fixed,
    variant: "standard",
    solution: null,
    conflicts: findConflicts(board),
    events: [],
    elapsedMs: 5 * 60 * 1000,
    hintsUsed: 0,
    lastHintAtMs: null,
    lastHintTechnique: null,
    notesModeOn: false,
    totalNotesPlaced: 0,
    suppressedKinds: new Set(),
    isRunning: true,
    isComplete: false,
    ...overrides,
  };
}

// Re-export tunable thresholds so the hook can use the SAME values
// for cooldown timing without redefining them. Keeps the per-kind
// behavior coherent across the engine and the React layer.
export const COACH_TIP_TUNABLES = {
  WARMUP_MS: TIP_WARMUP_MS,
  TECHNIQUE_FOLLOWUP_WINDOW_MS,
  MISTAKE_STREAK_THRESHOLD,
  MISTAKE_STREAK_WINDOW_MS,
  NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS,
  NOTES_ENCOURAGEMENT_MIN_EMPTY_CELLS,
  NOTES_ENCOURAGEMENT_MAX_NOTES,
} as const;
