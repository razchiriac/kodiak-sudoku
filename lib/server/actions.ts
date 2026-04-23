"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { completedGames, puzzleAttempts, savedGames } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/supabase/server";
import { getDailyRankContext, getPuzzleById } from "@/lib/db/queries";
import { findConflicts, isCorrect, isFilled } from "@/lib/sudoku/validate";
import { parseBoard } from "@/lib/sudoku/board";
import { nextHint } from "@/lib/sudoku/solver";
import { dailyCompare, eventLog, solveTimeSanity } from "@/lib/flags";
import {
  HINT_BUCKET,
  HINT_LIMITS,
  checkRateLimit,
  rateLimitActorKey,
  recordRateLimitEvent,
} from "@/lib/server/rate-limit";

// All mutations go through Server Actions defined in this file. Every
// action validates inputs with Zod, derives the user from the cookie
// session (never trusts a userId from the caller), and performs the
// minimum DB work necessary.

const SaveSchema = z.object({
  puzzleId: z.number().int().positive(),
  board: z.string().length(81).regex(/^[0-9]{81}$/),
  notesB64: z.string().max(512).default(""),
  elapsedMs: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
  mistakes: z.number().int().nonnegative().max(999),
  hintsUsed: z.number().int().nonnegative().max(81),
  isPaused: z.boolean(),
});

export type SaveGameInput = z.infer<typeof SaveSchema>;

// Upsert the user's saved game for a puzzle. Called by the autosave
// effect on the play page; throttle on the client (we accept ~1 call
// every 3-5 seconds).
export async function saveGameAction(raw: SaveGameInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "unauthenticated" };

  const input = SaveSchema.parse(raw);

  // Check the puzzle exists; cheap because puzzles is a small frequently
  // cached table. Prevents a malicious or buggy client from creating
  // saved_games rows that point to nonexistent puzzles.
  const puzzle = await getPuzzleById(input.puzzleId);
  if (!puzzle) return { ok: false as const, error: "puzzle_not_found" };

  await db
    .insert(savedGames)
    .values({
      userId: user.id,
      puzzleId: input.puzzleId,
      board: input.board,
      notesB64: input.notesB64,
      elapsedMs: input.elapsedMs,
      mistakes: input.mistakes,
      hintsUsed: input.hintsUsed,
      isPaused: input.isPaused,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [savedGames.userId, savedGames.puzzleId],
      set: {
        board: input.board,
        notesB64: input.notesB64,
        elapsedMs: input.elapsedMs,
        mistakes: input.mistakes,
        hintsUsed: input.hintsUsed,
        isPaused: input.isPaused,
        updatedAt: new Date(),
      },
    });

  return { ok: true as const };
}

const SubmitSchema = z.object({
  puzzleId: z.number().int().positive(),
  board: z.string().length(81).regex(/^[0-9]{81}$/),
  elapsedMs: z.number().int().positive().max(24 * 60 * 60 * 1000),
  mistakes: z.number().int().nonnegative().max(999),
  hintsUsed: z.number().int().nonnegative().max(81),
  mode: z.enum(["random", "daily"]),
  dailyDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
});

export type SubmitInput = z.infer<typeof SubmitSchema>;

// Per-difficulty floor times in milliseconds. Anything faster than this
// is treated as suspicious and rejected from the leaderboard. Numbers
// are intentionally generous; we want to catch obvious cheating only.
const TIME_FLOOR_MS: Record<number, number> = {
  1: 30_000, // Easy: 30s
  2: 60_000, // Medium: 1m
  3: 90_000, // Hard: 1m30s
  4: 120_000, // Expert: 2m
};

// RAZ-27: how far the client-reported `elapsedMs` may exceed the
// wall-clock window `(now - saved_games.started_at)` before we reject
// the completion as tampered. 10% multiplicative slack + 2s additive
// slack. The multiplicative slack absorbs normal client/server clock
// drift and monotonic-clock rounding; the additive floor absorbs
// network latency on the submit round trip.
const SOLVE_TIME_MULT_SLACK = 1.1;
const SOLVE_TIME_ABS_SLACK_MS = 2_000;

// Submit a completion. The server is the SOLE source of truth for "did
// the user actually solve it". We compare the submitted board against the
// stored solution before recording anything.
export async function submitCompletionAction(raw: SubmitInput) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "unauthenticated" };

  const input = SubmitSchema.parse(raw);

  const puzzle = await getPuzzleById(input.puzzleId);
  if (!puzzle) return { ok: false as const, error: "puzzle_not_found" };

  // Verify the submitted board.
  const board = parseBoard(input.board);
  if (!isFilled(board) || findConflicts(board).size > 0 || !isCorrect(board, puzzle.solution)) {
    return { ok: false as const, error: "incorrect_solution" };
  }

  // Time floor sanity check.
  if (input.elapsedMs < TIME_FLOOR_MS[puzzle.difficultyBucket]) {
    return { ok: false as const, error: "time_floor" };
  }

  // RAZ-27: cross-check the client timer against server wall-clock
  // since the game's `started_at` (set by saved_games default on first
  // autosave). If the flag is off we skip the lookup entirely. If the
  // user has no saved_games row at all, this is a blitz solve that
  // finished before the first autosave fired; the per-difficulty floor
  // above is still protecting the leaderboard, so we don't block.
  if (await solveTimeSanity()) {
    const savedRow = await db
      .select({ startedAt: savedGames.startedAt })
      .from(savedGames)
      .where(and(eq(savedGames.userId, user.id), eq(savedGames.puzzleId, input.puzzleId)))
      .limit(1);
    const startedAt = savedRow[0]?.startedAt;
    if (startedAt) {
      const wallClockMs = Date.now() - startedAt.getTime();
      const maxAllowedMs = wallClockMs * SOLVE_TIME_MULT_SLACK + SOLVE_TIME_ABS_SLACK_MS;
      if (input.elapsedMs > maxAllowedMs) {
        return { ok: false as const, error: "solve_time_mismatch" };
      }
    }
  }

  // For daily, verify the daily_date matches what we have on file (so
  // a player can't backdate a daily completion to a different day).
  let dailyDate: string | null = null;
  if (input.mode === "daily") {
    if (!input.dailyDate) return { ok: false as const, error: "missing_daily_date" };
    const today = todayUtc();
    if (input.dailyDate !== today) return { ok: false as const, error: "daily_date_mismatch" };
    dailyDate = today;
  }

  // Insert; the unique index on (user_id, daily_date) where mode='daily'
  // enforces "one scored daily per user per day" at the DB level.
  try {
    await db.insert(completedGames).values({
      userId: user.id,
      puzzleId: input.puzzleId,
      difficultyBucket: puzzle.difficultyBucket,
      timeMs: input.elapsedMs,
      mistakes: input.mistakes,
      hintsUsed: input.hintsUsed,
      mode: input.mode,
      dailyDate,
    });
  } catch (e: unknown) {
    // Unique violation on the daily index → user already completed today.
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "23505") {
      return { ok: false as const, error: "already_completed_today" };
    }
    throw e;
  }

  // Saved game is no longer needed; clean it up so the dashboard's
  // "Continue" card doesn't show a finished puzzle.
  await db
    .delete(savedGames)
    .where(and(eq(savedGames.userId, user.id), eq(savedGames.puzzleId, input.puzzleId)));

  // Invalidate the leaderboard and dashboard caches so the new entry
  // shows up immediately on the next request.
  revalidatePath("/leaderboard");
  revalidatePath("/profile");
  revalidatePath("/play");

  // RAZ-32: compute a rank context AFTER the insert so the caller is
  // counted in the denominator. Only for daily mode (the feature is
  // framed around "today's solvers" — a per-puzzle rank context for
  // random puzzles exists in the per-difficulty leaderboard already).
  // Flag off or non-daily mode → null and the modal simply hides the
  // banner. We swallow errors defensively: a failed rank lookup must
  // not mask the fact that the completion itself was recorded
  // successfully.
  let rankContext:
    | { total: number; slower: number; percentile: number }
    | null = null;
  if (input.mode === "daily" && dailyDate && (await dailyCompare())) {
    try {
      rankContext = await getDailyRankContext(dailyDate, input.elapsedMs);
    } catch {
      rankContext = null;
    }
  }

  return { ok: true as const, rankContext };
}

// RAZ-28 — Flush the in-memory input-event buffer to `puzzle_attempts`.
// Separate action (rather than piggybacking on saveGameAction /
// submitCompletionAction) for three reasons:
//   1. The client gets to decide when to flush independently of
//      saving — e.g. we can let autosave throttle at 4s while
//      flushes ride a longer 15s debounce to keep DB write rate low.
//   2. A flush failure must never block an autosave or a completion
//      submit. Keeping them separate means the failure blast radius
//      is local to the event log.
//   3. Simpler to audit / revert. We can flip the `event-log` flag
//      off in Edge Config and this endpoint immediately no-ops,
//      without touching the hot paths.
//
// The wire payload is kept small: up to EVENT_BUFFER_CAP events per
// flush, each ~20-40 bytes on the wire. A typical 200-event attempt
// therefore costs a single ~8 KB row in puzzle_attempts.
//
// Events are inserted with `event='input_batch'` and a jsonb payload
// of `{seq, completed, events}`. Multiple rows per (user, puzzle) are
// expected — the server stitches them by (puzzle_id, seq) when
// reconstructing a replay.
//
// The row is allowed to land with `user_id = null` for anonymous
// players (matches the RLS policy). Signed-in players get their
// user_id recorded so downstream replay / profile views can filter.
const InputEventSchema = z.object({
  c: z.number().int().min(0).max(80),
  d: z.number().int().min(0).max(9),
  t: z.number().int().nonnegative().max(24 * 60 * 60 * 1000),
  k: z.enum(["v", "e", "h"]),
});

const FlushSchema = z.object({
  puzzleId: z.number().int().positive(),
  seq: z.number().int().nonnegative(),
  completed: z.boolean(),
  // Match the in-memory EVENT_BUFFER_CAP (1024) — any more per flush
  // and we'd be accepting more than the client could have captured.
  // Zod rejects the whole batch if any event is malformed rather
  // than silently truncating, which is the right tradeoff: a
  // corrupted batch signals a client bug we want to surface in logs.
  events: z.array(InputEventSchema).max(1024),
});

export type FlushInputEventsInput = z.infer<typeof FlushSchema>;

export async function flushInputEventsAction(raw: FlushInputEventsInput) {
  // Flag gate first — when off we just drop the payload on the floor.
  // We return ok so the client doesn't retry or surface a spurious
  // error to the user; the contract for this endpoint is "fire and
  // forget" from the client's point of view.
  if (!(await eventLog())) return { ok: true as const, written: false };

  const input = FlushSchema.parse(raw);

  // Tolerate an empty completion-marker flush: the client may want
  // to mark the end of an attempt even if it already drained the
  // last events batch. We still insert the row because the `completed`
  // flag is itself a signal downstream consumers want.
  if (input.events.length === 0 && !input.completed) {
    return { ok: true as const, written: false };
  }

  // Puzzle existence check — same pattern as saveGameAction. Keeps
  // the table tidy: no events for puzzle_ids we don't have records
  // for. Cheap because puzzles is small + cached.
  const puzzle = await getPuzzleById(input.puzzleId);
  if (!puzzle) return { ok: false as const, error: "puzzle_not_found" };

  // Anonymous writes are legal per RLS; we pass null in that case.
  const user = await getCurrentUser();

  await db.insert(puzzleAttempts).values({
    userId: user?.id ?? null,
    puzzleId: input.puzzleId,
    event: "input_batch",
    payload: {
      seq: input.seq,
      completed: input.completed,
      events: input.events,
    },
  });

  return { ok: true as const, written: true };
}

const HintSchema = z.object({
  puzzleId: z.number().int().positive(),
  board: z.string().length(81).regex(/^[0-9]{81}$/),
  selected: z.number().int().min(0).max(80).nullable(),
});

export type HintInput = z.infer<typeof HintSchema>;

// Server-side hint endpoint, used for daily puzzles where we don't
// ship the solution to the client.
//
// RAZ-29: wrapped in a rate limiter (3/min, 30/hour, per actor). Daily
// puzzles keep the solution server-side specifically to prevent
// scraping; without a rate limit a bot could hit this endpoint once
// per cell and reconstruct the board. We bill the quota AFTER we've
// decided the request is honest (valid schema, known puzzle) so a
// malformed request doesn't burn through a legitimate player's quota
// by accident.
export async function hintAction(raw: HintInput) {
  const input = HintSchema.parse(raw);

  // Validate puzzle existence FIRST. A 404 on puzzle_not_found shouldn't
  // count against the actor's quota — that's a client-state bug, not
  // abuse.
  const puzzle = await getPuzzleById(input.puzzleId);
  if (!puzzle) return { ok: false as const, error: "puzzle_not_found" };

  // Resolve the rate-limit key. For signed-in users this is user_id;
  // for anon callers we hash their forwarded-for IP. Either way the
  // limit is PER ACTOR so one abusive user can't DoS others.
  const user = await getCurrentUser();
  const key = await rateLimitActorKey(user?.id ?? null);
  const decision = await checkRateLimit(HINT_BUCKET, key, HINT_LIMITS);
  if (!decision.ok) {
    return {
      ok: false as const,
      error: "rate_limited" as const,
      retryAfterMs: decision.retryAfterMs,
      limit: decision.window.label,
    };
  }

  const board = parseBoard(input.board);
  const suggestion = nextHint(board, {
    selected: input.selected,
    solution: puzzle.solution,
  });
  if (!suggestion) return { ok: false as const, error: "no_hint" };

  // Record AFTER we've committed to returning a real hint. If the
  // puzzle is already solved (no_hint) we don't charge the quota —
  // that's a legitimate no-op the UI surfaces as "no more hints
  // needed" rather than abuse.
  await recordRateLimitEvent(HINT_BUCKET, key);

  return {
    ok: true as const,
    index: suggestion.index,
    digit: suggestion.digit,
    technique: suggestion.technique,
  };
}

const UpdateProfileSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(24)
    .regex(/^[a-z0-9_-]+$/),
  displayName: z.string().max(40).optional(),
});

// Set username and display name. Username has a unique constraint, so a
// duplicate returns a sentinel error the form can surface inline.
export async function updateProfileAction(raw: z.infer<typeof UpdateProfileSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "unauthenticated" };
  const input = UpdateProfileSchema.parse(raw);

  try {
    const { profiles } = await import("@/lib/db/schema");
    await db
      .update(profiles)
      .set({ username: input.username, displayName: input.displayName ?? input.username })
      .where(eq(profiles.id, user.id));
  } catch (e: unknown) {
    if (typeof e === "object" && e && "code" in e && (e as { code: string }).code === "23505") {
      return { ok: false as const, error: "username_taken" };
    }
    throw e;
  }
  revalidatePath("/profile");
  return { ok: true as const };
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

const MigrateSchema = z.object({
  // The anonymous game from localStorage. Only the active in-progress
  // game is migrated; completion records made while anonymous are not
  // moved (would mess up leaderboards).
  saved: z
    .object({
      puzzleId: z.number().int().positive(),
      board: z.string().length(81).regex(/^[0-9]{81}$/),
      notesB64: z.string().max(512),
      elapsedMs: z.number().int().nonnegative(),
      mistakes: z.number().int().nonnegative(),
      hintsUsed: z.number().int().nonnegative(),
      isPaused: z.boolean(),
    })
    .nullable(),
});

// Migrate an anonymous user's local progress into their new account on
// first sign-in. Conservative: only preserves the active in-progress
// game. Old completions stay in localStorage but never reach the server,
// so the leaderboard can't be polluted with anonymous wins.
export async function migrateLocalProgressAction(raw: z.infer<typeof MigrateSchema>) {
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, error: "unauthenticated" };
  const input = MigrateSchema.parse(raw);

  if (!input.saved) return { ok: true as const };

  const puzzle = await getPuzzleById(input.saved.puzzleId);
  if (!puzzle) return { ok: false as const, error: "puzzle_not_found" };

  // If the user already has a saved game for this puzzle, preserve the
  // server copy (it's been autosaved across devices and is more
  // trustworthy than the local one).
  const existing = await db
    .select()
    .from(savedGames)
    .where(and(eq(savedGames.userId, user.id), eq(savedGames.puzzleId, input.saved.puzzleId)))
    .limit(1);
  if (existing[0]) return { ok: true as const, kept: "server" };

  await db.insert(savedGames).values({
    userId: user.id,
    puzzleId: input.saved.puzzleId,
    board: input.saved.board,
    notesB64: input.saved.notesB64,
    elapsedMs: input.saved.elapsedMs,
    mistakes: input.saved.mistakes,
    hintsUsed: input.saved.hintsUsed,
    isPaused: input.saved.isPaused,
    updatedAt: new Date(),
  });
  return { ok: true as const, kept: "local" };
}
