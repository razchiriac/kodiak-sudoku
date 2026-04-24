import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  getBestOnPuzzleByUsername,
  getBestTimeForDifficulty,
  getProfileById,
  getPuzzleById,
  getSavedGame,
} from "@/lib/db/queries";
import { getCurrentUser } from "@/lib/supabase/server";
import {
  autoPause,
  autoSwitchDigit,
  challengeLink,
  compactControls,
  haptics,
  jumpOnPlace,
  longPressNote,
  modePresets,
  pbRibbon,
  postGameBreakdown,
  aiDebrief,
  aiCoach,
  printPuzzle,
  stuckRescue,
  adaptiveCoach,
  eventLog,
  progressiveHints,
  quickPlay,
  shareResult,
  showMistakes,
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
//
// RAZ-34: accepts a `?quick=1` search param set by /play/quick. When
// present (and the quick-play flag is on), we render the session in
// quick mode so the completion modal's "Next puzzle" CTA loops back
// to /play/quick for a fresh random pick. We accept the search param
// even if the flag is off and just silently ignore it so stale links
// degrade gracefully.
export default async function PuzzlePage({
  params,
  searchParams,
}: {
  params: Promise<{ puzzleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { puzzleId } = await params;
  const sp = await searchParams;
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
  // RAZ-20 / long-press-note flag: same pattern. Resolved once here
  // so the client only has to mirror it into the zustand store.
  const longPressNoteEnabled = await longPressNote();
  // RAZ-17 / jump-on-place flag.
  const jumpOnPlaceEnabled = await jumpOnPlace();
  // RAZ-15 / show-mistakes flag. Resolved once server-side and
  // mirrored into the store; actual tint also requires the user
  // opt-in and meta.solution being present (random puzzles only).
  const showMistakesEnabled = await showMistakes();
  // RAZ-34 / quick-play: render this session in quick mode when the
  // URL carries ?quick=1 AND the feature flag is on. Stale links from
  // a disabled flag just render the normal random-play flow.
  const quickPlayFlag = await quickPlay();
  const isQuickPlay = quickPlayFlag && sp.quick === "1";

  // RAZ-13 / challenge-link. Two orthogonal pieces of data are
  // resolved server-side so the client can stay dumb:
  //   1. `challenge` — when the URL carries `?from=<username>`, look
  //      up that sender's best random-mode time on THIS puzzle so
  //      the banner can render "Beat @X's time of M:SS". Silently
  //      null when the flag is off, the sender is unknown, or they
  //      have no random completion of this puzzle.
  //   2. `currentUsername` — the viewer's own username (if signed
  //      in with a profile), used to seed the "Challenge a friend"
  //      action in the completion modal. Null for anonymous or
  //      username-less accounts disables the action.
  const challengeLinkFlag = await challengeLink();
  const fromRaw = sp.from;
  const fromUsername =
    challengeLinkFlag && typeof fromRaw === "string" && fromRaw.length > 0
      ? fromRaw
      : null;
  const challenge = fromUsername
    ? await getBestOnPuzzleByUsername(fromUsername, puzzle.id)
    : null;
  const currentProfile =
    challengeLinkFlag && user ? await getProfileById(user.id) : null;
  const currentUsername = currentProfile?.username ?? null;

  // RAZ-9 / print-puzzle flag. Pure UI gate — when off, the header
  // printer button is hidden and the /print route 403s. Resolved once
  // here and forwarded as a plain bool.
  const printPuzzleEnabled = await printPuzzle();

  // RAZ-14 / progressive-hints flag. Pure UI gate — when on, the
  // client-side `hint()` reducer splits a hint click into three
  // tiers (region nudge → technique + cell → place the digit).
  // When off, clicking Hint behaves exactly as before.
  const progressiveHintsEnabled = await progressiveHints();

  // RAZ-28 / event-log flag. Kill switch for the input-event log. When
  // off the settings row is hidden AND the store reducers never
  // append to the buffer, so there's no network traffic from this
  // feature.
  const eventLogEnabled = await eventLog();

  // RAZ-54 / mode-presets flag. Pure UI gate — when on, the settings
  // dialog renders the inline preset picker so a mid-game switch is
  // one click. The store mirrors this flag so the picker hides
  // immediately when toggled off in Edge Config.
  const modePresetsEnabled = await modePresets();

  // RAZ-45 / post-game-breakdown flag. Pure UI gate — forwarded to
  // the CompletionModal which renders the BreakdownPanel below the
  // existing stat grid. Compute is purely client-side so the panel
  // renders in <300ms after the modal opens regardless of network
  // conditions.
  const breakdownEnabled = await postGameBreakdown();

  // RAZ-61 / ai-debrief flag. Server-resolved here so the modal hides
  // the AiDebriefCard with zero client flicker when the kill-switch
  // is flipped via Edge Config. The card itself is still responsible
  // for the (paid) action call — the prop is just a render gate.
  const aiDebriefEnabled = await aiDebrief();

  // RAZ-58 / ai-coach flag. Server-resolved here so the Coach button
  // is hidden with zero client flicker when the kill-switch is
  // flipped via Edge Config. Default off in the registry — see
  // FLAG_REGISTRY for the rollout rationale.
  const aiCoachEnabled = await aiCoach();

  // RAZ-48 / stuck-rescue flag. Pure UI gate forwarded to PlayClient
  // which mirrors it into the store; the rescue chip never mounts
  // when the flag is off.
  const stuckRescueEnabled = await stuckRescue();
  // RAZ-49 / adaptive-coach flag. Same forwarding pattern as the
  // rescue chip — the play client mirrors it into the store so the
  // banner hook can short-circuit on flag-off.
  const adaptiveCoachEnabled = await adaptiveCoach();

  return (
    <PlayClient
      puzzle={{
        id: puzzle.id,
        puzzle: puzzle.puzzle.trim(),
        solution: puzzle.solution.trim(),
        difficultyBucket: puzzle.difficultyBucket,
        variant: puzzle.variant,
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
      longPressNoteEnabled={longPressNoteEnabled}
      jumpOnPlaceEnabled={jumpOnPlaceEnabled}
      showMistakesEnabled={showMistakesEnabled}
      isQuickPlay={isQuickPlay}
      challenge={challenge}
      challengeLinkEnabled={challengeLinkFlag}
      currentUsername={currentUsername}
      printPuzzleEnabled={printPuzzleEnabled}
      progressiveHintsEnabled={progressiveHintsEnabled}
      eventLogEnabled={eventLogEnabled}
      modePresetsEnabled={modePresetsEnabled}
      breakdownEnabled={breakdownEnabled}
      aiDebriefEnabled={aiDebriefEnabled}
      aiCoachEnabled={aiCoachEnabled}
      stuckRescueEnabled={stuckRescueEnabled}
      adaptiveCoachEnabled={adaptiveCoachEnabled}
    />
  );
}
