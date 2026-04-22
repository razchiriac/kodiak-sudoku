"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useGameStore } from "@/lib/zustand/game-store";

// RAZ-21 - Auto-pause on tab hidden and input idle.
//
// Mounts once per play page (alongside KeyboardListener). No DOM output;
// it's a pure side-effect component. Gated on `enabled` so the flag can
// turn the feature off without a redeploy.
//
// Behavior:
//   1. When `document.hidden === true`, pause the game (if not already
//      paused and not complete). Remember that WE paused it via a ref.
//   2. When `document.hidden === false` and we were the ones who paused,
//      show a sonner toast explaining why, then auto-resume. We do not
//      touch a user-initiated pause — the ref is the sole guard.
//   3. After `idleMs` of no pointerdown/keydown anywhere on the page,
//      pause and flag it as auto-pause the same way. Next user input
//      dismisses the auto-pause (same branch as #2).
//
// The idle timer uses pointerdown/keydown/touchstart on `window` so we
// catch interaction anywhere in the document. The Zustand store actions
// themselves already run on user input paths, but piggybacking on the
// store would miss idle-reset for things like cell selection via mouse
// hover or shortcuts overlay interactions.

const DEFAULT_IDLE_MS = 90_000;

export function VisibilityListener({
  enabled,
  idleMs = DEFAULT_IDLE_MS,
}: {
  enabled: boolean;
  idleMs?: number;
}) {
  const setPaused = useGameStore((s) => s.setPaused);

  // Tracks whether the CURRENT pause was issued by us. Only when true
  // do we auto-resume on return — a user who manually hit Space should
  // stay paused until they resume themselves.
  const pausedByAuto = useRef(false);
  // Idle-timer handle. Cleared on every qualifying input and on unmount.
  const idleTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    // Read the latest store state on each callback rather than closing
    // over a stale `isPaused`. Cheap — getState() is synchronous and
    // reads the current snapshot.
    const getState = useGameStore.getState;

    function pauseIfPlaying() {
      const s = getState();
      if (s.isPaused || s.isComplete || !s.meta) return;
      pausedByAuto.current = true;
      setPaused(true);
    }

    function resumeIfAutoPaused(reason: "visibility" | "input") {
      if (!pausedByAuto.current) return;
      pausedByAuto.current = false;
      setPaused(false);
      // Skip the toast when the resume was triggered by the user's own
      // input — seeing "Auto-paused while you were away" after they
      // tap a cell feels noisy. Reserve the toast for the visibility
      // path, which is the one the user might not have noticed.
      if (reason === "visibility") {
        toast("Resumed — timer was paused while the tab was hidden", {
          // Short duration; this is informational, not a CTA.
          duration: 3000,
        });
      }
    }

    function scheduleIdle() {
      // Clear any prior timer so the 90s window is always "time since
      // the last user interaction," not "time since the first timer
      // fired after page load."
      if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => {
        pauseIfPlaying();
      }, idleMs);
    }

    function onVisibilityChange() {
      if (document.hidden) {
        pauseIfPlaying();
      } else {
        resumeIfAutoPaused("visibility");
        // Arm a fresh idle timer only when we come back with the game
        // in an unpaused state. If the user manually paused before
        // leaving, we respect that and don't start the idle clock.
        const s = getState();
        if (!s.isPaused && !s.isComplete) scheduleIdle();
      }
    }

    function onUserInput() {
      // Any input both dismisses an active auto-pause AND resets the
      // idle clock.
      resumeIfAutoPaused("input");
      scheduleIdle();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pointerdown", onUserInput, { passive: true });
    window.addEventListener("keydown", onUserInput);
    window.addEventListener("touchstart", onUserInput, { passive: true });

    // Start the initial idle timer so the page doesn't need a first
    // input before the clock begins ticking.
    scheduleIdle();

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pointerdown", onUserInput);
      window.removeEventListener("keydown", onUserInput);
      window.removeEventListener("touchstart", onUserInput);
      if (idleTimer.current != null) window.clearTimeout(idleTimer.current);
      idleTimer.current = null;
      // Intentionally DO NOT auto-resume on unmount: if we auto-paused
      // and then the component unmounts (navigation), leaving the game
      // paused is the safer default — the user's time doesn't tick while
      // they're elsewhere.
    };
  }, [enabled, idleMs, setPaused]);

  return null;
}
