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
      // Width budget: on mobile we drop the old 90vw cap and let the
      // grid fill the page wrapper (which is `px-2`), so a 390px
      // viewport gets a ~374px board with no wasted gutter.
      //
      // Height budget (the calc): on a phone in portrait the board
      // can be height-bound on smaller devices. We compute the
      // largest square that fits after subtracting the rest of the
      // chrome (header, padding, title row, 2-row control panel on
      // mobile, number pad, footer). The rem subtractions are tuned
      // per breakpoint:
      //   - mobile (<sm): 26rem accounts for the stacked footer
      //     (which collapses to a single row on sm+) plus the
      //     two-row control panel.
      //   - sm+: 24rem because the control panel collapses to a
      //     single row and the footer becomes single-row too.
      // 100dvh (dynamic viewport height) handles iOS Safari's
      // collapsing URL bar so we don't get a sudden overflow when it
      // shows. On tall phones the width cap (374px on a 390px
      // viewport) still binds first; the height cap only kicks in on
      // shorter screens, where it prevents page scroll.
      className="relative grid aspect-square w-full max-w-[min(100%,560px,calc(100dvh-26rem))] grid-cols-9 grid-rows-9 overflow-hidden rounded-lg border-2 border-foreground/60 bg-background shadow-sm sm:max-w-[min(560px,calc(100dvh-24rem))]"
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
