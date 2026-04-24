"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useGameStore } from "@/lib/zustand/game-store";
import {
  COACH_TIP_KINDS,
  COACH_TIP_TUNABLES,
  extractTip,
  type CoachTip,
  type CoachTipKind,
} from "@/lib/sudoku/coach-tips";

// RAZ-49 — Adaptive Coach Mode hook.
//
// Glues the pure tip engine (`lib/sudoku/coach-tips.ts`) to the
// Zustand game store and owns ALL per-session bookkeeping that the
// pure engine intentionally does not (cooldowns, snoozes, dismiss
// callbacks, total-notes accounting). Mirrors the same split we use
// for RAZ-48's `useStuckDetector` + `detectStuck`.
//
// Why this lives in `components/game/` rather than `lib/`:
//   - It's a React hook. Anything that calls `useGameStore` is part
//     of the React surface and can't be imported by the framework-
//     free engine in `lib/sudoku/`.
//   - Co-locating with the banner (`coach-tip-banner.tsx`) keeps the
//     two pieces of the surface close together.
//
// Cadence:
//   We tick on a 5-second interval AND also re-evaluate whenever the
//   store's `events` / `conflicts` / `lastHintAtMs` change. The
//   interval covers time-based detectors (technique-followup window
//   expiry, mistake-streak slide-off) without forcing the user to
//   click anything; the deps array covers the "something just
//   happened" case so the conflict-explainer can appear within ~16ms
//   of the player typing a wrong digit.
//
// Cooldown / snooze policy (per kind):
//   - conflict-explainer:  60s after dismiss. Conflicts evolve fast;
//                          a long cooldown would feel unhelpful.
//   - technique-followup:  Snoozed for the rest of the puzzle once
//                          the player dismisses any technique tip.
//                          Players who don't want technique reminders
//                          shouldn't have to dismiss them again on
//                          every hint.
//   - mistake-streak:      120s after dismiss. Long enough that the
//                          tip doesn't immediately reappear if the
//                          player keeps making mistakes; short enough
//                          that genuinely persistent guessing eventually
//                          re-triggers it.
//   - notes-encouragement: Snoozed for the rest of the puzzle. One
//                          shot per attempt — same intent as the
//                          engine's MAX_NOTES guard.

export type ActiveCoachTip = CoachTip & {
  // Stable id per tip (kind + dedupeKey). Used by the renderer for
  // memo / animation keys so the banner doesn't re-mount when only
  // the discriminator changes.
  id: string;
  // Player tapped the X. Restarts the per-kind cooldown OR snoozes
  // for the puzzle, depending on the kind's policy.
  dismiss: () => void;
};

const TICK_MS = 5_000;

// Per-kind cooldown. Number = ms before the kind is allowed to fire
// again. "puzzle" = snoozed for the entire current puzzle attempt.
const COOLDOWNS_MS: Record<CoachTipKind, number | "puzzle"> = {
  "conflict-explainer": 60_000,
  "technique-followup": "puzzle",
  "mistake-streak": 120_000,
  "notes-encouragement": "puzzle",
};

// Count populated bits across the notes Uint16Array. Used by the
// `notes-encouragement` detector. We compute this in the hook (not
// the engine) because it's cheap and keeps the engine input shape
// stable when we tweak the bit-count algorithm.
function countNotes(notes: Uint16Array): number {
  let total = 0;
  for (let i = 0; i < notes.length; i++) {
    let v = notes[i];
    while (v) {
      v &= v - 1;
      total++;
    }
  }
  return total;
}

export function useCoachTips(): ActiveCoachTip | null {
  const flagOn = useGameStore((s) => s.featureFlags.adaptiveCoach);
  // Per-user kill switch from the settings dialog. Defaults true via
  // the INITIAL block, but a player who opted out should never see
  // a banner regardless of the flag.
  const settingOn = useGameStore((s) => s.settings.coachingTips !== false);

  const board = useGameStore((s) => s.board);
  const fixed = useGameStore((s) => s.fixed);
  const variant = useGameStore((s) => s.meta?.variant ?? "standard");
  const solution = useGameStore((s) => s.meta?.solution ?? null);
  const conflicts = useGameStore((s) => s.conflicts);
  const events = useGameStore((s) => s.events);
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const hintsUsed = useGameStore((s) => s.hintsUsed);
  const lastHintAtMs = useGameStore((s) => s.lastHintAtMs);
  const lastHintTechnique = useGameStore((s) => s.lastHintTechnique);
  const isPaused = useGameStore((s) => s.isPaused);
  const isComplete = useGameStore((s) => s.isComplete);
  const inputMode = useGameStore((s) => s.mode);
  const notes = useGameStore((s) => s.notes);
  // Tying the per-puzzle suppression set to the active puzzleId
  // means starting a new puzzle clears all snoozes — exactly what
  // we want, since "snoozed for this attempt" should not bleed
  // into the next one.
  const puzzleId = useGameStore((s) => s.meta?.puzzleId ?? null);

  // Per-kind cooldowns (ms-based). Held in refs so the timer state
  // doesn't trigger React renders by itself.
  const cooldownUntilMs = useRef<Record<CoachTipKind, number>>({
    "conflict-explainer": 0,
    "technique-followup": 0,
    "mistake-streak": 0,
    "notes-encouragement": 0,
  });

  // Per-puzzle snoozes. Reset when the active puzzleId changes (see
  // the effect below). Stored in state because the engine's
  // `suppressedKinds` input must be stable across the render that
  // applies a snooze — using a ref alone wouldn't trigger a
  // recompute.
  const [snoozedKinds, setSnoozedKinds] = useState<Set<CoachTipKind>>(
    () => new Set(),
  );
  const lastPuzzleIdRef = useRef<number | null>(puzzleId);
  useEffect(() => {
    if (lastPuzzleIdRef.current !== puzzleId) {
      lastPuzzleIdRef.current = puzzleId;
      // Brand-new puzzle: clear every snooze AND every cooldown so
      // the player gets a fresh start. (We can't trust elapsedMs
      // monotonicity across attempts.)
      setSnoozedKinds(new Set());
      for (const kind of COACH_TIP_KINDS) cooldownUntilMs.current[kind] = 0;
    }
  }, [puzzleId]);

  // Currently displayed tip. Re-derived inside the tick effect.
  const [tip, setTip] = useState<ActiveCoachTip | null>(null);

  // Compute totalNotesPlaced once per `notes` change. The engine
  // expects a number, so doing the popcount here keeps the engine
  // pure and fast.
  const totalNotesPlaced = useMemo(() => countNotes(notes), [notes]);

  useEffect(() => {
    if (!flagOn || !settingOn) {
      setTip(null);
      return;
    }

    function recompute() {
      // Build the suppressed set from the per-puzzle snooze list
      // PLUS any kind whose cooldown is still active.
      const suppressed = new Set<CoachTipKind>(snoozedKinds);
      for (const kind of COACH_TIP_KINDS) {
        if (elapsedMs < cooldownUntilMs.current[kind]) suppressed.add(kind);
      }

      const next = extractTip({
        board,
        fixed,
        variant,
        solution,
        conflicts,
        events,
        elapsedMs,
        hintsUsed,
        lastHintAtMs,
        lastHintTechnique,
        notesModeOn: inputMode === "notes",
        totalNotesPlaced,
        suppressedKinds: suppressed,
        isRunning: !isPaused,
        isComplete,
      });

      if (!next) {
        setTip((curr) => (curr == null ? curr : null));
        return;
      }

      const id = `${next.kind}:${next.dedupeKey}`;
      setTip((curr) => {
        if (curr?.id === id) return curr;
        return {
          ...next,
          id,
          dismiss: () => {
            const policy = COOLDOWNS_MS[next.kind];
            if (policy === "puzzle") {
              setSnoozedKinds((prev) => {
                if (prev.has(next.kind)) return prev;
                const out = new Set(prev);
                out.add(next.kind);
                return out;
              });
            } else {
              cooldownUntilMs.current[next.kind] = elapsedMs + policy;
            }
            setTip(null);
          },
        };
      });
    }

    recompute();
    const handle = window.setInterval(recompute, TICK_MS);
    return () => window.clearInterval(handle);
  }, [
    flagOn,
    settingOn,
    board,
    fixed,
    variant,
    solution,
    conflicts,
    events,
    elapsedMs,
    hintsUsed,
    lastHintAtMs,
    lastHintTechnique,
    inputMode,
    totalNotesPlaced,
    snoozedKinds,
    isPaused,
    isComplete,
  ]);

  return tip;
}

// Internal-use export: the same cooldown table the hook uses. Not
// part of the engine's COACH_TIP_TUNABLES because cooldown timing
// is a UI/UX policy, not a deterministic engine knob. Exported so
// tests can reach in without re-defining the table.
export const COACH_TIP_COOLDOWNS_MS = COOLDOWNS_MS;

// Re-export the engine's tunables so a future feature can pull a
// single constants module via this hook without reaching into the
// engine module directly. Cheap convenience.
export { COACH_TIP_TUNABLES };
