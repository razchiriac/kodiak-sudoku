import { notFound } from "next/navigation";
import { getPuzzleById, getSavedGame } from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import { PlayClient } from "./play-client";

// Each puzzle page hits the DB and reads the user session.
export const dynamic = "force-dynamic";

// Puzzle page. Server Component that resolves the puzzle and any saved
// state, then hands off to the interactive client.
export default async function PuzzlePage({
  params,
}: {
  params: Promise<{ puzzleId: string }>;
}) {
  const { puzzleId } = await params;
  const id = Number(puzzleId);
  if (!Number.isFinite(id)) notFound();

  const puzzle = await getPuzzleById(id);
  if (!puzzle) notFound();

  const user = await getCurrentUser();
  const saved = user ? await getSavedGame(user.id, puzzle.id) : null;

  return (
    <PlayClient
      puzzle={{
        id: puzzle.id,
        puzzle: puzzle.puzzle.trim(),
        solution: puzzle.solution.trim(),
        difficultyBucket: puzzle.difficultyBucket,
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
      mode="random"
    />
  );
}
