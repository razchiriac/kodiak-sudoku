"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, Settings as SettingsIcon } from "lucide-react";
import { readPersistedSnapshot, useGameStore } from "@/lib/zustand/game-store";
import { SudokuGrid } from "@/components/game/sudoku-grid";
import { NumberPad } from "@/components/game/number-pad";
import { ControlPanel } from "@/components/game/control-panel";
import { Timer } from "@/components/game/timer";
import { KeyboardListener } from "@/components/game/keyboard-listener";
import { VisibilityListener } from "@/components/game/visibility-listener";
import { LiveRegion } from "@/components/game/live-region";
import { CompletionModal } from "@/components/game/completion-modal";
import { ShortcutsOverlay } from "@/components/game/shortcuts-overlay";
import { SettingsDialog } from "@/components/game/settings-dialog";
import { Button } from "@/components/ui/button";
import { saveGameAction, submitCompletionAction, hintAction } from "@/lib/server/actions";
import { DIFFICULTY_LABEL } from "@/lib/utils";

// The interactive Sudoku page. Drives the Zustand store, wires up
// autosave, completion submission, and the shortcuts overlay.

type PuzzleProp = {
  id: number;
  puzzle: string;
  solution: string;
  difficultyBucket: number;
};

type SavedProp = {
  board: string;
  notesB64: string;
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  isPaused: boolean;
  startedAt: number;
} | null;

export function PlayClient({
  puzzle,
  savedGame,
  isSignedIn,
  mode,
  dailyDate,
  previousBestMs,
  hapticsEnabled,
  autoSwitchDigitEnabled,
  autoPauseEnabled,
  shareEnabled = false,
  compactControlsEnabled = false,
  longPressNoteEnabled = false,
  jumpOnPlaceEnabled = false,
  showMistakesEnabled = false,
  isQuickPlay = false,
  isArchive = false,
}: {
  puzzle: PuzzleProp;
  savedGame: SavedProp;
  isSignedIn: boolean;
  mode: "random" | "daily";
  dailyDate?: string;
  // RAZ-5: when true, this is an archive daily (past date). Render a
  // "practice only, not scored" badge and skip submitCompletionAction
  // on finish. Today's daily keeps its normal scored behaviour.
  isArchive?: boolean;
  // Previous best time (ms) for this user in this difficulty, or null
  // when the pb-ribbon flag (RAZ-22) is off, the user is anonymous, or
  // they have no completions in this bucket. Forwarded to the
  // CompletionModal which decides whether to render the ribbon.
  previousBestMs: number | null;
  // RAZ-19: server-resolved value of the `haptics` flag. We mirror it
  // into the Zustand store on mount so the gameplay reducer (inputDigit)
  // can decide whether to call navigator.vibrate without prop-drilling.
  hapticsEnabled: boolean;
  // RAZ-16: server-resolved value of `auto-switch-digit`. Same mirror
  // pattern as `hapticsEnabled` — gameplay reducer reads it from the
  // store when it computes the next pad-highlighted digit.
  autoSwitchDigitEnabled: boolean;
  // RAZ-21: server-resolved value of `auto-pause`. Forwarded directly
  // to <VisibilityListener> (no store mirror needed — the component
  // only reads it on mount).
  autoPauseEnabled: boolean;
  // RAZ-11: server-resolved value of `share-result`. Controls whether
  // the completion modal renders its Share button.
  shareEnabled?: boolean;
  // RAZ-23: server-resolved value of `compact-controls`. Mirrored into
  // the store so <NumberPad> and <SettingsDialog> can both gate on it.
  compactControlsEnabled?: boolean;
  // RAZ-20: server-resolved value of `long-press-note`. Mirrored into
  // the store so <NumberPad> can conditionally arm its 400ms long-press
  // timer. Off = the feature is a no-op; buttons act as plain taps.
  longPressNoteEnabled?: boolean;
  // RAZ-17: server-resolved value of `jump-on-place`. Mirrored into the
  // store so inputDigit can decide whether to advance the selection to
  // the next empty peer after a placement. Off = selection never moves
  // automatically regardless of the persisted user setting.
  jumpOnPlaceEnabled?: boolean;
  // RAZ-15: server-resolved value of `show-mistakes`. Mirrored into the
  // store so <SudokuGrid> derives the mistake set and <SettingsDialog>
  // renders the toggle. Off = the feature is hidden; even a user who
  // previously opted in sees no red tint.
  showMistakesEnabled?: boolean;
  // RAZ-34: true when this session was entered via /play/quick (i.e.
  // the URL carries `?quick=1`). Tells the completion modal to swap
  // its "New puzzle" CTA for "Next puzzle" which loops back to
  // /play/quick for another random Easy, and to link the leaderboard
  // button at /leaderboard/quick rather than the daily board.
  isQuickPlay?: boolean;
}) {
  const startGame = useGameStore((s) => s.startGame);
  const resumeFromSnapshot = useGameStore((s) => s.resumeFromSnapshot);
  const setRemoteHintFetcher = useGameStore((s) => s.setRemoteHintFetcher);
  const setFeatureFlag = useGameStore((s) => s.setFeatureFlag);
  const isComplete = useGameStore((s) => s.isComplete);
  const meta = useGameStore((s) => s.meta);

  // Initialize the store once on mount. We bail out if the store already
  // owns the same puzzle (avoids resetting state on hot reload).
  const initialized = useRef(false);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    // Priority 1: signed-in user with a server-side savedGame row.
    // Server is the source of truth for them.
    if (savedGame && isSignedIn) {
      resumeFromSnapshot(
        {
          meta: {
            puzzleId: puzzle.id,
            difficultyBucket: puzzle.difficultyBucket,
            mode,
            // For daily, the client never gets the solution.
            solution: mode === "daily" ? null : puzzle.solution,
          },
          board: savedGame.board,
          notesB64: savedGame.notesB64,
          elapsedMs: savedGame.elapsedMs,
          mistakes: savedGame.mistakes,
          hintsUsed: savedGame.hintsUsed,
          isPaused: savedGame.isPaused,
          isComplete: false,
          startedAt: savedGame.startedAt,
        },
        puzzle.puzzle,
      );
      return;
    }

    // Priority 2: anonymous user with a persisted snapshot for THIS
    // exact puzzle. Without this branch, refreshing /play/<id> while
    // signed out wipes the in-progress game because startGame() resets
    // the store and the persist middleware then writes the empty
    // state back to localStorage.
    //
    // Guards:
    //   - puzzleId match prevents pasting old progress over a brand
    //     new random puzzle that happens to share the URL slot.
    //   - !isComplete prevents auto-restoring a completed puzzle in
    //     its won state on refresh (player should get a fresh game).
    const local = !isSignedIn ? readPersistedSnapshot() : null;
    if (local && local.meta.puzzleId === puzzle.id && !local.isComplete) {
      resumeFromSnapshot(
        {
          meta: {
            puzzleId: puzzle.id,
            difficultyBucket: puzzle.difficultyBucket,
            mode,
            solution: mode === "daily" ? null : puzzle.solution,
          },
          board: local.board,
          notesB64: local.notesB64,
          elapsedMs: local.elapsedMs,
          mistakes: local.mistakes,
          hintsUsed: local.hintsUsed,
          isPaused: local.isPaused,
          isComplete: false,
          startedAt: local.startedAt,
        },
        puzzle.puzzle,
      );
      return;
    }

    // Priority 3: fresh puzzle.
    startGame({
      meta: {
        puzzleId: puzzle.id,
        difficultyBucket: puzzle.difficultyBucket,
        mode,
        solution: mode === "daily" ? null : puzzle.solution,
      },
      puzzle: puzzle.puzzle,
    });
  }, [puzzle, savedGame, isSignedIn, mode, startGame, resumeFromSnapshot]);

  // Inject the remote hint fetcher used for daily puzzles. Stays inert
  // for random play because the store prefers a local solution if it has
  // one.
  useEffect(() => {
    setRemoteHintFetcher(async (board, selected) => {
      const res = await hintAction({ puzzleId: puzzle.id, board, selected });
      if (!res.ok) throw new Error(res.error);
      return { index: res.index, digit: res.digit };
    });
  }, [puzzle.id, setRemoteHintFetcher]);

  // Mirror the server-resolved haptics flag into the store. Runs on
  // every value change so the flag can be flipped in Edge Config and
  // take effect on the next page load without a redeploy. Cheap -
  // setFeatureFlag no-ops when the value is unchanged.
  useEffect(() => {
    setFeatureFlag("haptics", hapticsEnabled);
  }, [hapticsEnabled, setFeatureFlag]);

  // Same mirror pattern for RAZ-16 auto-switch-digit.
  useEffect(() => {
    setFeatureFlag("autoSwitchDigit", autoSwitchDigitEnabled);
  }, [autoSwitchDigitEnabled, setFeatureFlag]);

  // Same mirror pattern for RAZ-23 compact-controls.
  useEffect(() => {
    setFeatureFlag("compactControls", compactControlsEnabled);
  }, [compactControlsEnabled, setFeatureFlag]);

  // RAZ-20 long-press-note mirror. NumberPad reads this directly to
  // decide whether to start the 400ms timer on pointerdown.
  useEffect(() => {
    setFeatureFlag("longPressNote", longPressNoteEnabled);
  }, [longPressNoteEnabled, setFeatureFlag]);

  // RAZ-17 jump-on-place mirror. inputDigit reads this alongside the
  // per-user setting when deciding whether to advance the selection.
  useEffect(() => {
    setFeatureFlag("jumpOnPlace", jumpOnPlaceEnabled);
  }, [jumpOnPlaceEnabled, setFeatureFlag]);

  // RAZ-15 show-mistakes mirror. <SudokuGrid> reads this (plus the
  // per-user setting and meta.solution availability) when deriving
  // which cells get the red "wrong value" tint.
  useEffect(() => {
    setFeatureFlag("showMistakes", showMistakesEnabled);
  }, [showMistakesEnabled, setFeatureFlag]);

  // Autosave: every time the relevant slice of state changes, debounce a
  // server action call. Only signed-in users autosave to the server;
  // anonymous players rely on the Zustand persist middleware.
  const snapshot = useGameStore((s) => s.snapshot);
  const board = useGameStore((s) => s.board);
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const isPaused = useGameStore((s) => s.isPaused);
  const debounce = useRef<number | null>(null);
  useEffect(() => {
    if (!isSignedIn || !meta) return;
    if (mode === "daily") return; // daily progress is intentionally not server-saved
    if (debounce.current) window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => {
      const snap = snapshot();
      if (!snap) return;
      void saveGameAction({
        puzzleId: snap.meta.puzzleId,
        board: snap.board,
        notesB64: snap.notesB64,
        elapsedMs: snap.elapsedMs,
        mistakes: snap.mistakes,
        hintsUsed: snap.hintsUsed,
        isPaused: snap.isPaused,
      });
    }, 4000);
    return () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    };
    // We deliberately only depend on values that should trigger save. The
    // store's `snapshot` is stable so it's safe to omit from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, elapsedMs, isPaused, meta, isSignedIn, mode]);

  // On completion, submit to the server once. We track submission status
  // for the completion modal so the user gets feedback if it failed.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  const submitted = useRef(false);
  useEffect(() => {
    if (!isComplete || !meta) return;
    setCompletionOpen(true);
    if (submitted.current) return;
    if (!isSignedIn) return; // anonymous completions are not recorded
    // RAZ-5 / daily-archive: archive completions are practice-only so we
    // skip the scored submit path entirely. Completion modal still shows.
    if (isArchive) {
      submitted.current = true;
      return;
    }
    submitted.current = true;
    setSubmitting(true);
    void (async () => {
      const snap = snapshot();
      if (!snap) {
        setSubmitting(false);
        return;
      }
      const res = await submitCompletionAction({
        puzzleId: snap.meta.puzzleId,
        board: snap.board,
        elapsedMs: snap.elapsedMs,
        mistakes: snap.mistakes,
        hintsUsed: snap.hintsUsed,
        mode: snap.meta.mode,
        dailyDate: dailyDate ?? null,
      });
      setSubmitting(false);
      if (!res.ok) setSubmitError(res.error);
    })();
  }, [isComplete, meta, isSignedIn, snapshot, dailyDate, isArchive]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!meta) return null; // first render before startGame() runs

  return (
    // On mobile we want the play screen as compact as possible so the
    // board can grow. We swap the Tailwind `container` class (which adds
    // generous horizontal padding) for a tight `px-2` + `max-w-screen-sm`
    // and trim vertical padding from py-6 to py-3. Desktop keeps the
    // generous container + py-10.
    <div className="mx-auto flex w-full max-w-screen-sm flex-col items-center gap-3 px-2 py-3 sm:container sm:gap-4 sm:py-10">
      <KeyboardListener onShortcuts={() => setShortcutsOpen(true)} />
      <VisibilityListener enabled={autoPauseEnabled} />
      {/* RAZ-24: polite ARIA live region that announces mistake count
          changes and conflict onset/resolution. Zero visible DOM; the
          element reads as sr-only. Sighted users get no layout impact. */}
      <LiveRegion />
      <div className="flex w-full max-w-[560px] items-center justify-between">
        <div className="flex flex-col text-sm text-muted-foreground">
          <span>
            {mode === "daily"
              ? "Daily puzzle"
              : `${DIFFICULTY_LABEL[puzzle.difficultyBucket]} puzzle`}
            {mode === "daily" && dailyDate ? ` · ${dailyDate}` : ""}
          </span>
          {/* RAZ-5: make it obvious an archive daily won't be scored so
              the player doesn't wonder why their leaderboard entry never
              appeared. */}
          {isArchive ? (
            <span className="text-xs text-muted-foreground/80">
              Archive · practice only (not scored)
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Timer />
          {/* Keyboard shortcuts overlay is desktop-only — there is no
              physical keyboard on a phone, so the button is just dead
              space there. Hide it below the sm breakpoint. */}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Keyboard shortcuts"
            onClick={() => setShortcutsOpen(true)}
            className="hidden sm:inline-flex"
          >
            <Keyboard />
          </Button>
          {/* Settings dialog. Shown on all viewports because it owns
              the RAZ-19 haptics toggle (a mobile-only setting) plus any
              future per-device prefs. Icon-only keeps the header
              compact next to the timer. */}
          <Button
            size="icon"
            variant="ghost"
            aria-label="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <SettingsIcon />
          </Button>
        </div>
      </div>

      <SudokuGrid />
      {/* Below-board region: 5 equal columns. Left stack of 3
          control buttons, 3x3 number pad (col-span-3 internally),
          right stack of 3 control buttons. Heights line up in 3
          rows across all three sub-regions. */}
      <div className="grid w-full max-w-[560px] grid-cols-5 gap-1 sm:gap-2">
        <ControlPanel side="left" />
        <NumberPad />
        <ControlPanel side="right" />
      </div>

      <CompletionModal
        open={completionOpen}
        onOpenChange={setCompletionOpen}
        submitting={submitting}
        submitError={submitError}
        previousBestMs={previousBestMs}
        shareEnabled={shareEnabled}
        dailyDate={dailyDate}
        isQuickPlay={isQuickPlay}
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </div>
  );
}
