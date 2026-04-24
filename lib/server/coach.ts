import type OpenAI from "openai";
import { z } from "zod";
import {
  BOARD_SIZE,
  type Board,
  type Variant,
  parseBoard,
} from "@/lib/sudoku/board";
import { nextHint, type HintSuggestion } from "@/lib/sudoku/solver";
import { isLegalPlacement } from "@/lib/sudoku/validate";

// RAZ-58 — Pure AI Coach engine.
//
// This module is intentionally framework-free (no `server-only`, no
// DB, no React). The whole reason for that split is the validation
// guard below: it's the load-bearing safety net for the entire
// feature, so it MUST be unit-testable in isolation without spinning
// up a Next.js runtime or a Postgres client.
//
// What lives here:
//   1. CoachInputSchema / CoachInput — the sanitized payload the
//      action passes in. The board IS sent to the model (the whole
//      point of a contextual coach is that it sees the position),
//      but the SOLUTION is never sent — the model has to deduce its
//      own move just like a human would, and we then verify against
//      the solution server-side before showing the move to the user.
//   2. CoachOutputSchema / CoachOutput — the strict shape we accept
//      back from the model. A short prose nudge, a one-sentence
//      rationale, an OPTIONAL move suggestion, and a tone tag for
//      the UI. Anything that doesn't validate is dropped.
//   3. CoachCardSchema / CoachCard — what we return to the caller
//      after running validateSuggestion. Same shape as
//      CoachOutput, but the suggestion field is REPLACED with the
//      solver-validated version (or null when the model's move
//      didn't pass the guard).
//   4. validateSuggestion() — the safety net. Compares a model's
//      proposed move against (a) the deterministic next-hint and
//      (b) the puzzle's known solution. Drops any move that fails
//      both checks.
//   5. deterministicCoach() — fallback that wraps `nextHint` with a
//      canned, technique-keyed explanation. Always returns a valid
//      CoachCard so the UI never has a "nothing to render" path.
//   6. generateCoaching() — orchestrator. Calls the model with a
//      timeout, validates output, runs the suggestion through the
//      guard. Always returns a CoachCard.
//
// On the 2.5s p95 budget (RAZ-58 acceptance criterion):
//   - Promise.race against `timeoutMs` (default 2_500). On timeout
//     we serve the deterministic fallback, which means the UI
//     renders something within budget even when the model is slow.

// Inputs to the coach. The action layer assembles this from the
// client's submitted payload + the puzzle row from the DB.
//
// Why `selected` is here: the model uses it as soft context ("the
// player is staring at row 4 col 7") so it can prefer suggesting a
// move adjacent to where the player is looking. It's not required;
// the model can propose any cell.
//
// Why `mistakesSoFar` and `hintsUsedSoFar`: lets the model adjust
// tone — "this is your 4th mistake on this puzzle, let's slow down
// and look at boxes" lands very differently than "you're sailing
// through, here's a quick nudge".
export const CoachInputSchema = z.object({
  board: z.string().length(BOARD_SIZE).regex(/^[0-9]{81}$/),
  difficultyBucket: z.number().int().min(1).max(4),
  variant: z.enum(["standard", "diagonal"]),
  mode: z.enum(["daily", "random", "custom", "challenge", "quick"]),
  selected: z.number().int().min(0).max(80).nullable().optional(),
  mistakesSoFar: z.number().int().nonnegative(),
  hintsUsedSoFar: z.number().int().nonnegative(),
});

export type CoachInput = z.infer<typeof CoachInputSchema>;

// Tightened technique enum used in BOTH the model output schema and
// the deterministic fallback. We keep "general" as a permissive
// catch-all so the model isn't forced to mis-classify when its move
// doesn't fit a named technique.
export const COACH_TECHNIQUES = [
  "naked-single",
  "hidden-single",
  "scanning",
  "pair",
  "general",
] as const;

export const COACH_TONES = ["encouraging", "constructive", "celebratory"] as const;

// Length caps. Tight enough to keep cost bounded AND to keep the UI
// card from sprawling on a phone — the dialog has finite real estate.
export const MESSAGE_MAX_CHARS = 220;
export const RATIONALE_MAX_CHARS = 220;

// Strict shape the model is contracted to return. `suggestion` is
// optional/nullable because not every coach response needs to commit
// to a move (e.g. encouragement near completion).
export const CoachOutputSchema = z.object({
  message: z.string().min(1).max(MESSAGE_MAX_CHARS),
  rationale: z.string().min(1).max(RATIONALE_MAX_CHARS),
  tone: z.enum(COACH_TONES),
  suggestion: z
    .object({
      cellIndex: z.number().int().min(0).max(80),
      digit: z.number().int().min(1).max(9),
      technique: z.enum(COACH_TECHNIQUES),
    })
    .nullable(),
});

export type CoachOutput = z.infer<typeof CoachOutputSchema>;

// What the orchestrator returns. Same shape as CoachOutput but the
// suggestion is OVERRIDDEN with the validated version (which carries
// a `validatedBy` tag the UI can show as a trust signal). When the
// model's move doesn't validate, suggestion is null.
//
// `source` is set by generateCoaching itself (NOT the model) so the
// UI can label the card honestly ("AI tip" vs "From the solver").
export type CoachCard = {
  message: string;
  rationale: string;
  tone: (typeof COACH_TONES)[number];
  suggestion: ValidatedSuggestion | null;
  source: "ai" | "deterministic";
};

// What survives the validation guard. The `validatedBy` discriminator
// tells the UI whether the model and the deterministic solver
// AGREED on the move (highest-confidence: "solver"), or whether the
// move just happens to be correct against the puzzle solution but
// wasn't the next deductive step ("solution"). Both are safe to
// place on the board; the tag is purely informational.
export type ValidatedSuggestion = {
  cellIndex: number;
  digit: number;
  technique: (typeof COACH_TECHNIQUES)[number];
  validatedBy: "solver" | "solution";
};

// Build the prompt sent to the model. Pure: no I/O, returns a
// single string the orchestrator hands to the chat completion call.
//
// What we send:
//   - The board as a 9x9 grid of digits/dots (more readable than
//     the raw 81-char string).
//   - The variant (standard vs diagonal — affects the legal
//     placements the model has to keep in mind).
//   - The difficulty bucket, mistakes-so-far, and hints-used-so-far
//     so the model can calibrate tone.
//   - The selected cell as a "(row, col)" pair when present.
//
// What we DON'T send (and unit-test that we don't):
//   - The puzzle solution.
//   - Any per-move history.
//   - Any user identity.
export function buildCoachPrompt(input: CoachInput): string {
  const board = parseBoard(input.board);
  const grid = formatBoardForPrompt(board);
  const selectedLine =
    input.selected != null
      ? `Selected cell: row ${Math.floor(input.selected / 9) + 1}, ` +
        `column ${(input.selected % 9) + 1} (0-indexed cell ${input.selected}).`
      : "Selected cell: none — the player has not focused a specific cell.";
  const variantLine =
    input.variant === "diagonal"
      ? "Variant: DIAGONAL (the two main diagonals are extra constraint units; each must contain 1-9 exactly once)."
      : "Variant: standard 9x9.";

  return [
    `Difficulty bucket: ${input.difficultyBucket} (1=Easy, 2=Medium, 3=Hard, 4=Expert).`,
    `Mode: ${input.mode}.`,
    variantLine,
    `Mistakes so far: ${input.mistakesSoFar}.`,
    `Hints used so far: ${input.hintsUsedSoFar}.`,
    selectedLine,
    "",
    "Current board (9x9, 0-indexed; '.' = empty):",
    grid,
    "",
    "Task: produce a SHORT coach card.",
    "- `message`: 1-2 sentences, second person, ≤220 chars. Encouraging or constructive based on the player's signals.",
    "- `rationale`: ONE sentence, ≤220 chars, explaining the technique behind your suggestion (or general scanning advice if no suggestion).",
    "- `tone`: pick the tone tag that best fits.",
    "- `suggestion`: include ONLY when you can justify a single concrete next move. Leave null when no clear deduction is available.",
    "Never reveal the puzzle's full solution. Never invent a digit you cannot justify from the visible board.",
  ].join("\n");
}

// Format the board as a 9-line grid for the prompt. Empty cells
// render as '.' to make the structure scan-able by the model. We
// add a single space between columns so a 9x9 reads as a grid
// rather than a wall of digits.
function formatBoardForPrompt(board: Board): string {
  const lines: string[] = [];
  for (let r = 0; r < 9; r++) {
    const cells: string[] = [];
    for (let c = 0; c < 9; c++) {
      const v = board[r * 9 + c];
      cells.push(v === 0 ? "." : String(v));
    }
    lines.push(cells.join(" "));
  }
  return lines.join("\n");
}

// JSON schema mirror of CoachOutputSchema. OpenAI's structured
// outputs feature consumes this directly (response_format json_schema
// strict mode), giving us model-side schema enforcement before the
// payload even reaches our code. We still re-validate with Zod for
// belt-and-suspenders — model regressions and SDK schema drift have
// burned us before.
export const COACH_RESPONSE_JSON_SCHEMA = {
  name: "coach_card",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["message", "rationale", "tone", "suggestion"],
    properties: {
      message: { type: "string", minLength: 1, maxLength: MESSAGE_MAX_CHARS },
      rationale: { type: "string", minLength: 1, maxLength: RATIONALE_MAX_CHARS },
      tone: { type: "string", enum: [...COACH_TONES] },
      suggestion: {
        // OpenAI's strict mode requires every property in the schema
        // to be required, so we model "no suggestion" as a nullable
        // OBJECT rather than an optional field. Zod handles the same
        // shape on the parsing side.
        type: ["object", "null"],
        additionalProperties: false,
        required: ["cellIndex", "digit", "technique"],
        properties: {
          cellIndex: { type: "integer", minimum: 0, maximum: 80 },
          digit: { type: "integer", minimum: 1, maximum: 9 },
          technique: { type: "string", enum: [...COACH_TECHNIQUES] },
        },
      },
    },
  },
} as const;

// THE SAFETY NET. Verifies a model-proposed move against the puzzle's
// known solution and the deterministic solver. Returns the validated
// suggestion (with provenance tag) or `null` when the move can't be
// trusted. The orchestrator NEVER passes through an unvalidated
// suggestion to the UI.
//
// Validation steps:
//   1. The target cell must currently be empty (0). A move that
//      overwrites a clue or an existing player digit is always wrong.
//   2. The placement must be LEGAL given the current board (no
//      conflict in row, column, box, or — for diagonal variant —
//      diagonal). A move the player can't even attempt is useless.
//   3. The digit must match the puzzle's known solution at that
//      cell. This is the load-bearing check: the model can't fake
//      its way past it without literally guessing the right digit,
//      which is the same outcome a human deductive hint would have.
//   4. Provenance tag — if the deterministic next-hint EXACTLY
//      matches the model's move, tag it "solver" (high confidence:
//      both the model and the solver agree this is the next move).
//      Otherwise tag it "solution" (the digit is correct but it
//      isn't the cleanest deductive step the solver would have
//      picked first; still safe to place).
//
// Returning `null` from here is a deliberate degradation: the prose
// portion of the card still ships, just without the "Try this move"
// button. That respects the acceptance criterion "Invalid or
// unverified model outputs never surface to users."
export function validateSuggestion(
  board: Board,
  solution: string | null,
  suggestion: CoachOutput["suggestion"],
  variant: Variant,
): ValidatedSuggestion | null {
  if (!suggestion) return null;
  // No solution = nothing to validate against. Drop the suggestion
  // rather than guess. The deterministic fallback path doesn't go
  // through here; this only fires for AI-proposed moves.
  if (!solution || solution.length !== BOARD_SIZE) return null;

  const { cellIndex, digit, technique } = suggestion;

  // (1) target cell must be empty — model-proposed overwrites are
  // always wrong, including overwrites of a clue.
  if (board[cellIndex] !== 0) return null;

  // (2) placement must not conflict with the current board. We use
  // the SAME validator the cell-input path uses so the model
  // doesn't get to suggest moves the player wouldn't be able to
  // actually place.
  if (!isLegalPlacement(board, cellIndex, digit, variant)) return null;

  // (3) the digit must match the puzzle's solution at this cell.
  // This is the only thing standing between a hallucinated digit
  // and the user's board. Solution is a 1..9 character string.
  const solutionDigit = solution.charCodeAt(cellIndex) - 48;
  if (solutionDigit !== digit) return null;

  // (4) provenance tag. If the solver would have picked the same
  // exact move, mark it "solver"; otherwise mark "solution".
  const solverHint = nextHint(board, { solution, variant });
  const matchesSolver =
    !!solverHint && solverHint.index === cellIndex && solverHint.digit === digit;

  return {
    cellIndex,
    digit,
    technique,
    validatedBy: matchesSolver ? "solver" : "solution",
  };
}

// Deterministic fallback. Wraps `nextHint` and produces a CoachCard
// with a canned, technique-keyed explanation. Used when:
//   a) OPENAI_API_KEY isn't set, OR
//   b) the model call fails / times out, OR
//   c) the model returns invalid data.
//
// Important: even on the fallback path we go through validateSuggestion
// for the move ITSELF, so the same safety properties hold.
//
// `suggestion` may end up null when the puzzle is already nearly
// solved and the solver has nothing more to add — that's fine, we
// fall back to a generic "scan the boxes" message.
export function deterministicCoach(
  input: CoachInput,
  solution: string | null,
): CoachCard {
  const board = parseBoard(input.board);
  const variant: Variant = input.variant;

  const hint = nextHint(board, {
    selected: input.selected ?? null,
    solution,
    variant,
  });

  // Tone selection mirrors the AI side: rough sessions get a
  // constructive tone, clean sessions get celebratory, default
  // is encouraging. Keeps the UI styling consistent across the
  // two sources.
  const tone: CoachCard["tone"] =
    input.mistakesSoFar >= 4 || input.hintsUsedSoFar >= 5
      ? "constructive"
      : input.mistakesSoFar === 0 && input.hintsUsedSoFar === 0
        ? "celebratory"
        : "encouraging";

  if (!hint) {
    return {
      message:
        "Looks like the obvious deductions are spent. Scan each row, column, and box for cells where only one digit can fit.",
      rationale:
        "When no naked or hidden single is visible, work through one unit at a time and check candidate counts.",
      tone,
      suggestion: null,
      source: "deterministic",
    };
  }

  const card = describeHint(hint);
  // Wrap the same hint through the validator so the orchestrator
  // and the fallback agree on the safety contract. nextHint already
  // returned a valid solver step, so this should always pass — but
  // running it through the same gate makes the invariant testable.
  const suggestionRaw: CoachOutput["suggestion"] = {
    cellIndex: hint.index,
    digit: hint.digit,
    technique: techniqueFromHint(hint),
  };
  const suggestion = validateSuggestion(board, solution, suggestionRaw, variant);

  return {
    message: card.message,
    rationale: card.rationale,
    tone,
    suggestion,
    source: "deterministic",
  };
}

// Map a HintSuggestion technique to our coach technique enum. The
// solver currently emits naked-single / hidden-single / from-solution;
// we surface the first two as-is and map the third to "general"
// (because "we just looked at the solution" isn't a teachable
// technique to surface to the user).
type CoachTechnique = (typeof COACH_TECHNIQUES)[number];

function techniqueFromHint(hint: HintSuggestion): CoachTechnique {
  if (hint.technique === "naked-single") return "naked-single";
  if (hint.technique === "hidden-single") return "hidden-single";
  return "general";
}

// Per-technique canned copy. Kept terse — the UI dialog has limited
// real estate and the player just wants a fast nudge, not a lecture.
function describeHint(hint: HintSuggestion): { message: string; rationale: string } {
  const row = Math.floor(hint.index / 9) + 1;
  const col = (hint.index % 9) + 1;
  const cell = `row ${row}, column ${col}`;
  switch (hint.technique) {
    case "naked-single":
      return {
        message: `Try placing ${hint.digit} at ${cell}.`,
        rationale: `That cell already has 8 of the 9 digits ruled out by its row, column, or box, so ${hint.digit} is the only legal value.`,
      };
    case "hidden-single":
      return {
        message: `Place ${hint.digit} at ${cell}.`,
        rationale: `Within that ${hint.unit}, ${hint.digit} can only legally go in one cell — and it's this one.`,
      };
    default:
      return {
        message: `Try placing ${hint.digit} at ${cell}.`,
        rationale:
          "It matches the unique completion of this puzzle and lines up with every constraint on the board.",
      };
  }
}

// Orchestrator. Always returns a CoachCard. The deterministic
// fallback is built in, so the caller doesn't need a no-result branch.
//
// On any error / timeout / schema failure we silently fall back; the
// action emits a structured log line so we can monitor failure rate
// without leaking errors to the user (acceptance: "Invalid or
// unverified model outputs never surface to users.").
export type GenerateCoachingOptions = {
  client?: OpenAI | null;
  model?: string;
  // Hard timeout for the model call. Default keeps us under the
  // 2.5s p95 acceptance criterion even with a slow network leg.
  timeoutMs?: number;
  // Test hook: forces the no-key branch without mutating env.
  forceFallback?: boolean;
};

export type GenerateCoachingResult = {
  card: CoachCard;
  // Useful for telemetry. UI doesn't read this.
  fallbackReason?:
    | "no-client"
    | "force-fallback"
    | "timeout"
    | "model-error"
    | "schema-invalid"
    | "suggestion-rejected";
};

export async function generateCoaching(
  rawInput: CoachInput,
  solution: string | null,
  opts: GenerateCoachingOptions = {},
): Promise<GenerateCoachingResult> {
  // Re-validate input even though the action layer is supposed to
  // have done so. Defense in depth.
  const input = CoachInputSchema.parse(rawInput);
  const variant: Variant = input.variant;

  if (opts.forceFallback) {
    return {
      card: deterministicCoach(input, solution),
      fallbackReason: "force-fallback",
    };
  }

  const client = opts.client ?? null;
  if (!client) {
    return {
      card: deterministicCoach(input, solution),
      fallbackReason: "no-client",
    };
  }

  const userPrompt = buildCoachPrompt(input);
  const model = opts.model ?? "gpt-5.4-mini";
  const timeoutMs = opts.timeoutMs ?? 2_500;

  // Race the model against an explicit timeout. Same reasoning as in
  // debrief.ts: SDK timeouts can stretch past our budget on a
  // network blip; the explicit race guarantees the UI gets SOMETHING
  // on time.
  const modelPromise = callModel(client, model, userPrompt);
  const timeoutPromise = new Promise<"__timeout__">((resolve) => {
    setTimeout(() => resolve("__timeout__"), timeoutMs);
  });

  let modelResponse: Awaited<ReturnType<typeof callModel>> | "__timeout__";
  try {
    modelResponse = await Promise.race([modelPromise, timeoutPromise]);
  } catch {
    return { card: deterministicCoach(input, solution), fallbackReason: "model-error" };
  }

  if (modelResponse === "__timeout__") {
    return { card: deterministicCoach(input, solution), fallbackReason: "timeout" };
  }

  if (!modelResponse.ok) {
    return { card: deterministicCoach(input, solution), fallbackReason: "model-error" };
  }

  const parsed = CoachOutputSchema.safeParse(modelResponse.json);
  if (!parsed.success) {
    return { card: deterministicCoach(input, solution), fallbackReason: "schema-invalid" };
  }

  // Run the model's suggestion through the safety net. If it fails,
  // we KEEP the prose (message/rationale/tone) but drop the move.
  // That's more useful than throwing the whole card away — the
  // explanation might still help the player.
  const board = parseBoard(input.board);
  const validated = validateSuggestion(
    board,
    solution,
    parsed.data.suggestion,
    variant,
  );

  // If the model proposed a move but it didn't validate, surface a
  // distinct fallback reason so telemetry can spot a hallucination
  // pattern. The card still ships — without the move suggestion.
  const proposedButRejected = parsed.data.suggestion != null && validated == null;

  return {
    card: {
      message: parsed.data.message,
      rationale: parsed.data.rationale,
      tone: parsed.data.tone,
      suggestion: validated,
      source: "ai",
    },
    fallbackReason: proposedButRejected ? "suggestion-rejected" : undefined,
  };
}

// Internal: makes the actual SDK call. Mirrors the debrief shape so
// future provider swaps land in one place.
type CallModelResult = { ok: true; json: unknown } | { ok: false };

async function callModel(
  client: OpenAI,
  model: string,
  userPrompt: string,
): Promise<CallModelResult> {
  try {
    const completion = await client.chat.completions.create({
      model,
      // Slightly higher than debrief because the coach is generating
      // free-form prose that benefits from a touch of variation —
      // but still low because we want the move suggestion grounded
      // in the visible board, not invented.
      temperature: 0.5,
      // 320 tokens easily fits the message + rationale + suggestion
      // shape; cap stops the model from rambling and from running
      // up cost on a misbehavior.
      max_tokens: 320,
      response_format: {
        type: "json_schema",
        json_schema: COACH_RESPONSE_JSON_SCHEMA,
      },
      messages: [
        {
          role: "system",
          content:
            "You are a Sudoku coach. You explain the next deductive move on a partially-filled 9x9 board " +
            "in plain language. You NEVER reveal the puzzle's full solution. You NEVER invent a digit you " +
            "cannot justify from the visible board. When you propose a move, pick a single cell whose " +
            "digit you can defend by row/column/box scanning. When no move is justifiable, set suggestion " +
            "to null and offer a brief scanning tip instead. Always reply with valid JSON matching the " +
            "provided schema.",
        },
        { role: "user", content: userPrompt },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return { ok: false };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false };
    }
    return { ok: true, json };
  } catch {
    return { ok: false };
  }
}
