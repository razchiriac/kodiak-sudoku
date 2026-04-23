"use server";

import "server-only";
import { normalizePastedPuzzle, parseBoard, serializeBoard } from "@/lib/sudoku/board";
import { findConflicts } from "@/lib/sudoku/validate";
import { solve } from "@/lib/sudoku/solver";
import { customPaste } from "@/lib/flags";

// RAZ-35 — Validate a user-pasted puzzle string on the server and
// return the canonical 81-char digit string (the "hash") the
// /play/custom/[hash] route uses as its URL segment.
//
// Validation pipeline:
//   1. Flag gate — off → unavailable (defensive; the entry page
//      already 404s but a direct action call could still hit us).
//   2. Normalize — strip non-digit/. chars, enforce length 81,
//      canonicalize `.` → `0`.
//   3. Static conflict check — if any row/col/box already has a
//      duplicate digit in the clues, the puzzle is unsolvable. We
//      fail fast with a descriptive error instead of running the
//      backtracking solver to dead end.
//   4. Solver — verify at least one completion exists. Uniqueness
//      is NOT checked (doubling solver cost for ~zero UX win at
//      this scale; we'd rather solve an ambiguous puzzle than
//      reject a user's input from a weird source).
//
// Returns:
//   { ok: true, hash } — the normalized 81-char string; caller
//     redirects client-side to /play/custom/<hash>.
//   { ok: false, error } — short descriptive string the form
//     renders inline below the textarea.
//
// We return the hash rather than redirecting from the server
// because the client form owns its pending/error UI; redirecting
// out of a server action would discard the form state and look
// janky on a slow network.
export async function importPastedPuzzleAction(
  raw: string,
): Promise<{ ok: true; hash: string } | { ok: false; error: string }> {
  if (!(await customPaste())) {
    return { ok: false, error: "Paste import is disabled." };
  }

  const normalized = normalizePastedPuzzle(raw);
  if (!normalized.ok) return { ok: false, error: normalized.error };

  const board = parseBoard(normalized.digits);
  if (findConflicts(board).size > 0) {
    return {
      ok: false,
      error: "The clues contain a duplicate digit in a row, column, or box.",
    };
  }

  const solution = solve(board);
  if (!solution) {
    return {
      ok: false,
      error: "This puzzle has no solution. Check the clues and try again.",
    };
  }

  // `hash` is the normalized digit string itself. 81 chars in a URL
  // segment is ugly but bookmarkable and round-trips without any
  // encoding/decoding surface area. We pass the solved solution back
  // to the play page via a second server round-trip keyed on the
  // hash (the play route re-solves) so the URL never carries the
  // answer.
  return { ok: true, hash: serializeBoard(board) };
}
