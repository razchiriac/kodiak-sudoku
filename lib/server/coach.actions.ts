"use server";

import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPuzzleById } from "@/lib/db/queries";
import {
  COACH_BUCKET,
  COACH_LIMITS,
  checkRateLimit,
  rateLimitActorKey,
  recordRateLimitEvent,
} from "@/lib/server/rate-limit";
import { getOpenAI, coachModel, hasOpenAIKey } from "@/lib/server/openai";
import {
  CoachInputSchema,
  generateCoaching,
  deterministicCoach,
  type CoachCard,
  type CoachInput,
} from "@/lib/server/coach";
import type { Variant } from "@/lib/sudoku/board";

// RAZ-58 — Server actions for the in-game AI Coach.
//
// Why a co-located actions file (rather than appending to
// lib/server/actions.ts):
//   - AGENTS.md cap is ~200 lines; lib/server/actions.ts is already
//     past that.
//   - Mirrors the same pattern as RAZ-61's debrief.actions.ts so all
//     AI-surface actions live next to their pure engine.
//
// What this file does:
//   1. Exposes `requestCoachingAction` — validates input, fetches
//      the puzzle row to get the SOLUTION (kept server-side), runs
//      a clue-tampering check, applies rate limiting, calls the
//      generator. NEVER throws across the action boundary.
//   2. Exposes `recordCoachFeedbackAction` — logs 👍 / 👎 so we
//      can grep telemetry until a real feedback table lands.
//
// What this file MUST NOT do:
//   - Never return the puzzle solution. The validated suggestion
//     comes back as a single (cell, digit) pair the validator has
//     already checked — that one cell is enough to surface a hint
//     without leaking the rest of the solution.

// Output to the client. Discriminated union so the UI gets explicit
// branches without optional-chaining noise.
export type CoachActionResult =
  | { ok: true; card: CoachCard; cardId: string }
  | {
      ok: false;
      error:
        | "schema_invalid"
        | "puzzle_not_found"
        | "clue_mismatch"
        | "rate_limited"
        | "internal";
    };

// Action input mirrors CoachInputSchema PLUS a puzzleId so we can
// look up the solution server-side. Custom (pasted) puzzles have no
// DB row and are not supported in v1 — the UI gates the Coach
// button so this branch shouldn't be hit there in practice.
const CoachActionSchema = CoachInputSchema.extend({
  puzzleId: z.number().int().positive(),
});

export type CoachActionInput = z.infer<typeof CoachActionSchema>;

export async function requestCoachingAction(
  raw: unknown,
): Promise<CoachActionResult> {
  // 1. Validate input. Wrong shape = clean schema_invalid response.
  // (We re-validate inside generateCoaching too; this branch lets
  // the action exit early without burning a DB roundtrip on a
  // tampered payload.)
  const parsed = CoachActionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "schema_invalid" };
  }
  const input = parsed.data;

  // 2. Resolve the puzzle. The SOLUTION lives ONLY here; it never
  // travels to the model. We also take the variant from the DB
  // rather than trusting the client (defense in depth — a client
  // saying "standard" while the puzzle row is "diagonal" would
  // make `nextHint` validate against the wrong rules).
  const puzzle = await getPuzzleById(input.puzzleId);
  if (!puzzle) {
    return { ok: false, error: "puzzle_not_found" };
  }

  // 3. CLUE-TAMPERING CHECK. The submitted board's clue cells (the
  // cells that were non-zero in the original puzzle) must still
  // match the original puzzle. Otherwise a malicious client could
  // submit a board with altered clues, which would cause the
  // validator to compare against the WRONG solution and let the
  // model "validate" a wrong digit. We compare cell-by-cell.
  if (!cluesMatch(puzzle.puzzle, input.board)) {
    return { ok: false, error: "clue_mismatch" };
  }

  // 4. Rate-limit. Same actor-key pattern as the hint and debrief
  // actions. Anonymous players hash by IP; signed-in players key
  // by user id. We record the event AFTER we've decided the
  // request is valid (matches the hint-action policy: malformed
  // requests don't burn legit users' quota).
  let user: Awaited<ReturnType<typeof getCurrentUser>> = null;
  try {
    user = await getCurrentUser();
  } catch {
    // Treat an auth read failure as anonymous; better than 500ing.
  }
  const key = await rateLimitActorKey(user?.id ?? null);
  const decision = await checkRateLimit(COACH_BUCKET, key, COACH_LIMITS);
  if (!decision.ok) {
    return { ok: false, error: "rate_limited" };
  }

  // 5. Use the DB-side variant, never the client-supplied one.
  const variant: Variant =
    puzzle.variant === "diagonal" ? "diagonal" : "standard";
  const coachInput: CoachInput = {
    ...input,
    variant,
  };

  // 6. Decide whether to even attempt the AI path. If no key is
  // configured, short-circuit to the deterministic fallback (saves
  // a lazy-singleton roundtrip and keeps logs cleaner).
  let result: Awaited<ReturnType<typeof generateCoaching>>;
  if (!hasOpenAIKey()) {
    result = {
      card: deterministicCoach(coachInput, puzzle.solution),
      fallbackReason: "no-client",
    };
  } else {
    // 7. Call the generator. The function never throws — every
    // failure mode collapses to a deterministic fallback. Wrapped
    // in try/catch anyway as belt-and-suspenders.
    try {
      result = await generateCoaching(coachInput, puzzle.solution, {
        client: getOpenAI(),
        model: coachModel(),
      });
    } catch {
      result = {
        card: deterministicCoach(coachInput, puzzle.solution),
        fallbackReason: "model-error",
      };
    }
  }

  // 8. Charge the actor's quota.
  await recordRateLimitEvent(COACH_BUCKET, key);

  // 9. Stable per-card id so a 👍/👎 click can correlate with the
  // generation log line. Caller stores this and forwards it back
  // with the feedback call.
  const cardId = makeCardId();

  // 10. Structured log line. NEVER log the full prompt or the
  // suggestion's cell coordinate (would let log-readers infer
  // partial solutions); just the shape and the fallback path.
  log("coach.generated", {
    cardId,
    source: result.card.source,
    fallbackReason: result.fallbackReason ?? null,
    suggestionPresent: result.card.suggestion != null,
    validatedBy: result.card.suggestion?.validatedBy ?? null,
    difficulty: input.difficultyBucket,
    mode: input.mode,
    variant,
  });

  return { ok: true, card: result.card, cardId };
}

// Helper: compares the original puzzle string to the submitted board
// CELL BY CELL, but only at the indices where the puzzle has a non-
// zero (clue) digit. The player is allowed to fill empty cells with
// anything — that's gameplay — but they MUST NOT modify clue cells.
//
// Returns true when every clue position matches, false otherwise.
function cluesMatch(puzzle: string, submitted: string): boolean {
  // Length is already validated by Zod, but bail on a mismatch
  // anyway as a sanity guard.
  if (puzzle.length !== 81 || submitted.length !== 81) return false;
  for (let i = 0; i < 81; i++) {
    const clueCh = puzzle.charCodeAt(i);
    if (clueCh === 48 /* '0' */) continue; // empty cell — player can fill anything
    if (clueCh !== submitted.charCodeAt(i)) return false;
  }
  return true;
}

// Cheap, unique-enough card identifier for telemetry correlation.
// Not security-sensitive — a collision just merges two log lines,
// which is OK at the volume we're operating at.
function makeCardId(): string {
  // Use the same shape as debrief: timestamp + random base36 tail.
  // Short, sortable, and trivially deduplicatable client-side if
  // ever needed.
  return `${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
}

// 👍 / 👎 feedback. v1 just logs — same approach as RAZ-61. A real
// feedback table can land alongside the post-launch metrics work
// without changing the action surface.
const FeedbackSchema = z.object({
  cardId: z.string().min(1).max(64),
  rating: z.enum(["up", "down"]),
  source: z.enum(["ai", "deterministic"]),
  // Whether the player accepted the "Try this move" CTA — useful
  // signal even when they don't 👍/👎 the explanation itself.
  accepted: z.boolean().optional(),
  difficultyBucket: z.number().int().min(1).max(4),
});

export type FeedbackActionResult =
  | { ok: true }
  | { ok: false; error: "schema_invalid" };

export async function recordCoachFeedbackAction(
  raw: unknown,
): Promise<FeedbackActionResult> {
  const parsed = FeedbackSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "schema_invalid" };
  }
  const { cardId, rating, source, accepted, difficultyBucket } = parsed.data;

  log("coach.feedback", {
    cardId,
    rating,
    source,
    accepted: accepted ?? null,
    difficulty: difficultyBucket,
  });

  return { ok: true };
}

// Tiny structured logger. Same shape as the rest of the action
// telemetry so log search ("event:coach.*") just works.
function log(event: string, payload: Record<string, unknown>): void {
  try {
    console.log(JSON.stringify({ event, ...payload }));
  } catch {
    // Defensive — never let a logging failure swallow the action.
  }
}
