import { notFound } from "next/navigation";
import {
  autoPause,
  autoSwitchDigit,
  compactControls,
  customPaste,
  haptics,
  jumpOnPlace,
  longPressNote,
  modePresets,
  postGameBreakdown,
  aiDebrief,
  stuckRescue,
  eventLog,
  progressiveHints,
  showMistakes,
} from "@/lib/flags";
import { normalizePastedPuzzle, parseBoard, serializeBoard } from "@/lib/sudoku/board";
import { findConflicts } from "@/lib/sudoku/validate";
import { solve } from "@/lib/sudoku/solver";
import { PlayClient } from "../../[puzzleId]/play-client";

// RAZ-35 — Play a pasted puzzle. The URL segment is the raw 81-digit
// puzzle string (what the import form builds and redirects to).
// We re-validate here so deep-linking a bad URL fails cleanly rather
// than crashing PlayClient downstream, and we re-solve so we can
// hand the solution to the client for local hint + mistake-tint
// support. The solution is NEVER embedded in the URL — only the
// puzzle is.
//
// Why /play/custom/[hash] instead of /play/[puzzleId]?
//   - `puzzleId` is a Drizzle-managed serial pointing into `puzzles`.
//     We don't want to mint synthetic rows for every pasted puzzle
//     (would pollute leaderboard queries and explode the table).
//   - A separate route keeps the "no DB, no leaderboard" nature of
//     custom sessions enforced at the routing layer — PlayClient
//     receives `isCustom={true}` here and nowhere else.
export const dynamic = "force-dynamic";

export default async function CustomPlayPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const enabled = await customPaste();
  if (!enabled) notFound();

  const { hash } = await params;
  // Re-normalize on the way in — the import form already did this,
  // but a user-shared URL could have been tampered with.
  const normalized = normalizePastedPuzzle(hash);
  if (!normalized.ok) notFound();

  const board = parseBoard(normalized.digits);
  if (findConflicts(board).size > 0) notFound();
  const solved = solve(board);
  if (!solved) notFound();

  // Resolve the same runtime flags we'd resolve for a normal
  // /play/[id] session so all the same settings/features work.
  // pbRibbon is skipped (no DB history). shareResult is intentionally
  // forced OFF here because the RAZ-11 share flow builds a URL from
  // `meta.puzzleId`, and custom sessions pass a sentinel id of -1 —
  // sharing that would produce a broken link. Friends who want to
  // try the same pasted puzzle can just copy the /play/custom/<hash>
  // URL from their browser bar.
  const [
    hapticsEnabled,
    autoSwitchDigitEnabled,
    autoPauseEnabled,
    compactControlsEnabled,
    longPressNoteEnabled,
    jumpOnPlaceEnabled,
    showMistakesEnabled,
    progressiveHintsEnabled,
    eventLogEnabled,
    modePresetsEnabled,
    breakdownEnabled,
    aiDebriefEnabled,
    stuckRescueEnabled,
  ] = await Promise.all([
    haptics(),
    autoSwitchDigit(),
    autoPause(),
    compactControls(),
    longPressNote(),
    jumpOnPlace(),
    showMistakes(),
    progressiveHints(),
    eventLog(),
    modePresets(),
    postGameBreakdown(),
    aiDebrief(),
    stuckRescue(),
  ]);

  return (
    <PlayClient
      puzzle={{
        // Custom puzzles have no DB row. We use `-1` as a sentinel
        // id — PlayClient never calls any server action that would
        // pass this number to the DB because isCustom=true short-
        // circuits both the autosave and submit paths upstream.
        id: -1,
        puzzle: normalized.digits,
        solution: serializeBoard(solved),
        // Custom puzzles don't carry a difficulty bucket. Default to
        // Medium (2) so the store's min-time floor/PB-ribbon logic
        // doesn't choke on an out-of-range value if some flag accidentally
        // enables it; this is belt-and-braces since isCustom already
        // gates those code paths.
        difficultyBucket: 2,
      }}
      savedGame={null}
      isSignedIn={false}
      mode="random"
      previousBestMs={null}
      hapticsEnabled={hapticsEnabled}
      autoSwitchDigitEnabled={autoSwitchDigitEnabled}
      autoPauseEnabled={autoPauseEnabled}
      shareEnabled={false}
      compactControlsEnabled={compactControlsEnabled}
      longPressNoteEnabled={longPressNoteEnabled}
      jumpOnPlaceEnabled={jumpOnPlaceEnabled}
      showMistakesEnabled={showMistakesEnabled}
      progressiveHintsEnabled={progressiveHintsEnabled}
      eventLogEnabled={eventLogEnabled}
      modePresetsEnabled={modePresetsEnabled}
      breakdownEnabled={breakdownEnabled}
      aiDebriefEnabled={aiDebriefEnabled}
      stuckRescueEnabled={stuckRescueEnabled}
      isCustom
    />
  );
}
