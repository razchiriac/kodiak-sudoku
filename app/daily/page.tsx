import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  getAdjacentDailyDates,
  getBestTimeForDifficulty,
  getDailyPuzzle,
  getSavedGame,
} from "@/lib/db/queries";
import {
  autoPause,
  autoSwitchDigit,
  compactControls,
  dailyArchive,
  jumpOnPlace,
  longPressNote,
  haptics,
  pbRibbon,
  printPuzzle,
  progressiveHints,
  shareResult,
  showMistakes,
} from "@/lib/flags";
import { ArchiveNav } from "@/components/game/archive-nav";
import { buildShareOgMetadata } from "@/lib/share/og-metadata";
import { PlayClient } from "../play/[puzzleId]/play-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// RAZ-11 / share-result: swap in dynamic OG image when a shared link
// drops us here. Same pattern as /play/[puzzleId]/page.tsx.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const og = buildShareOgMetadata(sp, { baseUrl: SITE_URL });
  return og ?? {};
}

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

  // RAZ-19 / haptics: resolved server-side and forwarded. Available to
  // anonymous players the same as the random page.
  const hapticsEnabled = await haptics();

  // RAZ-16 / auto-switch-digit flag.
  const autoSwitchDigitEnabled = await autoSwitchDigit();

  // RAZ-21 / auto-pause flag.
  const autoPauseEnabled = await autoPause();

  // RAZ-11 / share-result flag.
  const shareEnabled = await shareResult();

  // RAZ-23 / compact-controls flag.
  const compactControlsEnabled = await compactControls();
  // RAZ-20 / long-press-note flag.
  const longPressNoteEnabled = await longPressNote();
  // RAZ-17 / jump-on-place flag.
  const jumpOnPlaceEnabled = await jumpOnPlace();
  // RAZ-15 / show-mistakes flag. Mirrored into the store but note the
  // mistake tint itself is a no-op on daily puzzles because the
  // solution is kept server-side — SudokuGrid guards on solution
  // presence so flipping the toggle here has no visible effect.
  const showMistakesEnabled = await showMistakes();

  // RAZ-9 / print-puzzle flag.
  const printPuzzleEnabled = await printPuzzle();

  // RAZ-14 / progressive-hints flag.
  const progressiveHintsEnabled = await progressiveHints();

  // RAZ-5 / daily-archive flag. When on, surface a "Previous day" link
  // above the board so players can reach the archive from anywhere.
  // `next` is always null on today's page because we never advertise
  // tomorrow's puzzle. When the flag is off, both links are hidden.
  const archiveEnabled = await dailyArchive();
  const adjacent = archiveEnabled
    ? await getAdjacentDailyDates(today)
    : { prev: null, next: null };

  return (
    <>
      {archiveEnabled ? (
        <ArchiveNav current={today} prev={adjacent.prev} next={null} />
      ) : null}
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
        hapticsEnabled={hapticsEnabled}
        autoSwitchDigitEnabled={autoSwitchDigitEnabled}
        autoPauseEnabled={autoPauseEnabled}
        shareEnabled={shareEnabled}
        compactControlsEnabled={compactControlsEnabled}
        longPressNoteEnabled={longPressNoteEnabled}
        jumpOnPlaceEnabled={jumpOnPlaceEnabled}
        showMistakesEnabled={showMistakesEnabled}
        printPuzzleEnabled={printPuzzleEnabled}
        progressiveHintsEnabled={progressiveHintsEnabled}
      />
    </>
  );
}
