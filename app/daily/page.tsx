import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  getBestTimeForDifficulty,
  getDailyPuzzle,
  getSavedGame,
} from "@/lib/db/queries";
import { pbRibbon } from "@/lib/flags";
import { PlayClient } from "../play/[puzzleId]/play-client";

// Daily must be dynamic: it depends on the current UTC date and the
// caller's session.
export const dynamic = "force-dynamic";

// Daily puzzle page. Same play UI as a normal puzzle, but the mode is
// "daily" and the solution is intentionally NOT sent to the client (so
// the hint button always round-trips through the server).
export default async function DailyPage() {
  const today = new Date().toISOString().slice(0, 10);
  const daily = await getDailyPuzzle(today);
  if (!daily) notFound();

  const user = await getCurrentUser();
  // Daily progress isn't autosaved; we only check for an existing
  // completion to decide whether to show "you've already played today"
  // (handled inside PlayClient when the submit returns already_completed).
  const saved = user ? await getSavedGame(user.id, daily.puzzle.id) : null;

  // RAZ-22 / pb-ribbon: same pattern as the random play page.
  const showPbRibbon = user ? await pbRibbon() : false;
  const previousBestMs =
    showPbRibbon && user
      ? await getBestTimeForDifficulty(user.id, daily.puzzle.difficultyBucket)
      : null;

  return (
    <PlayClient
      puzzle={{
        id: daily.puzzle.id,
        puzzle: daily.puzzle.puzzle.trim(),
        // Empty string here; the client never receives the daily solution.
        solution: "",
        difficultyBucket: daily.puzzle.difficultyBucket,
      }}
      savedGame={
        saved
          ? {
              board: saved.board.trim(),
              notesB64: saved.notesB64,
              elapsedMs: saved.elapsedMs,
              mistakes: saved.mistakes,
              hintsUsed: saved.hintsUsed,
              isPaused: saved.isPaused,
              startedAt: new Date(saved.startedAt).getTime(),
            }
          : null
      }
      isSignedIn={!!user}
      mode="daily"
      dailyDate={daily.date as string}
      previousBestMs={previousBestMs}
    />
  );
}
