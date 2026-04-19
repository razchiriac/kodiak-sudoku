"use client";

import { useGameStore } from "@/lib/zustand/game-store";
import { cn } from "@/lib/utils";

// Number pad. On desktop it shows remaining-digit counts so the player
// can spot the digit closest to being fully placed; on mobile it doubles
// as the primary input method.
export function NumberPad() {
  const inputDigit = useGameStore((s) => s.inputDigit);
  const board = useGameStore((s) => s.board);
  const mode = useGameStore((s) => s.mode);

  // Live digit counts. Recomputed on every render but cheap (single 81
  // pass) so we avoid the complexity of a memoized selector.
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < 81; i++) counts[board[i]]++;

  return (
    <div className="grid w-full max-w-[min(90vw,560px)] grid-cols-9 gap-1">
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
              "relative flex aspect-square flex-col items-center justify-center rounded-md border bg-card text-xl font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30",
              mode === "notes" && "ring-2 ring-primary/40",
            )}
            aria-label={`Place ${digit}${exhausted ? " (none remaining)" : ""}`}
          >
            <span>{digit}</span>
            <span className="absolute bottom-0.5 text-[10px] text-muted-foreground">
              {remaining}
            </span>
          </button>
        );
      })}
    </div>
  );
}
