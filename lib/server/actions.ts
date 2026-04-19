"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { completedGames, savedGames } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/supabase/server";
import { getPuzzleById } from "@/lib/db/queries";
import { findConflicts, isCorrect, isFilled } from "@/lib/sudoku/validate";
import { parseBoard } from "@/lib/sudoku/board";
import { nextHint } from "@/lib/sudoku/solver";

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

  return { ok: true as const };
}

const HintSchema = z.object({
  puzzleId: z.number().int().positive(),
  board: z.string().length(81).regex(/^[0-9]{81}$/),
  selected: z.number().int().min(0).max(80).nullable(),
});

export type HintInput = z.infer<typeof HintSchema>;

// Server-side hint endpoint, used for daily puzzles where we don't ship
// the solution to the client. Anyone can call this; the rate is bounded
// because the client only fires it on a button press.
export async function hintAction(raw: HintInput) {
  const input = HintSchema.parse(raw);
  const puzzle = await getPuzzleById(input.puzzleId);
  if (!puzzle) return { ok: false as const, error: "puzzle_not_found" };

  const board = parseBoard(input.board);
  const suggestion = nextHint(board, {
    selected: input.selected,
    solution: puzzle.solution,
  });
  if (!suggestion) return { ok: false as const, error: "no_hint" };

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
