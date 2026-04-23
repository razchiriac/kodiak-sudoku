"use client";

import { useEffect, useRef, useState } from "react";
import { Keyboard, Printer, Settings as SettingsIcon, Swords } from "lucide-react";
import { toast } from "sonner";
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
import { PrintDialog } from "@/components/game/print-dialog";
import { Button } from "@/components/ui/button";
import {
  flushInputEventsAction,
  hintAction,
  saveGameAction,
  submitCompletionAction,
} from "@/lib/server/actions";
import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";

// The interactive Sudoku page. Drives the Zustand store, wires up
// autosave, completion submission, and the shortcuts overlay.

type PuzzleProp = {
  id: number;
  puzzle: string;
  solution: string;
  difficultyBucket: number;
  // RAZ-18: Puzzle variant. Defaults to "standard" if absent (for
  // backwards compatibility with existing callers).
  variant?: string;
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
  isCustom = false,
  challenge = null,
  challengeLinkEnabled = false,
  currentUsername = null,
  printPuzzleEnabled = false,
  progressiveHintsEnabled = false,
  eventLogEnabled = false,
  modePresetsEnabled = false,
  breakdownEnabled = false,
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
  // RAZ-35: when true, this is a user-pasted puzzle (no DB row,
  // no leaderboard). Skip BOTH the autosave path AND the submit
  // path, and render a "Custom puzzle · not saved" badge.
  isCustom?: boolean;
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
  // RAZ-13: challenge metadata. When the URL arrived with `?from=<user>`
  // and that user has a valid random-mode best time for this puzzle,
  // the server resolves it and forwards the payload here. Rendered as
  // a small banner above the board. Null = no challenge, no banner.
  challenge?: {
    username: string;
    displayName: string | null;
    bestTimeMs: number;
  } | null;
  // RAZ-13: whether the feature flag is on. When false the completion
  // modal's Challenge action is hidden AND the banner is not rendered
  // even if `challenge` somehow arrived non-null (defensive — the page
  // nulls it server-side too).
  challengeLinkEnabled?: boolean;
  // RAZ-13: current viewer's username, used to seed the
  // `?from=<username>` param the Challenge button copies. Null when
  // anonymous or when the signed-in user hasn't set a username.
  currentUsername?: string | null;
  // RAZ-9: server-resolved value of `print-puzzle`. Controls whether
  // the printer icon in the header is rendered and, implicitly,
  // whether the print dialog is reachable from this view. The route
  // handler checks the flag again server-side so a direct URL with
  // the flag off still 403s.
  printPuzzleEnabled?: boolean;
  // RAZ-14: server-resolved value of `progressive-hints`. Mirrored into
  // the store so the `hint()` action decides whether to step through
  // the three-tier disclosure vs. the legacy one-shot reveal. The
  // ControlPanel also reads the store to show a tier indicator.
  progressiveHintsEnabled?: boolean;
  // RAZ-28: server-resolved value of `event-log`. Mirrored into the
  // store so the mutation reducers check this flag (in addition to the
  // per-user `recordEvents` setting) before appending to the events
  // ring buffer. ALSO gates the periodic flush effect below — when
  // off, we skip even calling the server action so there's zero
  // network traffic from this feature in the default state. The
  // SettingsDialog reads the same flag to decide whether to render
  // the opt-in toggle.
  eventLogEnabled?: boolean;
  // RAZ-54: server-resolved value of `mode-presets`. Mirrored into the
  // store so the SettingsDialog's inline preset picker (and any
  // future surfaces) gate on the same source of truth without prop-
  // drilling. When false, the picker is hidden everywhere.
  modePresetsEnabled?: boolean;
  // RAZ-45: server-resolved value of `post-game-breakdown`. Forwarded
  // straight to the CompletionModal which renders / hides the
  // BreakdownPanel based on it. No store mirror needed because the
  // panel is a one-time render at completion — no other surface
  // gates on this flag.
  breakdownEnabled?: boolean;
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
        variant: (puzzle.variant as import("@/lib/sudoku/board").Variant) ?? "standard",
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
      if (!res.ok) {
        // RAZ-29: the hint endpoint throttles at 3/min, 30/hr. Surface
        // a friendly toast explaining which cap was hit rather than
        // silently dropping the click. The store's hint() swallows
        // the throw below so the toast is the ONLY feedback the user
        // gets — without this, a rate-limited daily-puzzle click feels
        // like a dead button.
        if (res.error === "rate_limited") {
          toast("Too many hint requests.", {
            description: `Try again soon — limit is ${res.limit}.`,
          });
        }
        throw new Error(res.error);
      }
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

  // RAZ-14 progressive-hints mirror. The store's `hint()` action reads
  // this to choose between the three-tier disclosure flow and the
  // legacy one-click placement. Flipping the flag to false in Edge
  // Config is an instant kill switch — any in-flight session stays
  // active on the current page load (the session is transient and
  // dies on the next clearing action) but new sessions revert to the
  // legacy behavior immediately.
  useEffect(() => {
    setFeatureFlag("progressiveHints", progressiveHintsEnabled);
  }, [progressiveHintsEnabled, setFeatureFlag]);

  // RAZ-54 mode-presets mirror. The SettingsDialog reads the mirrored
  // flag to decide whether to render the inline preset picker; the
  // ModePresetPicker component on /play also reads it via its own
  // mirror. Same pattern as every other UI-gate flag — flipping the
  // flag off in Edge Config takes effect on the next render with no
  // redeploy required.
  useEffect(() => {
    setFeatureFlag("modePresets", modePresetsEnabled);
  }, [modePresetsEnabled, setFeatureFlag]);

  // RAZ-28 event-log mirror. The store gates recording on this flag AND
  // the per-user `recordEvents` setting, so flipping this to false in
  // Edge Config stops recording instantly — even for users who had
  // previously opted in. Their pref stays persisted and will reactivate
  // the moment the flag is flipped back on.
  useEffect(() => {
    setFeatureFlag("eventLog", eventLogEnabled);
  }, [eventLogEnabled, setFeatureFlag]);

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
    // RAZ-35: user-pasted puzzles have no DB row, so there's nothing
    // the autosave endpoint could upsert into. Skip entirely.
    if (isCustom) return;
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
  }, [board, elapsedMs, isPaused, meta, isSignedIn, mode, isCustom]);

  // On completion, submit to the server once. We track submission status
  // for the completion modal so the user gets feedback if it failed.
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [completionOpen, setCompletionOpen] = useState(false);
  // RAZ-32: rank context returned by `submitCompletionAction` for
  // daily completions. Null until the submit resolves, or forever
  // when the flag is off / the user is anonymous / the completion
  // was an archive practice run.
  const [rankContext, setRankContext] = useState<{
    total: number;
    slower: number;
    percentile: number;
  } | null>(null);
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
    // RAZ-35: custom (pasted) puzzles aren't in the DB, so there's
    // nothing `submitCompletionAction` could record. Same short-circuit.
    if (isCustom) {
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
      if (!res.ok) {
        setSubmitError(res.error);
        return;
      }
      // RAZ-32: stash the rank context so the modal can render
      // "You beat 73% of today's solvers". Null for random mode.
      if (res.rankContext) setRankContext(res.rankContext);
      // RAZ-10: surface newly-earned achievements as a series of
      // toasts. We fan them out one at a time (rather than a
      // single combined toast) so the player feels the individual
      // pop for each one. Capped at 3 to avoid spamming on the
      // rare first-solve case that unlocks multiple at once.
      if (res.newlyEarned && res.newlyEarned.length > 0) {
        for (const badge of res.newlyEarned.slice(0, 3)) {
          toast.success(`Achievement unlocked: ${badge.title}`);
        }
      }
    })();
  }, [isComplete, meta, isSignedIn, snapshot, dailyDate, isArchive, isCustom]);

  // RAZ-28 — Periodic flush of the in-memory input-event ring buffer
  // to the server. We fire under three triggers: every ~15 seconds
  // of activity, on completion, and on page-hide (pagehide fires on
  // both real navigations and iOS app backgrounding). Keeping the
  // cadence well above the 4s autosave means a flush typically rides
  // alongside at most one autosave rather than spamming the network.
  //
  // Why debounce on `board + elapsedMs` instead of `events.length`:
  // reading `events` would subscribe this component to every single
  // keystroke, causing a rerender per placement. We piggyback on
  // already-subscribed slices and rely on drainEvents() to no-op when
  // the buffer is empty.
  const drainEvents = useGameStore((s) => s.drainEvents);
  const flushTimer = useRef<number | null>(null);
  useEffect(() => {
    if (!eventLogEnabled) return;
    // RAZ-35: custom puzzles have no DB row; the flush endpoint would
    // reject with puzzle_not_found every time. Skip cleanly.
    if (isCustom) return;
    if (!meta) return;
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      const batch = drainEvents();
      if (batch.events.length === 0) return;
      void flushInputEventsAction({
        puzzleId: meta.puzzleId,
        seq: batch.seq,
        completed: false,
        events: batch.events,
      });
    }, 15000);
    return () => {
      if (flushTimer.current) window.clearTimeout(flushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, elapsedMs, meta, isCustom, eventLogEnabled]);

  // Flush once on completion, tagged with completed=true so consumers
  // know this is the terminal batch for the attempt. This runs in
  // addition to the submitCompletionAction path — keeping the two
  // separate means a flush failure can't block the completion (which
  // is the bit that lands on the leaderboard).
  useEffect(() => {
    if (!eventLogEnabled) return;
    if (!isComplete || !meta) return;
    if (isCustom) return;
    const batch = drainEvents();
    void flushInputEventsAction({
      puzzleId: meta.puzzleId,
      seq: batch.seq,
      completed: true,
      events: batch.events,
    });
  }, [isComplete, meta, drainEvents, eventLogEnabled, isCustom]);

  // Best-effort flush when the tab is hidden or the page is unloading.
  // `pagehide` is the canonical event (works on iOS where `beforeunload`
  // is unreliable); we also listen to `visibilitychange` so a user
  // switching apps mid-puzzle doesn't lose the last buffered batch.
  // Fire-and-forget — we can't await a promise here and the server
  // action happens to be fast enough to usually complete before the
  // page unload. Worst case we lose one batch.
  useEffect(() => {
    if (!eventLogEnabled) return;
    if (isCustom) return;
    if (!meta) return;
    const onHide = () => {
      const batch = drainEvents();
      if (batch.events.length === 0) return;
      void flushInputEventsAction({
        puzzleId: meta.puzzleId,
        seq: batch.seq,
        completed: false,
        events: batch.events,
      });
    };
    const onVis = () => {
      if (document.visibilityState === "hidden") onHide();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [drainEvents, eventLogEnabled, isCustom, meta]);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // RAZ-9: print dialog visibility. Default closed; opened from the
  // header button. Kept as a sibling to the other dialog state rather
  // than hoisted into the store because only this component cares.
  const [printOpen, setPrintOpen] = useState(false);

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
      {/* RAZ-13: challenge banner. Rendered above the header row so
          it's the first thing the player sees when they open a shared
          puzzle. `aria-live="polite"` is not set because the banner
          is static for the lifetime of the page and doesn't need to
          re-announce. The `Swords` icon echoes the "friendly duel"
          framing from the share button copy in the modal. */}
      {challengeLinkEnabled && challenge ? (
        <div
          className="flex w-full max-w-[560px] items-center gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm"
          role="note"
          aria-label={`Challenge from ${challenge.displayName ?? challenge.username}`}
        >
          <Swords className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span>
            Beat{" "}
            <span className="font-semibold">
              @{challenge.displayName ?? challenge.username}
            </span>
            &apos;s time of{" "}
            <span className="font-mono tabular-nums">
              {formatTime(challenge.bestTimeMs)}
            </span>
          </span>
        </div>
      ) : null}
      <div className="flex w-full max-w-[560px] items-center justify-between">
        <div className="flex flex-col text-sm text-muted-foreground">
          <span>
            {isCustom
              ? "Custom puzzle"
              : mode === "daily"
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
          {/* RAZ-35: same framing for pasted puzzles. Players need to
              know this isn't going to their stats / leaderboard. */}
          {isCustom ? (
            <span className="text-xs text-muted-foreground/80">
              Imported · not saved, not scored
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
          {/* RAZ-9: Print dialog entry point. Hidden for custom
              (pasted) puzzles because they have no DB row the route
              handler can fetch — rendering a broken button is worse
              than hiding the feature. Also hidden when the flag is
              off, to avoid signposting a 403. */}
          {printPuzzleEnabled && !isCustom ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label="Print puzzle"
              onClick={() => setPrintOpen(true)}
            >
              <Printer />
            </Button>
          ) : null}
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
        challenge={challenge}
        challengeLinkEnabled={challengeLinkEnabled}
        currentUsername={currentUsername}
        rankContext={rankContext}
        breakdownEnabled={breakdownEnabled}
      />
      <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      {/* RAZ-9: only mount the print dialog when the flag is on AND
          this isn't a custom puzzle (no DB row to fetch). Mounting
          it conditionally rather than controlling visibility via the
          `open` prop saves a bit of initial bundle since the dialog
          pulls in base64 + serialize helpers. */}
      {printPuzzleEnabled && !isCustom ? (
        <PrintDialog
          open={printOpen}
          onOpenChange={setPrintOpen}
          puzzleId={puzzle.id}
        />
      ) : null}
    </div>
  );
}
