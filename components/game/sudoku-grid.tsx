"use client";

import { useCallback, useMemo } from "react";
import { useGameStore } from "@/lib/zustand/game-store";
import { peers } from "@/lib/sudoku/board";
import { Cell } from "./cell";

// The 9x9 grid. Subscribes to the slice of state needed for layout-level
// decisions (selection, conflicts, settings) and passes per-cell props
// down. Each Cell decides its own re-render via the memo comparator.

export function SudokuGrid() {
  const board = useGameStore((s) => s.board);
  const notes = useGameStore((s) => s.notes);
  const fixed = useGameStore((s) => s.fixed);
  const selection = useGameStore((s) => s.selection);
  const conflicts = useGameStore((s) => s.conflicts);
  const isPaused = useGameStore((s) => s.isPaused);
  const highlightSameDigit = useGameStore((s) => s.settings.highlightSameDigit);
  const selectCell = useGameStore((s) => s.selectCell);

  const handleSelect = useCallback((i: number) => selectCell(i), [selectCell]);

  // Pre-compute the peer set for the current selection. Cheap (20 entries)
  // and saves us re-running peers() inside every Cell on each render.
  const peerSet = useMemo(() => {
    if (selection == null) return new Set<number>();
    return new Set(peers(selection));
  }, [selection]);

  const selectedDigit = selection != null ? board[selection] : 0;

  return (
    <div
      role="grid"
      aria-label="Sudoku puzzle"
      className="relative grid aspect-square w-full max-w-[min(90vw,560px)] grid-cols-9 grid-rows-9 overflow-hidden rounded-lg border-2 border-foreground/60 bg-background shadow-sm"
    >
      {Array.from({ length: 81 }, (_, i) => (
        <Cell
          key={i}
          index={i}
          value={board[i]}
          notesMask={notes[i]}
          isFixed={fixed[i] === 1}
          isSelected={selection === i}
          isPeer={peerSet.has(i)}
          isSameDigit={
            highlightSameDigit && selectedDigit > 0 && board[i] === selectedDigit && selection !== i
          }
          isConflict={conflicts.has(i)}
          onSelect={handleSelect}
        />
      ))}
      {isPaused && <PauseOverlay />}
    </div>
  );
}

// Paused state overlay. Hides the board so a player can't "pause to think"
// and gain an unfair advantage in timed modes.
function PauseOverlay() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm">
      <p className="text-center text-lg font-medium text-muted-foreground">
        Paused
        <br />
        <span className="text-sm">Press Space to resume</span>
      </p>
    </div>
  );
}
