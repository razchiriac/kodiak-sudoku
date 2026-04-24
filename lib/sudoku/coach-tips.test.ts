// RAZ-49 — Adaptive Coach Mode unit tests.
//
// The detectors are pure functions, so tests focus on:
//   1. Each detector fires under its trigger condition.
//   2. Each detector is correctly GATED — warmup, completion,
//      pause, suppressed-kinds, and per-kind preconditions.
//   3. Priority order between detectors is honored when multiple
//      would otherwise be eligible.
//   4. The acceptance criterion: the engine is DETERMINISTIC for
//      identical inputs (same input → same tip).

import { describe, expect, it } from "vitest";
import {
  COACH_TIP_KINDS,
  COACH_TIP_TUNABLES,
  extractTip,
  makeTestInput,
  type CoachTipInput,
  type CoachTipKind,
} from "./coach-tips";
import { BOARD_SIZE, parseBoard } from "./board";
import { findConflicts } from "./validate";

// Build a CoachTipInput from a board string where the conflicting
// cells are explicitly NOT flagged as clues. The default
// `makeTestInput` helper marks every non-empty cell as fixed (the
// "all clues" assumption is fine for puzzle fixtures), which would
// make conflict-explainer skip them as a "puzzle bug". For the
// hand-rolled "two duplicate digits in a sparse board" fixtures
// below we explicitly want the engine to treat the duplicates as
// player placements.
function makeUserPlacedInput(
  boardStr: string,
  overrides: Parameters<typeof makeTestInput>[1] = {},
): CoachTipInput {
  const board = parseBoard(boardStr);
  const fixed = new Uint8Array(BOARD_SIZE);
  // Empty mask → every placed digit is treated as a player move,
  // not a clue. Conflict-explainer is therefore eligible for ALL
  // duplicates in the fixture.
  return makeTestInput(boardStr, {
    fixed,
    board,
    conflicts: findConflicts(board),
    ...overrides,
  });
}

// A canonical Easy puzzle + its known solution. Used as the base
// fixture for every test below — many tests want a "real-looking"
// board so the empty-cell count, conflict scans, and digit values
// behave like a live attempt.
const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

describe("priority order is the COACH_TIP_KINDS tuple", () => {
  // The acceptance criteria say "tips are deterministic and
  // reproducible". Locking the priority order here means a
  // reorder of detectors can't silently change the player UX
  // — the test breaks first.
  it("declares the four kinds in the documented priority order", () => {
    expect([...COACH_TIP_KINDS]).toEqual([
      "conflict-explainer",
      "technique-followup",
      "mistake-streak",
      "notes-encouragement",
    ]);
  });
});

describe("extractTip — gating", () => {
  it("returns null when paused", () => {
    const input = makeTestInput(PUZZLE, { isRunning: false });
    expect(extractTip(input)).toBeNull();
  });

  it("returns null when complete", () => {
    const input = makeTestInput(PUZZLE, { isComplete: true });
    expect(extractTip(input)).toBeNull();
  });

  it("returns null inside the warmup window for habit tips", () => {
    // 10s elapsed — below the 20s warmup. A notes-encouragement
    // tip would otherwise be eligible (long elapsed, no notes,
    // many empty cells); the warmup gate stops it.
    const input = makeTestInput(PUZZLE, {
      elapsedMs: 10_000,
      totalNotesPlaced: 0,
      notesModeOn: false,
    });
    expect(extractTip(input)).toBeNull();
  });

  it("warmup does NOT block conflict-explainer (visible conflicts are always actionable)", () => {
    // Make a board with an actual peer conflict in row 0 and
    // surface it inside the warmup window. Tip should still
    // fire because conflicts are higher-priority than warmup.
    const input = makeUserPlacedInput("550000000".padEnd(81, "0"), {
      elapsedMs: 5_000,
    });
    const tip = extractTip(input);
    expect(tip?.kind).toBe("conflict-explainer");
  });

  it("respects suppressedKinds — skips detectors whose kind is suppressed", () => {
    // Conflict on the board, but conflict-explainer is suppressed
    // (e.g. just dismissed). Engine should fall through to the
    // next eligible detector instead of returning that tip. We
    // suppress notes-encouragement too so we can isolate the
    // skip behavior — the sparse board has 79 empties which
    // would otherwise trigger that lower-priority tip.
    const input = makeUserPlacedInput("550000000".padEnd(81, "0"), {
      elapsedMs: 60_000, // past warmup
      suppressedKinds: new Set<CoachTipKind>([
        "conflict-explainer",
        "notes-encouragement",
      ]),
    });
    const tip = extractTip(input);
    // No remaining detector is eligible.
    expect(tip).toBeNull();
  });
});

describe("conflict-explainer detector", () => {
  it("fires for a row-duplicate", () => {
    // Two 5s in row 0 — both treated as player placements via
    // makeUserPlacedInput (empty fixed mask).
    const input = makeUserPlacedInput("550000000".padEnd(81, "0"));
    const tip = extractTip(input);
    expect(tip?.kind).toBe("conflict-explainer");
    expect(tip?.message).toMatch(/5 clashes with another 5 in row 1\./);
    expect(tip?.severity).toBe("warn");
    // Anchor is the LOWEST-indexed conflict cell — cell 0.
    expect(tip?.focusCell).toBe(0);
  });

  it("fires for a column-duplicate", () => {
    // 7 at (0,0) and (1,0) — column 0 conflict, no row clash.
    const board = new Uint8Array(BOARD_SIZE);
    board[0] = 7;
    board[9] = 7;
    const fixed = new Uint8Array(BOARD_SIZE);
    const input: CoachTipInput = {
      ...makeTestInput("0".repeat(81)),
      board,
      fixed,
      conflicts: findConflicts(board),
    };
    const tip = extractTip(input);
    expect(tip?.kind).toBe("conflict-explainer");
    expect(tip?.message).toMatch(/7 clashes with another 7 in column 1\./);
    expect(tip?.focusCell).toBe(0);
  });

  it("fires for a box-duplicate", () => {
    // 4 at (0,0) and (1,1) — same 3×3 box, different row, different col.
    const board = new Uint8Array(BOARD_SIZE);
    board[0] = 4;
    board[10] = 4;
    const fixed = new Uint8Array(BOARD_SIZE);
    const input: CoachTipInput = {
      ...makeTestInput("0".repeat(81)),
      board,
      fixed,
      conflicts: findConflicts(board),
    };
    const tip = extractTip(input);
    expect(tip?.kind).toBe("conflict-explainer");
    expect(tip?.message).toMatch(/3×3 box/);
  });

  it("ignores conflicts on clue cells (puzzle-bug guard)", () => {
    // Put 5 at cell 0 (a clue) and 5 at cell 1 (also a clue, in
    // an artificial fixture). Both are fixed → the detector
    // skips the anchor. We also suppress notes-encouragement
    // because the otherwise-empty board would trigger it as a
    // lower-priority fallback; we want to assert specifically
    // that the conflict tip was skipped.
    const board = new Uint8Array(BOARD_SIZE);
    board[0] = 5;
    board[1] = 5;
    const fixed = new Uint8Array(BOARD_SIZE);
    fixed[0] = 1;
    fixed[1] = 1;
    const input: CoachTipInput = {
      ...makeTestInput("0".repeat(81)),
      board,
      fixed,
      conflicts: findConflicts(board),
      suppressedKinds: new Set<CoachTipKind>(["notes-encouragement"]),
    };
    expect(extractTip(input)).toBeNull();
  });

  it("returns null when the conflict set is empty", () => {
    const input = makeTestInput(PUZZLE);
    // PUZZLE is conflict-free; only the original-clue detectors
    // could fire, none of which are eligible here.
    expect(extractTip(input)?.kind).not.toBe("conflict-explainer");
  });
});

describe("technique-followup detector", () => {
  // Build a base input PAST the warmup window with no conflicts
  // and no other eligible signal so we can isolate this detector.
  function base(): CoachTipInput {
    return makeTestInput(PUZZLE, {
      elapsedMs: 60_000,
      totalNotesPlaced: 100, // disqualify notes-encouragement
    });
  }

  it("fires inside the followup window with a naked-single hint", () => {
    const input: CoachTipInput = {
      ...base(),
      lastHintAtMs: 55_000, // 5s ago
      lastHintTechnique: "naked-single",
      hintsUsed: 1,
    };
    const tip = extractTip(input);
    expect(tip?.kind).toBe("technique-followup");
    expect(tip?.message).toMatch(/Naked Single/);
    expect(tip?.severity).toBe("info");
  });

  it("fires inside the followup window with a hidden-single hint", () => {
    const input: CoachTipInput = {
      ...base(),
      lastHintAtMs: 50_000, // 10s ago
      lastHintTechnique: "hidden-single",
      hintsUsed: 1,
    };
    const tip = extractTip(input);
    expect(tip?.kind).toBe("technique-followup");
    expect(tip?.message).toMatch(/Hidden Single/);
  });

  it("does NOT fire after the followup window expires", () => {
    const input: CoachTipInput = {
      ...base(),
      lastHintAtMs: 1_000, // far past the 15s window
      lastHintTechnique: "naked-single",
      hintsUsed: 1,
    };
    const tip = extractTip(input);
    expect(tip?.kind).not.toBe("technique-followup");
  });

  it("does NOT fire for from-solution hints (no teachable technique)", () => {
    const input: CoachTipInput = {
      ...base(),
      lastHintAtMs: 55_000,
      lastHintTechnique: "from-solution",
      hintsUsed: 1,
    };
    const tip = extractTip(input);
    expect(tip?.kind).not.toBe("technique-followup");
  });

  it("does NOT fire when no hint has been used yet", () => {
    const input = base();
    expect(extractTip(input)?.kind).not.toBe("technique-followup");
  });
});

describe("mistake-streak detector", () => {
  // Helper: build N value-events for the SAME cell at increasing
  // timestamps inside the streak window. We use the same cell for
  // simplicity — the detector counts events, not unique cells.
  function makeMistakes(n: number, baseT: number): CoachTipInput["events"] {
    const out: CoachTipInput["events"][number][] = [];
    for (let i = 0; i < n; i++) {
      out.push({ c: 4, d: 1, t: baseT + i * 1_000, k: "v" });
    }
    return out;
  }

  it("fires when 3+ wrong placements happen inside the window (with solution)", () => {
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: 90_000,
        solution: SOLUTION,
        totalNotesPlaced: 100, // disqualify notes-encouragement
      }),
      // Cell 4 in PUZZLE is a 7 clue; SOLUTION at cell 4 is also 7.
      // Placing 1 there is wrong relative to the solution → counts
      // as a mistake. Three at t=10s/11s/12s, well inside the 90s
      // window from elapsedMs=90s.
      events: makeMistakes(3, 10_000),
    };
    const tip = extractTip(input);
    expect(tip?.kind).toBe("mistake-streak");
    expect(tip?.message).toMatch(/3 wrong placements/);
  });

  it("fires when 3+ conflict-causing placements happen inside the window (no solution)", () => {
    const conflicts = new Set<number>([4]);
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: 90_000,
        solution: null,
        totalNotesPlaced: 100,
      }),
      conflicts,
      events: makeMistakes(3, 10_000),
    };
    const tip = extractTip(input);
    expect(tip?.kind).toBe("mistake-streak");
  });

  it("does NOT fire below the threshold", () => {
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: 90_000,
        solution: SOLUTION,
        totalNotesPlaced: 100,
      }),
      events: makeMistakes(2, 10_000),
    };
    expect(extractTip(input)?.kind).not.toBe("mistake-streak");
  });

  it("excludes events outside the sliding window", () => {
    // Three mistakes at t=1s, well outside the (elapsedMs - 90s)
    // window when elapsedMs is 5 minutes.
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: 5 * 60 * 1000,
        solution: SOLUTION,
        totalNotesPlaced: 100,
      }),
      events: makeMistakes(3, 1_000),
    };
    expect(extractTip(input)?.kind).not.toBe("mistake-streak");
  });

  it("ignores erase events even inside the window", () => {
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: 90_000,
        solution: SOLUTION,
        totalNotesPlaced: 100,
      }),
      events: [
        { c: 4, d: 0, t: 80_000, k: "e" },
        { c: 4, d: 0, t: 81_000, k: "e" },
        { c: 4, d: 0, t: 82_000, k: "e" },
      ],
    };
    expect(extractTip(input)?.kind).not.toBe("mistake-streak");
  });

  it("ignores hint-applied placements even inside the window", () => {
    // Hint placements aren't "the player's mistake" — anti-cheat
    // signal aside, they're a system action. Detector should
    // skip them.
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: 90_000,
        solution: SOLUTION,
        totalNotesPlaced: 100,
      }),
      events: [
        { c: 4, d: 1, t: 80_000, k: "h" },
        { c: 4, d: 1, t: 81_000, k: "h" },
        { c: 4, d: 1, t: 82_000, k: "h" },
      ],
    };
    expect(extractTip(input)?.kind).not.toBe("mistake-streak");
  });
});

describe("notes-encouragement detector", () => {
  // Helper: a board with a LOT of empty cells (well past the
  // 30-empty-cells gate). PUZZLE has 49 empties so we can use
  // it directly.
  function base(): CoachTipInput {
    return makeTestInput(PUZZLE, {
      elapsedMs: COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS + 1_000,
      notesModeOn: false,
      totalNotesPlaced: 0,
    });
  }

  it("fires when the player is mid-game with no notes", () => {
    const tip = extractTip(base());
    expect(tip?.kind).toBe("notes-encouragement");
    expect(tip?.message).toMatch(/Notes mode/i);
  });

  it("does NOT fire when the player is already using notes mode", () => {
    const input = { ...base(), notesModeOn: true };
    expect(extractTip(input)?.kind).not.toBe("notes-encouragement");
  });

  it("does NOT fire when the player has already placed notes", () => {
    const input = { ...base(), totalNotesPlaced: 12 };
    expect(extractTip(input)?.kind).not.toBe("notes-encouragement");
  });

  it("does NOT fire when too few empty cells remain", () => {
    // 81-char string of all 1s (no empties) — well below the
    // 30-empty-cells gate.
    const input = makeTestInput("1".repeat(81), {
      elapsedMs: COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS + 1_000,
      notesModeOn: false,
      totalNotesPlaced: 0,
    });
    expect(extractTip(input)?.kind).not.toBe("notes-encouragement");
  });

  it("does NOT fire before the min-elapsed gate", () => {
    const input = {
      ...base(),
      elapsedMs: COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS - 1_000,
    };
    expect(extractTip(input)?.kind).not.toBe("notes-encouragement");
  });
});

describe("priority resolution between detectors", () => {
  it("conflict-explainer wins over technique-followup when both are eligible", () => {
    // A live conflict + a recent hint. Conflict is higher
    // priority → that's the tip the player sees.
    const input: CoachTipInput = {
      ...makeUserPlacedInput("550000000".padEnd(81, "0"), {
        elapsedMs: 60_000,
      }),
      lastHintAtMs: 55_000,
      lastHintTechnique: "naked-single",
      hintsUsed: 1,
    };
    expect(extractTip(input)?.kind).toBe("conflict-explainer");
  });

  it("technique-followup wins over notes-encouragement when both are eligible", () => {
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs: COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS + 1_000,
        notesModeOn: false,
        totalNotesPlaced: 0,
      }),
      lastHintAtMs:
        COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS - 5_000,
      lastHintTechnique: "naked-single",
      hintsUsed: 1,
    };
    expect(extractTip(input)?.kind).toBe("technique-followup");
  });

  it("falls through to notes-encouragement when higher-priority kinds are suppressed", () => {
    const boardStr = "550000000".padEnd(81, "0");
    // Construct an input where both conflict-explainer AND
    // technique-followup would normally fire, but they're
    // suppressed. Notes-encouragement should win — except this
    // fixture doesn't have ENOUGH empty cells (PUZZLE proper
    // does, but we used a sparse board for the conflict). Use
    // PUZZLE + an injected fake conflict instead.
    const input: CoachTipInput = {
      ...makeTestInput(PUZZLE, {
        elapsedMs:
          COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS + 1_000,
        notesModeOn: false,
        totalNotesPlaced: 0,
      }),
      conflicts: new Set([1]),
      lastHintAtMs:
        COACH_TIP_TUNABLES.NOTES_ENCOURAGEMENT_MIN_ELAPSED_MS - 5_000,
      lastHintTechnique: "naked-single",
      hintsUsed: 1,
      suppressedKinds: new Set<CoachTipKind>([
        "conflict-explainer",
        "technique-followup",
        "mistake-streak",
      ]),
      // Ignore boardStr declared above; the test reuses PUZZLE.
    };
    void boardStr;
    expect(extractTip(input)?.kind).toBe("notes-encouragement");
  });
});

describe("acceptance criterion — determinism", () => {
  it("returns the SAME tip for the SAME input on repeated calls", () => {
    const input = makeUserPlacedInput("550000000".padEnd(81, "0"));
    const a = extractTip(input);
    const b = extractTip(input);
    const c = extractTip(input);
    expect(a).not.toBeNull();
    // Pure function — every field, including dedupeKey, must be
    // bit-identical across calls. We compare with toEqual rather
    // than toBe (the engine returns a fresh object) but the
    // contents must match exactly.
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it("dedupeKey is stable across calls and embeds the discriminator", () => {
    const input = makeUserPlacedInput("550000000".padEnd(81, "0"));
    const tip = extractTip(input);
    expect(tip?.dedupeKey).toBe("conflict-explainer:0:5:row:0");
  });
});
