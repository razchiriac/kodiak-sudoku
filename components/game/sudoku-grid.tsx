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
      // RAZ-24: aria-rowcount/colcount anchor the per-cell rowindex and
      // colindex hints for the screen reader grid pattern. Without
      // these, some AT compute the count from the DOM and can get
      // confused by the flat (no row wrappers) layout.
      aria-rowcount={9}
      aria-colcount={9}
      // Width budget: on mobile we drop the old 90vw cap and let the
      // grid fill the page wrapper (which is `px-2`), so a 390px
      // viewport gets a ~374px board with no wasted gutter.
      //
      // Height budget (the calc): on a phone in portrait the board
      // can be height-bound on smaller devices. We compute the
      // largest square that fits after subtracting the rest of the
      // chrome (header, padding, title row, the 3-row below-board
      // region of control stacks + 3x3 number pad, footer). The
      // rem subtractions are tuned per breakpoint:
      //   - mobile (<sm): 30rem. The below-board region now uses
      //     aspect-square buttons in a 5-col grid, so at a 374px
      //     viewport each button is ~75px square and the region is
      //     ~3×75 = 225px tall (vs ~174px in the old row+row
      //     layout). +~3rem on top of the previous 26rem, rounded
      //     up for the stacked mobile footer.
      //   - sm+: 29rem. The number pad drops aspect-square in
      //     favor of a fixed h-16, so the region is ~3×64+16 =
      //     208px (vs ~134px before). +~5rem on top of the
      //     previous 24rem.
      // 100dvh (dynamic viewport height) handles iOS Safari's
      // collapsing URL bar so we don't get a sudden overflow when it
      // shows. On tall phones and typical laptop viewports the
      // width cap (560px) still binds first; the height cap only
      // kicks in on shorter screens, where it prevents page scroll.
      className="relative grid aspect-square w-full max-w-[min(100%,560px,calc(100dvh-30rem))] grid-cols-9 grid-rows-9 overflow-hidden rounded-lg border-2 border-foreground/60 bg-background shadow-sm sm:max-w-[min(560px,calc(100dvh-29rem))]"
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
          // When a filled cell is selected, tell every empty cell
          // to highlight the matching note (if any) so the player
          // can see exactly where that digit is a candidate.
          // Gated on the same `highlightSameDigit` setting so both
          // features live or die together.
          highlightNoteDigit={
            highlightSameDigit && selectedDigit > 0 ? selectedDigit : 0
          }
          onSelect={handleSelect}
        />
      ))}
      {isPaused && <PauseOverlay />}
    </div>
  );
}

// Paused state overlay. Hides the board so a player can't "pause to think"
// and gain an unfair advantage in timed modes.
//
// The overlay itself is the resume affordance: tapping/clicking anywhere
// on it calls togglePause. On desktop we still hint at the Space
// shortcut; on touch devices (no keyboard) we tell the user to tap
// because "Press Space" is meaningless there.
function PauseOverlay() {
  const togglePause = useGameStore((s) => s.togglePause);
  return (
    <button
      type="button"
      onClick={togglePause}
      aria-label="Resume game"
      className="absolute inset-0 flex items-center justify-center bg-background/95 backdrop-blur-sm focus:outline-none"
    >
      <p className="text-center text-lg font-medium text-muted-foreground">
        Paused
        <br />
        {/* Two hints, one shown per breakpoint. sm: covers the
            keyboard-friendly desktop case; the default covers touch. */}
        <span className="text-sm sm:hidden">Tap here to resume</span>
        <span className="hidden text-sm sm:inline">Press Space to resume</span>
      </p>
    </button>
  );
}
