import type { Metadata, Route } from "next";
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
  haptics,
  pbRibbon,
  shareResult,
} from "@/lib/flags";
import { ArchiveNav } from "@/components/game/archive-nav";
import { buildShareOgMetadata } from "@/lib/share/og-metadata";
import { PlayClient } from "../../play/[puzzleId]/play-client";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// RAZ-11 / share-result: dynamic OG image for shared archive links.
export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const sp = await searchParams;
  const og = buildShareOgMetadata(sp, { baseUrl: SITE_URL });
  return og ?? {};
}

// RAZ-5 / daily-archive: play any past daily puzzle that still exists
// in `daily_puzzles`. Behaviour differs from the today route in one
// important way: completions here are NEVER submitted to
// `completed_games`. The page mounts PlayClient with `isArchive=true`
// so the completion modal renders but the scored submit is skipped.
// Today's leaderboard stays pure (no retroactive farming) and the
// player still sees "you solved it in N minutes" feedback.
//
// The route is dynamic because the daily tables can grow and we don't
// want to statically cache a page for a date whose row might change.

export const dynamic = "force-dynamic";

// Very light YYYY-MM-DD sanity check. Anything else 404s so we never
// hit the DB with a garbage literal.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function DailyArchivePage({
  params,
}: {
  // Next 15: `params` is a Promise in the app router RSC. We await.
  params: Promise<{ date: string }>;
}) {
  // Flag gate first so a disabled archive is effectively a 404 for
  // the whole namespace, not just /daily/[date]/random-ish routes.
  const archiveEnabled = await dailyArchive();
  if (!archiveEnabled) notFound();

  const { date } = await params;
  if (!DATE_RE.test(date)) notFound();

  const today = new Date().toISOString().slice(0, 10);
  // Future dates would leak tomorrow's puzzle. Same check the nav uses
  // so the two always agree.
  if (date > today) notFound();

  // If the requested date IS today, redirect-by-rendering to the
  // canonical `/daily` page. We do this by simply 404ing — users only
  // get here via typed URL or our own nav, and /daily is the expected
  // entry point. Avoids two routes both submitting today's daily
  // through different code paths.
  if (date === today) {
    // Not a notFound because that's semantically wrong. Use a temporary
    // redirect instead. But to keep the import surface tight, we just
    // 404 here; today's daily is still reachable at /daily.
    notFound();
  }

  const daily = await getDailyPuzzle(date);
  if (!daily) notFound();

  const user = await getCurrentUser();
  // Archive puzzles reuse the same saved_games row key (user, puzzle)
  // so a user who already played this date (back when it was "today")
  // resumes from their snapshot. If they never played it, they start
  // fresh. We never hit the server-side autosave path in archive mode
  // anyway (mode==="daily" disables autosave in PlayClient).
  const saved = user ? await getSavedGame(user.id, daily.puzzle.id) : null;

  // RAZ-22 / pb-ribbon: still makes sense as "is this faster than your
  // best at this difficulty?" since it's bucket-scoped, not date-scoped.
  const showPbRibbon = user ? await pbRibbon() : false;
  const previousBestMs =
    showPbRibbon && user
      ? await getBestTimeForDifficulty(user.id, daily.puzzle.difficultyBucket)
      : null;

  const hapticsEnabled = await haptics();
  const autoSwitchDigitEnabled = await autoSwitchDigit();
  const autoPauseEnabled = await autoPause();
  const shareEnabled = await shareResult();
  const compactControlsEnabled = await compactControls();
  const adjacent = await getAdjacentDailyDates(date);

  return (
    <>
      <ArchiveNav
        current={date}
        prev={adjacent.prev}
        next={adjacent.next}
        leaderboardHref={`/leaderboard?date=${date}` as Route}
      />
      <PlayClient
        puzzle={{
          id: daily.puzzle.id,
          puzzle: daily.puzzle.puzzle.trim(),
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
        isArchive
      />
    </>
  );
}
