"use client";

import { useGameStore } from "@/lib/zustand/game-store";
import { cn } from "@/lib/utils";

// Number pad. On desktop it shows remaining-digit counts so the player
// can spot the digit closest to being fully placed; on mobile it doubles
// as the primary input method, so we hide the count subscript there to
// keep each button a clean tap target.
export function NumberPad() {
  const inputDigit = useGameStore((s) => s.inputDigit);
  const board = useGameStore((s) => s.board);
  const mode = useGameStore((s) => s.mode);

  // Live digit counts. Recomputed on every render but cheap (single 81
  // pass) so we avoid the complexity of a memoized selector.
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < 81; i++) counts[board[i]]++;

  return (
    // Width matches the SudokuGrid wrapper above it. We dropped the
    // 90vw cap so the row fills the viewport on mobile (the grid does
    // the same), keeping number buttons aligned under the columns.
    <div className="grid w-full max-w-[560px] grid-cols-9 gap-1">
      {Array.from({ length: 9 }, (_, i) => {
        const digit = i + 1;
        const remaining = 9 - counts[digit];
        const exhausted = remaining === 0;
        return (
          <button
            key={digit}
            type="button"
            disabled={exhausted && mode === "value"}
            onClick={() => inputDigit(digit)}
            className={cn(
              // Flex column owns the layout. The remaining-count is a
              // normal flow child (not absolute) so it never overlaps
              // the digit even when the cell is small. On mobile the
              // count is hidden entirely so the digit can grow into
              // the full button.
              "flex aspect-square min-h-12 flex-col items-center justify-center gap-0.5 rounded-md border bg-card text-2xl font-semibold leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 sm:text-2xl",
              mode === "notes" && "ring-2 ring-primary/40",
            )}
            aria-label={`Place ${digit}${exhausted ? " (none remaining)" : ""}`}
          >
            <span>{digit}</span>
            <span className="hidden text-[10px] font-normal leading-none text-muted-foreground sm:block">
              {remaining}
            </span>
          </button>
        );
      })}
    </div>
  );
}
