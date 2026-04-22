"use client";

import { useEffect, useRef, useState } from "react";
import { useGameStore } from "@/lib/zustand/game-store";

// RAZ-24: polite ARIA live region that keeps screen-reader users
// abreast of gameplay state changes that aren't obvious from the
// selected cell label alone:
//
//   - Mistake count: announced when it increments. The player hears
//     "2 mistakes" right after a placement creates a conflict, so
//     they know their input caused a problem even if they haven't
//     moved the virtual cursor off the cell yet.
//   - Conflict cells: announced when the set changes from empty to
//     non-empty (or vice versa). Uses cell coordinates so the user
//     can navigate to the offending row/column directly.
//
// Implementation notes:
//   - `aria-live="polite"` so the announcement queues behind whatever
//     VoiceOver / TalkBack was already reading (usually the cell
//     label) rather than interrupting. `aria-atomic="true"` makes
//     the full message re-read on each change instead of only
//     reading the diff.
//   - The visible content is visually hidden via `sr-only` so the
//     region doesn't occupy layout space. This is the exact idiom
//     Tailwind documents for live regions.
//   - We debounce changes into the DOM via an effect that reads the
//     PREVIOUS value from a ref so we never announce on initial
//     mount (which would dump "0 mistakes" on every page load).
//
// The component renders nothing until the first relevant change, so
// it's a zero-cost addition for sighted users.

export function LiveRegion() {
  const mistakes = useGameStore((s) => s.mistakes);
  const conflicts = useGameStore((s) => s.conflicts);
  const isComplete = useGameStore((s) => s.isComplete);

  // Announcement text. `null` means "nothing to announce yet"; the
  // aria-live region stays empty on first paint so we don't blurt out
  // "0 mistakes" before the player has done anything.
  const [message, setMessage] = useState<string | null>(null);

  // Track the previous values across renders. Refs (not state) because
  // we only need them for the diff check; re-rendering on every change
  // would be wasted work.
  const prevMistakes = useRef<number | null>(null);
  const prevConflictCount = useRef<number | null>(null);

  useEffect(() => {
    // Skip the "very first render" case — both prevs are null on mount
    // and we must not announce baseline state. On subsequent renders we
    // compare to the recorded previous values and only announce when
    // something changed.
    if (prevMistakes.current !== null && mistakes > prevMistakes.current) {
      setMessage(
        mistakes === 1 ? "1 mistake" : `${mistakes} mistakes`,
      );
    }
    prevMistakes.current = mistakes;
  }, [mistakes]);

  useEffect(() => {
    const count = conflicts.size;
    if (prevConflictCount.current !== null) {
      if (count > 0 && prevConflictCount.current === 0) {
        // First conflict (or new conflict set after a clean board).
        // Announce the specific coordinates if there's exactly one so
        // the user can navigate straight to it; else fall back to a
        // summary count to avoid a wall of text.
        if (count === 1) {
          const [first] = Array.from(conflicts);
          const row = Math.floor(first / 9) + 1;
          const col = (first % 9) + 1;
          setMessage(`Conflict at row ${row}, column ${col}`);
        } else {
          setMessage(`${count} conflicts on the board`);
        }
      } else if (count === 0 && prevConflictCount.current > 0) {
        // Cleared — worth announcing so the user knows their fix
        // landed.
        setMessage("Conflicts resolved");
      }
    }
    prevConflictCount.current = count;
  }, [conflicts]);

  useEffect(() => {
    // Completion has its own modal UI; we announce it here too so a
    // screen-reader user who hasn't yet moved focus to the modal gets
    // the win confirmation from the live region first.
    if (isComplete) setMessage("Puzzle complete");
  }, [isComplete]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      // sr-only is the canonical Tailwind pattern for visually-hidden
      // content that's still readable by assistive tech.
      className="sr-only"
    >
      {message}
    </div>
  );
}
