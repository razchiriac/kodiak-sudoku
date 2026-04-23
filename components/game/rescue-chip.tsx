"use client";

import { Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGameStore } from "@/lib/zustand/game-store";
import { useStuckDetector } from "./use-stuck-detector";

// RAZ-48: Rescue Chip. The visible surface of the stuck-detection
// system. Renders a small, dismissible pill above the controls grid
// when `useStuckDetector` returns a non-null signal.
//
// Design constraints from the ticket:
//   - "Rescue prompt never blocks gameplay" — the chip is a sibling
//     of the board, not an overlay; tapping outside doesn't dismiss
//     anything because there's nothing to dismiss.
//   - "Player can fully disable rescue prompts" — for v1 the
//     `stuck-rescue` Edge Config flag is the kill switch. A future
//     ticket adds a per-user opt-out toggle (deferred to keep this
//     PR small).
//
// The chip exposes ONE primary action (take a hint) and ONE
// secondary (dismiss). Both routes call `acknowledge()` which
// arms the cooldown so the chip won't reappear for ~90s. Taking a
// hint also fires the existing `hint()` reducer which counts
// toward the player's `hintsUsed` total, exactly as if they had
// pressed the Hint button — this keeps leaderboard semantics
// unchanged regardless of how the hint was triggered.

export function RescueChip() {
  const signal = useStuckDetector();
  const hint = useGameStore((s) => s.hint);

  if (!signal) return null;

  function onTakeHint() {
    if (!signal) return;
    signal.acknowledge();
    void hint();
  }

  function onDismiss() {
    signal?.acknowledge();
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Rescue suggestion: ${signal.reason}`}
      className="flex w-full max-w-[560px] items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
    >
      <Lightbulb className="h-4 w-4 shrink-0" aria-hidden />
      {/* The reason is short and deterministic; rendering it inline
          keeps the chip self-contained — no tooltip needed for
          accessibility. */}
      <span className="flex-1 text-xs leading-snug sm:text-sm">
        {signal.reason}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 border-amber-300 px-2 text-xs hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"
        onClick={onTakeHint}
      >
        Show me
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7 hover:bg-amber-100 dark:hover:bg-amber-900/40"
        aria-label="Dismiss rescue suggestion"
        onClick={onDismiss}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
