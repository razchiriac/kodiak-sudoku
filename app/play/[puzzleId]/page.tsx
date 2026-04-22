import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getBestTimeForDifficulty,
  getPuzzleById,
  getSavedGame,
} from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  autoPause,
  autoSwitchDigit,
  compactControls,
  haptics,
  pbRibbon,
  shareResult,
} from "@/lib/flags";
import { buildShareOgMetadata } from "@/lib/share/og-metadata";
import { PlayClient } from "./play-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// RAZ-11 / share-result: when a visitor follows a shared link we swap
// in a dynamic OG image populated with the original player's stats.
// When no share params are present, fall through to the default site
// metadata defined in app/layout.tsx.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const og = buildShareOgMetadata(sp, { baseUrl: SITE_URL });
  return og ?? {};
}

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

  // RAZ-22 / pb-ribbon flag: only fetch the previous best when both the
  // flag is on AND the user is signed in (anonymous players have no
  // history to beat). When the flag is off we pass null and the modal
  // simply doesn't render the ribbon.
  const showPbRibbon = user ? await pbRibbon() : false;
  const previousBestMs =
    showPbRibbon && user
      ? await getBestTimeForDifficulty(user.id, puzzle.difficultyBucket)
      : null;

  // RAZ-19 / haptics flag: resolved server-side (Edge Config then env
  // fallback) and forwarded as a plain bool. Available to anonymous
  // players too — haptics is pure UX polish, no DB side effects.
  const hapticsEnabled = await haptics();

  // RAZ-16 / auto-switch-digit flag: same pattern as haptics.
  const autoSwitchDigitEnabled = await autoSwitchDigit();

  // RAZ-21 / auto-pause flag: same pattern.
  const autoPauseEnabled = await autoPause();

  // RAZ-11 / share-result flag: same pattern, forwarded to the
  // completion modal which decides whether to render the Share button.
  const shareEnabled = await shareResult();

  // RAZ-23 / compact-controls flag: same pattern.
  const compactControlsEnabled = await compactControls();

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
      previousBestMs={previousBestMs}
      hapticsEnabled={hapticsEnabled}
      autoSwitchDigitEnabled={autoSwitchDigitEnabled}
      autoPauseEnabled={autoPauseEnabled}
      shareEnabled={shareEnabled}
      compactControlsEnabled={compactControlsEnabled}
    />
  );
}
