// RAZ-106: Offline play route. Serves a sudoku puzzle from the local
// IndexedDB bank so the player can start a new game without a network
// connection.
//
// Architecture:
//   - This file is a Server Component (default in App Router). It resolves
//     feature flags and the current session server-side, then forwards the
//     results as props to <OfflinePlayClient> which handles the IndexedDB
//     puzzle claim and renders <PlayClient isOffline>.
//   - The /play/offline shell is pre-cached by the service worker (sudoku-
//     shell-v2), so when the SW intercepts a /play/* navigation while
//     offline it can serve this page's HTML. The client component then
//     claims a puzzle from IndexedDB synchronously on mount.
//   - The `offline-play` feature flag is evaluated server-side. When the
//     flag is OFF this route returns 404 so stale cached SW responses
//     degrade to the /offline page gracefully (the SW checks the flag
//     state before caching this URL during install).

import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  adaptiveCoach,
  autoPause,
  autoSwitchDigit,
  compactControls,
  haptics,
  jumpOnPlace,
  longPressNote,
  modePresets,
  offlinePlay,
  postGameBreakdown,
  progressiveHints,
  shareResult,
  showMistakes,
  stuckRescue,
} from "@/lib/flags";
import { OfflinePlayClient } from "./offline-play-client";

export const dynamic = "force-dynamic";

export default async function OfflinePlayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Gate: if the offline-play flag is off, fall through to 404. The SW
  // only caches this page when the flag is on, so this guard is mostly a
  // safety net for direct URL access.
  const isEnabled = await offlinePlay();
  if (!isEnabled) notFound();

  const sp = await searchParams;
  const rawBucket = sp.bucket;
  const bucket = [1, 2, 3, 4].includes(Number(rawBucket)) ? Number(rawBucket) : 2;

  const user = await getCurrentUser();

  // Resolve feature flags — same set as the normal play page, minus
  // features that are irrelevant offline (pb-ribbon, challenge-link,
  // print-puzzle, ai-coach, ai-debrief, event-log, quick-play).
  const [
    hapticsEnabled,
    autoSwitchDigitEnabled,
    autoPauseEnabled,
    shareEnabled,
    compactControlsEnabled,
    longPressNoteEnabled,
    jumpOnPlaceEnabled,
    showMistakesEnabled,
    breakdownEnabled,
    stuckRescueEnabled,
    adaptiveCoachEnabled,
    modePresetsEnabled,
    progressiveHintsEnabled,
  ] = await Promise.all([
    haptics(),
    autoSwitchDigit(),
    autoPause(),
    shareResult(),
    compactControls(),
    longPressNote(),
    jumpOnPlace(),
    showMistakes(),
    postGameBreakdown(),
    stuckRescue(),
    adaptiveCoach(),
    modePresets(),
    progressiveHints(),
  ]);

  return (
    <OfflinePlayClient
      bucket={bucket}
      isSignedIn={!!user}
      hapticsEnabled={hapticsEnabled}
      autoSwitchDigitEnabled={autoSwitchDigitEnabled}
      autoPauseEnabled={autoPauseEnabled}
      shareEnabled={shareEnabled}
      compactControlsEnabled={compactControlsEnabled}
      longPressNoteEnabled={longPressNoteEnabled}
      jumpOnPlaceEnabled={jumpOnPlaceEnabled}
      showMistakesEnabled={showMistakesEnabled}
      breakdownEnabled={breakdownEnabled}
      stuckRescueEnabled={stuckRescueEnabled}
      adaptiveCoachEnabled={adaptiveCoachEnabled}
      modePresetsEnabled={modePresetsEnabled}
      progressiveHintsEnabled={progressiveHintsEnabled}
    />
  );
}
