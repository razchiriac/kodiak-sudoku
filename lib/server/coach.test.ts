import { describe, it, expect } from "vitest";
import { parseBoard } from "@/lib/sudoku/board";
import { nextHint } from "@/lib/sudoku/solver";
import {
  buildCoachPrompt,
  deterministicCoach,
  generateCoaching,
  validateSuggestion,
  CoachInputSchema,
  CoachOutputSchema,
  COACH_RESPONSE_JSON_SCHEMA,
  COACH_TECHNIQUES,
  COACH_TONES,
  type CoachInput,
} from "./coach";

// RAZ-58 — Unit tests for the AI Coach engine.
//
// Coverage philosophy:
//   1. validateSuggestion gets the deepest coverage. It's the load-
//      bearing safety net — every other piece of the feature trusts
//      that this function will reject hallucinated moves. Each
//      rejection branch (already-filled cell, illegal placement,
//      wrong digit, missing solution, null suggestion) gets its own
//      explicit test.
//   2. The PROMPT BUILDER tested for shape AND for what it must NOT
//      contain (no solution leak, no per-cell history).
//   3. The DETERMINISTIC FALLBACK exercised for the all-the-knobs
//      cases (mistakes/hints high → constructive tone, clean →
//      celebratory, no-hint → generic scanning copy).
//   4. The ORCHESTRATOR tested for every fallback branch — no
//      client, force-fallback, model throws, malformed JSON,
//      schema-invalid, timeout, AI-validates-fine,
//      AI-proposes-but-rejected. The orchestrator NEVER throws.

// Canonical fixture re-used from solver.test.ts. Hand-checked Easy
// puzzle with a known unique solution. Every test that needs a
// (board, solution) pair starts from these constants.
const PUZZLE =
  "530070000600195000098000060800060003400803001700020006060000280000419005000080079";
const SOLUTION =
  "534678912672195348198342567859761423426853791713924856961537284287419635345286179";

const VARIANT = "standard" as const;

function easyInput(overrides: Partial<CoachInput> = {}): CoachInput {
  return {
    board: PUZZLE,
    difficultyBucket: 1,
    variant: VARIANT,
    mode: "random",
    selected: null,
    mistakesSoFar: 0,
    hintsUsedSoFar: 0,
    ...overrides,
  };
}

describe("CoachInputSchema", () => {
  it("accepts a well-formed input", () => {
    const out = CoachInputSchema.safeParse(easyInput());
    expect(out.success).toBe(true);
  });

  it("rejects boards of the wrong length", () => {
    const out = CoachInputSchema.safeParse({ ...easyInput(), board: "12345" });
    expect(out.success).toBe(false);
  });

  it("rejects boards with non-digit characters", () => {
    // Replace one cell with a letter — schema regex must catch it.
    const bad = "X" + PUZZLE.slice(1);
    const out = CoachInputSchema.safeParse({ ...easyInput(), board: bad });
    expect(out.success).toBe(false);
  });

  it("rejects an out-of-range selected cell", () => {
    const out = CoachInputSchema.safeParse({ ...easyInput(), selected: 81 });
    expect(out.success).toBe(false);
  });

  it("rejects an unknown variant", () => {
    // safeParse takes `unknown`, so cast through unknown to exercise
    // the runtime guard rather than the TS one.
    const out = CoachInputSchema.safeParse({
      ...easyInput(),
      variant: "killer" as unknown as never,
    });
    expect(out.success).toBe(false);
  });

  it("rejects negative mistake counts", () => {
    const out = CoachInputSchema.safeParse({ ...easyInput(), mistakesSoFar: -1 });
    expect(out.success).toBe(false);
  });
});

describe("CoachOutputSchema", () => {
  it("accepts a fully-populated output", () => {
    const out = CoachOutputSchema.safeParse({
      message: "Try placing 4 at row 1, column 3.",
      rationale: "Naked single — no other digit fits.",
      tone: "encouraging",
      suggestion: { cellIndex: 2, digit: 4, technique: "naked-single" },
    });
    expect(out.success).toBe(true);
  });

  it("accepts a null suggestion", () => {
    const out = CoachOutputSchema.safeParse({
      message: "Scan each box methodically.",
      rationale: "No clean single move is visible right now.",
      tone: "encouraging",
      suggestion: null,
    });
    expect(out.success).toBe(true);
  });

  it("rejects a message longer than the cap", () => {
    const out = CoachOutputSchema.safeParse({
      message: "x".repeat(500),
      rationale: "ok",
      tone: "encouraging",
      suggestion: null,
    });
    expect(out.success).toBe(false);
  });

  it("rejects an unknown technique label", () => {
    const out = CoachOutputSchema.safeParse({
      message: "ok",
      rationale: "ok",
      tone: "encouraging",
      suggestion: {
        cellIndex: 0,
        digit: 1,
        technique: "x-wing" as unknown as never,
      },
    });
    expect(out.success).toBe(false);
  });
});

describe("buildCoachPrompt", () => {
  it("includes the difficulty, mistakes, and hints metrics", () => {
    const prompt = buildCoachPrompt(
      easyInput({ difficultyBucket: 3, mistakesSoFar: 2, hintsUsedSoFar: 1 }),
    );
    expect(prompt).toContain("Difficulty bucket: 3");
    expect(prompt).toContain("Mistakes so far: 2");
    expect(prompt).toContain("Hints used so far: 1");
  });

  it("renders the board as a 9-line dotted grid (no leak of solution)", () => {
    const prompt = buildCoachPrompt(easyInput());
    // The prompt must NEVER contain the solution string verbatim —
    // that's the entire point of the sanitization contract.
    expect(prompt).not.toContain(SOLUTION);
    // Count newlines: header lines + 9 board lines + footer.
    // Easier to assert the empty-cell placeholder is present at least
    // once (the canonical PUZZLE has plenty of empties).
    expect(prompt).toContain(".");
    // Spot-check a known clue from PUZZLE: row 1 col 1 is '5'.
    expect(prompt).toMatch(/5\s+3\s+\.\s+\.\s+7/);
  });

  it("formats the selected cell as a 1-indexed (row, col) hint", () => {
    // selected = 0 → row 1, col 1.
    const prompt = buildCoachPrompt(easyInput({ selected: 0 }));
    expect(prompt).toContain("row 1");
    expect(prompt).toContain("column 1");
  });

  it("calls out the diagonal variant when set", () => {
    const prompt = buildCoachPrompt(easyInput({ variant: "diagonal" }));
    expect(prompt).toContain("DIAGONAL");
  });

  it("describes the 'no selected cell' state when selected is null", () => {
    const prompt = buildCoachPrompt(easyInput({ selected: null }));
    expect(prompt).toContain("Selected cell: none");
  });
});

describe("validateSuggestion — the safety net", () => {
  // A known empty cell in PUZZLE that the SOLUTION fills with 4:
  // Index 2 (row 1, col 3) → solution[2] === '4'.
  const EMPTY_CELL_INDEX = 2;
  const CORRECT_DIGIT = 4;

  it("returns null when no suggestion is given", () => {
    const board = parseBoard(PUZZLE);
    const result = validateSuggestion(board, SOLUTION, null, VARIANT);
    expect(result).toBeNull();
  });

  it("returns null when the solution is missing", () => {
    const board = parseBoard(PUZZLE);
    const result = validateSuggestion(
      board,
      null,
      { cellIndex: EMPTY_CELL_INDEX, digit: CORRECT_DIGIT, technique: "naked-single" },
      VARIANT,
    );
    expect(result).toBeNull();
  });

  it("returns null when the solution string has the wrong length", () => {
    const board = parseBoard(PUZZLE);
    const result = validateSuggestion(
      board,
      "12345",
      { cellIndex: EMPTY_CELL_INDEX, digit: CORRECT_DIGIT, technique: "naked-single" },
      VARIANT,
    );
    expect(result).toBeNull();
  });

  it("returns null when the target cell already has a value (clue overwrite)", () => {
    const board = parseBoard(PUZZLE);
    // Index 0 is a clue ('5' in PUZZLE). Try to overwrite it with the
    // SOLUTION digit at that cell — still a clue overwrite, must be
    // dropped regardless of digit value.
    const solutionDigit = SOLUTION.charCodeAt(0) - 48;
    const result = validateSuggestion(
      board,
      SOLUTION,
      { cellIndex: 0, digit: solutionDigit, technique: "naked-single" },
      VARIANT,
    );
    expect(result).toBeNull();
  });

  it("returns null when the placement is illegal (would conflict with the row)", () => {
    const board = parseBoard(PUZZLE);
    // Find an empty cell in row 1 (indices 0..8). Row 1 already
    // contains a 5 at index 0. Placing a 5 in any other empty cell
    // of row 1 must be rejected as illegal — even though the solution
    // value at that cell is something else, the model would still be
    // proposing a clearly conflicting move.
    const result = validateSuggestion(
      board,
      SOLUTION,
      { cellIndex: EMPTY_CELL_INDEX, digit: 5, technique: "naked-single" },
      VARIANT,
    );
    expect(result).toBeNull();
  });

  it("returns null when the digit doesn't match the puzzle solution at that cell (HALLUCINATION CASE)", () => {
    const board = parseBoard(PUZZLE);
    // Row 1 col 3 (idx 2) — solution is 4. Try to place 1 (not in
    // row 1, not in col 3, not in box 1, so isLegalPlacement passes).
    // But the SOLUTION says 4 there. validateSuggestion must reject.
    // This is the load-bearing test: a model that hallucinates a
    // digit which happens to be locally legal still gets dropped.
    const result = validateSuggestion(
      board,
      SOLUTION,
      { cellIndex: EMPTY_CELL_INDEX, digit: 1, technique: "naked-single" },
      VARIANT,
    );
    expect(result).toBeNull();
  });

  it("passes through a move that matches both the solver and the solution (validatedBy: 'solver')", () => {
    const board = parseBoard(PUZZLE);
    // Find a cell where the deterministic solver agrees. We know
    // PUZZLE has at least one naked single because the canonical
    // solver tests use it. Use the well-known fact: row 4 col 6
    // (idx 32) — let's verify against the actual solver result so
    // the test is robust to fixture changes.
    // Easier: ASK the solver what it'd suggest, then validate that
    // exact move. Tautology? No — we're verifying the validator
    // CORRECTLY tags solver-agreement, not just that it returns
    // something.
    const hint = nextHint(board, { solution: SOLUTION, variant: VARIANT });
    expect(hint).not.toBeNull();
    if (!hint) return;
    const result = validateSuggestion(
      board,
      SOLUTION,
      { cellIndex: hint.index, digit: hint.digit, technique: "naked-single" },
      VARIANT,
    );
    expect(result).not.toBeNull();
    expect(result?.cellIndex).toBe(hint.index);
    expect(result?.digit).toBe(hint.digit);
    expect(result?.validatedBy).toBe("solver");
  });

  it("tags 'solution' when the move is correct but isn't the solver's first pick", () => {
    const board = parseBoard(PUZZLE);
    // Pick any empty cell whose solution digit is locally legal, but
    // is NOT what the solver picks first. The solver scans cells in
    // index order and almost always finds a naked or hidden single
    // in the FIRST few empty cells. To force the "solution"-only
    // tag, we need an empty cell whose deterministic next-hint is
    // NOT this cell. We dynamically pick a late-row empty cell so
    // future fixture changes don't silently break this test.
    const board0 = parseBoard(PUZZLE);
    const solverPick = nextHint(board0, { solution: SOLUTION, variant: VARIANT });
    expect(solverPick).not.toBeNull();
    if (!solverPick) return;
    // Walk the board from the END and pick the first empty cell that
    // ISN'T what the solver picked first.
    let lateCellIdx = -1;
    for (let i = 80; i >= 0; i--) {
      if (board[i] === 0 && i !== solverPick.index) {
        lateCellIdx = i;
        break;
      }
    }
    expect(lateCellIdx).toBeGreaterThanOrEqual(0);
    const lateDigit = SOLUTION.charCodeAt(lateCellIdx) - 48;

    const result = validateSuggestion(
      board,
      SOLUTION,
      { cellIndex: lateCellIdx, digit: lateDigit, technique: "general" },
      VARIANT,
    );
    // The solver would not pick this exact cell as its first nudge,
    // but the digit IS the right one. Validator should accept and
    // tag "solution".
    // (This assumes the chosen late cell is also a legal placement
    // on the board; for the canonical fixture all empty cells are
    // legally fillable with their solution digit by definition.)
    expect(result).not.toBeNull();
    expect(result?.cellIndex).toBe(lateCellIdx);
    expect(result?.digit).toBe(lateDigit);
    expect(result?.validatedBy).toBe("solution");
  });

  it("preserves the technique label on a validated suggestion", () => {
    // Reuse the same late-cell strategy as the previous test so the
    // fixture is robust to future reordering of solver picks.
    const board = parseBoard(PUZZLE);
    const solverPick = nextHint(board, { solution: SOLUTION, variant: VARIANT });
    if (!solverPick) return;
    let lateCellIdx = -1;
    for (let i = 80; i >= 0; i--) {
      if (board[i] === 0 && i !== solverPick.index) {
        lateCellIdx = i;
        break;
      }
    }
    const lateDigit = SOLUTION.charCodeAt(lateCellIdx) - 48;
    const result = validateSuggestion(
      board,
      SOLUTION,
      { cellIndex: lateCellIdx, digit: lateDigit, technique: "scanning" },
      VARIANT,
    );
    expect(result?.technique).toBe("scanning");
  });
});

describe("deterministicCoach", () => {
  it("returns a card with source 'deterministic' that includes a validated suggestion", () => {
    const card = deterministicCoach(easyInput(), SOLUTION);
    expect(card.source).toBe("deterministic");
    expect(card.suggestion).not.toBeNull();
    // The fallback wraps nextHint, so the suggestion must always
    // tag as "solver" (or "solution" for from-solution fallbacks).
    expect(["solver", "solution"]).toContain(card.suggestion?.validatedBy);
  });

  it("uses celebratory tone when the player has zero mistakes and zero hints", () => {
    const card = deterministicCoach(
      easyInput({ mistakesSoFar: 0, hintsUsedSoFar: 0 }),
      SOLUTION,
    );
    expect(card.tone).toBe("celebratory");
  });

  it("uses constructive tone when mistakes are stacking up", () => {
    const card = deterministicCoach(
      easyInput({ mistakesSoFar: 5, hintsUsedSoFar: 0 }),
      SOLUTION,
    );
    expect(card.tone).toBe("constructive");
  });

  it("uses constructive tone when hints have been heavy", () => {
    const card = deterministicCoach(
      easyInput({ mistakesSoFar: 0, hintsUsedSoFar: 6 }),
      SOLUTION,
    );
    expect(card.tone).toBe("constructive");
  });

  it("uses encouraging tone in the middle ground", () => {
    const card = deterministicCoach(
      easyInput({ mistakesSoFar: 1, hintsUsedSoFar: 1 }),
      SOLUTION,
    );
    expect(card.tone).toBe("encouraging");
  });

  it("returns generic scanning copy when nextHint returns null (solved board)", () => {
    // SOLUTION as the board → no empty cells → nextHint returns null.
    const card = deterministicCoach(
      easyInput({ board: SOLUTION }),
      SOLUTION,
    );
    expect(card.suggestion).toBeNull();
    expect(card.message.toLowerCase()).toMatch(/scan|spent/);
  });

  it("still returns a valid card with no solution available (custom puzzle case)", () => {
    // Pre-RAZ-58 plumbing only invokes us with a solution, but
    // future custom-puzzle support might call without one. Make sure
    // we don't blow up — we degrade to "no suggestion" prose.
    const card = deterministicCoach(easyInput(), null);
    // No solution → nextHint can't compute fromSolution; depending on
    // the puzzle it MIGHT still find a naked/hidden single. Either
    // way the card must validate.
    expect(card.tone).toBeDefined();
    expect(card.message.length).toBeGreaterThan(0);
    expect(card.rationale.length).toBeGreaterThan(0);
  });
});

describe("COACH_RESPONSE_JSON_SCHEMA", () => {
  it("declares strict mode and the right required fields", () => {
    expect(COACH_RESPONSE_JSON_SCHEMA.strict).toBe(true);
    expect(COACH_RESPONSE_JSON_SCHEMA.schema.required).toEqual([
      "message",
      "rationale",
      "tone",
      "suggestion",
    ]);
    expect(COACH_RESPONSE_JSON_SCHEMA.schema.additionalProperties).toBe(false);
  });

  it("keeps the technique enum aligned with the runtime constant", () => {
    const schemaTechniques =
      COACH_RESPONSE_JSON_SCHEMA.schema.properties.suggestion.properties.technique.enum;
    expect(new Set(schemaTechniques)).toEqual(new Set(COACH_TECHNIQUES));
  });

  it("keeps the tone enum aligned with the runtime constant", () => {
    const schemaTones = COACH_RESPONSE_JSON_SCHEMA.schema.properties.tone.enum;
    expect(new Set(schemaTones)).toEqual(new Set(COACH_TONES));
  });
});

describe("generateCoaching — orchestrator fallbacks", () => {
  it("returns the deterministic fallback when no client is given", async () => {
    const out = await generateCoaching(easyInput(), SOLUTION);
    expect(out.card.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("no-client");
  });

  it("returns the deterministic fallback when forceFallback is true", async () => {
    const out = await generateCoaching(easyInput(), SOLUTION, {
      forceFallback: true,
      client: {} as never,
    });
    expect(out.card.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("force-fallback");
  });

  it("falls back when the model call throws", async () => {
    const client = {
      chat: {
        completions: {
          create: () => Promise.reject(new Error("network down")),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, { client });
    expect(out.card.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("model-error");
  });

  it("falls back when the model returns malformed JSON", async () => {
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [{ message: { content: "not even close to JSON" } }],
            }),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, { client });
    expect(out.card.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("model-error");
  });

  it("falls back when JSON is valid but schema is wrong", async () => {
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      message: "ok",
                      // missing rationale, missing tone, etc.
                      suggestion: null,
                    }),
                  },
                },
              ],
            }),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, { client });
    expect(out.card.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("schema-invalid");
  });

  it("falls back when the model takes longer than timeoutMs", async () => {
    const client = {
      chat: {
        completions: {
          create: () =>
            new Promise((resolve) =>
              setTimeout(
                () =>
                  resolve({
                    choices: [
                      {
                        message: {
                          content: JSON.stringify({
                            message: "ok",
                            rationale: "ok",
                            tone: "encouraging",
                            suggestion: null,
                          }),
                        },
                      },
                    ],
                  }),
                500,
              ),
            ),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, {
      client,
      timeoutMs: 50,
    });
    expect(out.card.source).toBe("deterministic");
    expect(out.fallbackReason).toBe("timeout");
  });

  it("returns the AI card verbatim when the suggestion validates", async () => {
    // Use the solver to pick a known-good move, then have the mock
    // model return that exact move. Validator must accept and tag
    // 'solver'; orchestrator must report no fallbackReason.
    const board = parseBoard(PUZZLE);
    const hint = nextHint(board, { solution: SOLUTION, variant: VARIANT });
    expect(hint).not.toBeNull();
    if (!hint) return;
    const aiResponse = {
      message: "Try placing the deduced digit in the highlighted cell.",
      rationale: "It's the only legal value in that cell.",
      tone: "encouraging" as const,
      suggestion: {
        cellIndex: hint.index,
        digit: hint.digit,
        technique: "naked-single" as const,
      },
    };
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(aiResponse) } }],
            }),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, { client });
    expect(out.fallbackReason).toBeUndefined();
    expect(out.card.source).toBe("ai");
    expect(out.card.suggestion?.cellIndex).toBe(hint.index);
    expect(out.card.suggestion?.digit).toBe(hint.digit);
    expect(out.card.suggestion?.validatedBy).toBe("solver");
  });

  it("KEEPS the AI prose but DROPS a hallucinated suggestion (safety contract)", async () => {
    // The model returns a syntactically-valid card but the proposed
    // digit doesn't match the solution at that cell. Orchestrator
    // must still ship the message + rationale (those carry no
    // safety risk) but DROP the suggestion AND emit the
    // 'suggestion-rejected' fallback reason for telemetry.
    const aiResponse = {
      message: "Look at row 1 — the 4 has only one home.",
      rationale: "Hidden single in row 1.",
      tone: "encouraging" as const,
      suggestion: {
        cellIndex: 2, // empty cell
        digit: 1, // solution at idx 2 is 4 — this is wrong
        technique: "hidden-single" as const,
      },
    };
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(aiResponse) } }],
            }),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, { client });
    expect(out.card.source).toBe("ai");
    expect(out.card.message).toContain("Look at row 1");
    expect(out.card.rationale).toContain("Hidden single");
    expect(out.card.suggestion).toBeNull();
    expect(out.fallbackReason).toBe("suggestion-rejected");
  });

  it("accepts an AI card with a deliberately null suggestion (no flag set)", async () => {
    // Sometimes the model legitimately decides not to suggest a
    // move. That's not a rejection — there's nothing to validate
    // and the prose still ships.
    const aiResponse = {
      message: "Take a slow scan of each row before placing anything.",
      rationale: "No clean single is available right now.",
      tone: "encouraging" as const,
      suggestion: null,
    };
    const client = {
      chat: {
        completions: {
          create: () =>
            Promise.resolve({
              choices: [{ message: { content: JSON.stringify(aiResponse) } }],
            }),
        },
      },
    } as never;
    const out = await generateCoaching(easyInput(), SOLUTION, { client });
    expect(out.card.source).toBe("ai");
    expect(out.card.suggestion).toBeNull();
    expect(out.fallbackReason).toBeUndefined();
  });
});
