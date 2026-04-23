"use client";

import { useRef } from "react";
import { useGameStore } from "@/lib/zustand/game-store";
import { cn } from "@/lib/utils";

// Number pad. Renders as a 3x3 grid below the board (matches the
// visual rhythm of a phone keypad and gives chunky tap targets on
// mobile). In the composed play layout it's sandwiched between two
// stacks of control buttons, so it grid-col-spans 3 of the 5-col
// parent grid.
//
// Two state-aware behaviors live here:
//   - Remaining-digit subscript: how many of this digit are still
//     missing from the board. Helps the player pick the "closest to
//     done" digit next. Shown at every breakpoint now that each
//     button has plenty of vertical room.
//   - Notes indicator: in notes mode, each digit button reflects
//     whether that digit is currently a pencil mark on the selected
//     cell. Without this the notes-mode ring is the only hint you
//     are toggling marks, and you can't tell which ones are on.
//
// RAZ-20: holding a pad button for ≥400ms toggles that digit as a
// note on the currently-selected empty cell without leaving value
// mode. The long-press uses the standard (Android / iOS) convention
// of a short 400ms delay and a subtle haptic confirm on fire.

// Hold threshold in milliseconds. 400ms is the common default across
// sudoku apps and Android system gestures — shorter starts fighting
// the tap, longer feels sluggish.
const LONG_PRESS_MS = 400;

// Short vibration confirming the long-press fired. Best-effort; if
// navigator.vibrate is absent (desktop, iOS Safari) we silently skip.
// Gated by the haptics feature flag AND user setting so players who
// disabled haptics globally don't get a buzz on long-press either.
function maybeVibrate(hapticsOn: boolean) {
  if (!hapticsOn) return;
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & {
    vibrate?: (pattern: number | number[]) => boolean;
  };
  if (typeof nav.vibrate !== "function") return;
  try {
    // Single 30ms tap — deliberately shorter than the 40ms
    // placement/conflict pulses in game-store.ts so the user can
    // distinguish "note toggled" from "value placed" by feel.
    nav.vibrate([30]);
  } catch {
    // Some browsers throw without prior activation; swallow.
  }
}

export function NumberPad() {
  const inputDigit = useGameStore((s) => s.inputDigit);
  const toggleNoteOnSelection = useGameStore((s) => s.toggleNoteOnSelection);
  const board = useGameStore((s) => s.board);
  const mode = useGameStore((s) => s.mode);
  const selection = useGameStore((s) => s.selection);
  const notes = useGameStore((s) => s.notes);
  // RAZ-16: the digit most recently placed (or auto-advanced to when
  // the previous one exhausted). The store keeps this null when the
  // feature flag is off, so no extra gating is needed here.
  const activeDigit = useGameStore((s) => s.activeDigit);
  // RAZ-23: compact controls. Both the feature flag AND the user
  // setting must be on for compact to apply — gives us a kill switch
  // from Edge Config without stomping the user's preference.
  const compact =
    useGameStore((s) => s.featureFlags.compactControls && s.settings.compactControls);
  // RAZ-20: long-press flag. When off we skip the timer entirely and
  // the button behaves as a plain tap. Reading the flag from the
  // store (mirrored by PlayClient from the server-resolved value) so
  // flipping in Edge Config propagates without a page reload.
  const longPressEnabled = useGameStore((s) => s.featureFlags.longPressNote);
  // Haptics state for the long-press confirm pulse. We intentionally
  // reuse the same gate as value-placement haptics so "haptics off"
  // is a single switch for the whole game.
  const hapticsOn = useGameStore(
    (s) => s.featureFlags.haptics && s.settings.haptics !== false,
  );

  // Live digit counts. Recomputed on every render but cheap (single
  // 81 pass) so we avoid the complexity of a memoized selector.
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < 81; i++) counts[board[i]]++;

  // Notes indicator is only meaningful when the user is in notes
  // mode AND has selected an empty cell. inputDigit refuses to write
  // notes to filled or clue cells, so lighting up a button there
  // would be a false promise.
  const notesMask =
    mode === "notes" && selection != null && board[selection] === 0
      ? notes[selection]
      : 0;

  return (
    // col-span-3 so the pad occupies the middle 3 of 5 columns in
    // the play-client composition. A 3x3 grid inside means each
    // button lines up under the column above it.
    <div className="col-span-3 grid w-full grid-cols-3 gap-1">
      {Array.from({ length: 9 }, (_, i) => {
        const digit = i + 1;
        const remaining = 9 - counts[digit];
        const exhausted = remaining === 0;
        const isNoted = (notesMask & (1 << (digit - 1))) !== 0;
        // RAZ-16: highlight the "active" digit (last placed / auto-
        // advanced target). In notes mode the per-cell noted state
        // (`isNoted`) already owns the primary highlight styling, so
        // the active-digit ring only renders in value mode to avoid
        // the two signals clashing.
        const isActive = activeDigit === digit && mode === "value";
        return (
          <PadButton
            key={digit}
            digit={digit}
            remaining={remaining}
            // In notes mode the "exhausted" rule doesn't apply: you
            // can still pencil a digit that's fully placed on the
            // board (rare, but removing notes on peers of a value
            // placement can leave stale ones you want to clean up).
            disabled={exhausted && mode === "value"}
            mode={mode}
            isNoted={isNoted}
            isActive={isActive}
            compact={compact}
            longPressEnabled={longPressEnabled}
            hapticsOn={hapticsOn}
            onTap={() => inputDigit(digit)}
            onLongPress={() => toggleNoteOnSelection(digit)}
          />
        );
      })}
    </div>
  );
}

// Per-button props are collected into a single type so PadButton stays
// a thin presentational component and the long-press timer state
// (useRef) is isolated to exactly one button at a time.
type PadButtonProps = {
  digit: number;
  remaining: number;
  disabled: boolean;
  mode: "value" | "notes";
  isNoted: boolean;
  isActive: boolean;
  compact: boolean;
  longPressEnabled: boolean;
  hapticsOn: boolean;
  onTap: () => void;
  onLongPress: () => void;
};

// A single number-pad button. Split out from NumberPad so each button
// owns its own long-press timer via useRef (React doesn't allow hooks
// inside a loop). The render output is unchanged from the previous
// inline version; only the event handlers differ.
function PadButton({
  digit,
  remaining,
  disabled,
  mode,
  isNoted,
  isActive,
  compact,
  longPressEnabled,
  hapticsOn,
  onTap,
  onLongPress,
}: PadButtonProps) {
  // Timer for the long-press countdown. Nullable so we can clear it
  // on pointerup / leave / cancel without tracking a boolean "active"
  // flag separately.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Set to true when the timer elapses. We read this in onClick to
  // suppress the normal tap handler so a long-press doesn't double
  // as a placement. Reset to false at the start of every pointerdown.
  const firedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handlePointerDown = () => {
    // Always reset the fired flag at the start of a new gesture;
    // without this a fast double-tap could inherit the "long press
    // just fired" state from the previous gesture and the first
    // click would be incorrectly swallowed.
    firedRef.current = false;
    if (!longPressEnabled) return;
    // Disabled buttons already block onClick, but we also skip the
    // timer so we don't waste a setTimeout on an interaction that
    // won't do anything.
    if (disabled) return;
    clearTimer();
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      onLongPress();
      maybeVibrate(hapticsOn);
    }, LONG_PRESS_MS);
  };

  const handleClick = () => {
    // Long-press already did the work; skip placement and consume the
    // fired flag so the next click is a normal tap again.
    clearTimer();
    if (firedRef.current) {
      firedRef.current = false;
      return;
    }
    onTap();
  };

  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={handlePointerDown}
      // Any of the following ends the gesture. We don't distinguish
      // between "finger lifted" and "finger moved off the button" —
      // both abort the long-press.
      onPointerUp={clearTimer}
      onPointerLeave={clearTimer}
      onPointerCancel={clearTimer}
      onClick={handleClick}
      className={cn(
        // Flex column owns the layout. The remaining-count is
        // a normal flow child so it never overlaps the digit.
        //
        // Height strategy: fixed h-16 (64px) at every breakpoint.
        // Previously mobile used aspect-square (~75px buttons on
        // a 374px viewport), but that ate too much vertical space
        // and left the board tiny on iOS Chrome where the dynamic
        // viewport height is shorter. 64px still exceeds Apple's
        // 44pt HIG minimum for comfortable touch targets.
        //
        // RAZ-23: compact mode shrinks to h-14 (56px), still above
        // the 44pt minimum.
        compact
          ? "flex h-14 min-h-12 flex-col items-center justify-center gap-0.5 rounded-md border bg-card text-2xl font-semibold leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30"
          : "flex h-16 min-h-12 flex-col items-center justify-center gap-0.5 rounded-md border bg-card text-2xl font-semibold leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30",
        // Notes mode: a soft ring on every button telegraphs
        // the mode.
        mode === "notes" && "ring-2 ring-primary/40",
        // Per-digit "this note is ON for the selected cell"
        // indicator. Filled background + primary text so it
        // reads clearly even without the ring.
        isNoted && "bg-primary/20 text-primary ring-primary",
        // RAZ-16 active-digit highlight. Subtle background tint +
        // ring so the ring is visible against both the default
        // and hover backgrounds. Only rendered in value mode
        // (see isActive above); in notes mode isNoted drives the
        // primary visual.
        isActive && "bg-primary/15 ring-2 ring-primary/70",
        // RAZ-20: the gesture-hint CSS property helps user-agents
        // avoid intercepting a long-press for a browser context
        // menu on mobile. Opt out of the native text-selection
        // menu on iOS too, which otherwise pops up on a 400ms
        // hold and ruins the gesture.
        longPressEnabled && "touch-none select-none",
      )}
      aria-label={`${mode === "notes" ? "Toggle note" : "Place"} ${digit}${
        disabled ? " (none remaining)" : ""
      }${isNoted ? " (currently noted)" : ""}${isActive ? " (active)" : ""}${
        // Small affordance for screen-reader users: advertise the
        // long-press behavior so non-sighted players can discover it.
        // Only in value mode on empty selections where the gesture
        // actually does something.
        longPressEnabled && mode === "value" && !disabled
          ? ". Hold to toggle as a note."
          : ""
      }`}
      aria-pressed={mode === "notes" ? isNoted : isActive ? true : undefined}
    >
      <span>{digit}</span>
      {/* Remaining-count subscript. Fits in h-16 (64px) buttons
          alongside the digit thanks to the narrow line-height. */}
      <span className="text-[10px] font-normal leading-none text-muted-foreground">
        {remaining}
      </span>
    </button>
  );
}
