"use client";

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/lib/zustand/game-store";
import {
  detectStuck,
  RESCUE_COOLDOWN_MS,
  type StuckSignal,
} from "@/lib/sudoku/stuck-detection";

// RAZ-48: Stuck Detection hook. Glues the pure detector
// (`lib/sudoku/stuck-detection.ts`) to the Zustand game store and
// owns the per-session COOLDOWN bookkeeping that the pure module
// intentionally does not.
//
// Design notes:
//   - We tick on a 5-second interval rather than reacting to every
//     `events` array change. A real player only needs ~5s
//     granularity for "have I been stuck long enough" prompts, and
//     a 5s interval keeps the React tree from re-evaluating on
//     every keystroke. The detector itself is O(window) so the
//     wall-clock cost per tick is well under 1ms.
//   - The cooldown is stored in a ref to avoid re-rendering the
//     hook just to flip a "we recently dismissed" boolean. Render
//     state is just the active signal + dismiss callback.
//   - The conflict-since anchor is computed inside the hook from
//     the store's `conflicts` set. We track the elapsedMs at which
//     the size first went non-zero in the current run; resetting
//     when the size returns to 0. This avoids putting timing state
//     into the store itself, which would couple gameplay reducers
//     to the rescue feature.
//
// The hook returns `null` when:
//   - the feature flag is off,
//   - the detector returned null,
//   - we're inside the cooldown window after a dismiss/accept,
//   - the player previously turned the rescue off in settings (TODO
//     in v2 — for v1 the flag is the only kill-switch).

export type ActiveStuckSignal = StuckSignal & {
  // Stable id per signal (kind + reason). Lets a parent component
  // memoize the chip and key-equality React props without
  // re-mounting on every tick when the signal didn't change.
  id: string;
  // Caller invokes when the player accepts the rescue (took the
  // hint) OR explicitly dismisses. Restarts the cooldown.
  acknowledge: () => void;
};

const TICK_MS = 5_000;

export function useStuckDetector(): ActiveStuckSignal | null {
  const events = useGameStore((s) => s.events);
  const conflicts = useGameStore((s) => s.conflicts);
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const isPaused = useGameStore((s) => s.isPaused);
  const isComplete = useGameStore((s) => s.isComplete);
  const flagOn = useGameStore((s) => s.featureFlags.stuckRescue);
  // RAZ-75: fresh activity anchor sourced from the store. Updates
  // on every player mutation independent of the telemetry buffer
  // gates, so the idle detector resets on a real move even when
  // event recording is off.
  const lastInputAtMs = useGameStore((s) => s.lastInputAtMs);

  // The conflict-since anchor — set when the conflict count
  // transitions 0 → non-zero, cleared when it returns to 0. We use a
  // ref for the "previous count" sentinel so we can detect
  // transitions without it being a React render input.
  const prevConflictCount = useRef(conflicts.size);
  const [conflictSinceMs, setConflictSinceMs] = useState<number | null>(null);
  useEffect(() => {
    const now = conflicts.size;
    const prev = prevConflictCount.current;
    if (prev === 0 && now > 0) {
      setConflictSinceMs(elapsedMs);
    } else if (prev > 0 && now === 0) {
      setConflictSinceMs(null);
    }
    prevConflictCount.current = now;
    // We only re-run when the size changes. `elapsedMs` is read
    // inside but is intentionally excluded from deps so we don't
    // re-anchor on every timer tick — only on the conflict-set
    // transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflicts.size]);

  // The currently-displayed signal. Only render state for the chip.
  const [signal, setSignal] = useState<ActiveStuckSignal | null>(null);

  // Cooldown bookkeeping. `cooldownUntilMs` is in elapsedMs units so
  // it lines up with how detectors anchor their windows.
  const cooldownUntilMs = useRef<number>(0);

  useEffect(() => {
    if (!flagOn) {
      setSignal(null);
      return;
    }

    function tick() {
      // Inline check rather than reading from outer-scope `signal`
      // so we don't have to put it in the deps array (which would
      // restart the interval on every signal change). We always
      // recompute from store + cooldown.
      const detected = detectStuck({
        events,
        conflictCount: conflicts.size,
        elapsedMs,
        conflictSinceMs,
        isRunning: !isPaused,
        isComplete,
        // RAZ-75: pass the activity anchor through. The detector
        // now uses this (not the events tail) to score idle.
        lastInputAtMs,
      });

      // Suppress while in cooldown OR when the signal is cleared.
      if (!detected || elapsedMs < cooldownUntilMs.current) {
        setSignal((curr) => (curr == null ? curr : null));
        return;
      }

      const id = `${detected.kind}:${detected.reason}`;
      setSignal((curr) => {
        // Keep the same object reference if the signal hasn't
        // meaningfully changed — saves a chip re-render.
        if (curr?.id === id) return curr;
        return {
          ...detected,
          id,
          acknowledge: () => {
            cooldownUntilMs.current = elapsedMs + RESCUE_COOLDOWN_MS;
            setSignal(null);
          },
        };
      });
    }

    tick(); // run once immediately so the chip can appear without waiting a full tick
    const handle = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(handle);
  }, [
    flagOn,
    events,
    conflicts,
    elapsedMs,
    conflictSinceMs,
    isPaused,
    isComplete,
    // RAZ-75: re-run the effect whenever the activity anchor changes
    // so the idle bubble disappears immediately on the next input
    // rather than waiting for the 5s tick interval.
    lastInputAtMs,
  ]);

  return signal;
}
