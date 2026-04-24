import type { HintSuggestion, HintUnit } from "./solver";

// RAZ-14 — Message formatting for the three-tier progressive hint flow.
//
// Tier 1 ("where to look") reveals the coarsest useful information: which
// Sudoku unit the deduction lives in. We don't name the technique yet so
// the player still has to notice the pattern on their own — the whole
// point of this tier is to teach scanning.
//
// Tier 2 ("what technique, which cell") names the technique by its
// canonical label and points at the exact cell — but still hides the
// digit. This is the pedagogically richest tier: a player who sees
// "naked single at r3c7" usually solves the cell on their own in a
// couple of seconds.
//
// Tier 3 is the actual placement, so it doesn't need a message here —
// the store applies the digit and clears the session.
//
// Keeping these formatters in a dedicated file (rather than inline in
// the control panel) lets the tests assert message copy without pulling
// in React or the store.

const UNIT_LABEL: Record<HintUnit, string> = {
  row: "row",
  col: "column",
  box: "box",
  diag: "diagonal",
};

const TECHNIQUE_LABEL: Record<HintSuggestion["technique"], string> = {
  "naked-single": "Naked single",
  "hidden-single": "Hidden single",
  "pointing-pair": "Pointing pair",
  "box-line-reduction": "Box-line reduction",
  "naked-pair": "Naked pair",
  "naked-triple": "Naked triple",
  "hidden-pair": "Hidden pair",
  "x-wing": "X-Wing",
  swordfish: "Swordfish",
  // "from-solution" is the fallback path when no human technique applies.
  // We don't want to lie to the player by inventing a fake technique name,
  // so we use a neutral copy for tier 2 that still tells them where to
  // look without promising a teachable moment.
  "from-solution": "Forced placement",
};

// Tier 1 — "look over here". Human units are 1-indexed; the internal
// representation is 0-indexed so the UI layer converts once here rather
// than at every callsite.
export function tier1Message(suggestion: HintSuggestion): string {
  const label = UNIT_LABEL[suggestion.unit];
  return `Try looking at ${label} ${suggestion.unitIndex + 1}.`;
}

// Tier 2 — "technique + cell, digit still hidden". We use r{r}c{c} with
// 1-indexed coordinates because that's the dominant convention in
// Sudoku pedagogy (every technique name you'll find on hodoku.sourceforge.io
// uses it, and our tests assert the exact format).
export function tier2Message(suggestion: HintSuggestion): string {
  const r = Math.floor(suggestion.index / 9) + 1;
  const c = (suggestion.index % 9) + 1;
  const technique = TECHNIQUE_LABEL[suggestion.technique];
  return `${technique} at r${r}c${c}.`;
}
