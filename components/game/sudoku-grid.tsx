"use client";

import { useCallback, useMemo } from "react";
import { useGameStore } from "@/lib/zustand/game-store";
import { computeMistakes, peers } from "@/lib/sudoku/board";
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
  // RAZ-15: derive the set of "mistake" cells — any non-fixed cell
  // whose current value disagrees with the puzzle solution. Only
  // active when (a) the feature flag is on, (b) the user has opted in
  // via settings.showMistakes, and (c) the solution is actually
  // present on the client (random puzzles only — dailies keep the
  // solution server-side to avoid leaking it through dev tools).
  const solution = useGameStore((s) => s.meta?.solution ?? null);
  const showMistakesFlag = useGameStore((s) => s.featureFlags.showMistakes);
  const showMistakesSetting = useGameStore(
    (s) => s.settings.showMistakes === true,
  );
  const showMistakes =
    showMistakesFlag && showMistakesSetting && solution !== null;

  // RAZ-18: read the variant so peer highlighting respects diagonals.
  const variant = useGameStore((s) => s.meta?.variant);
  const handleSelect = useCallback((i: number) => selectCell(i), [selectCell]);

  // Pre-compute the peer set for the current selection. Cheap (20 entries)
  // and saves us re-running peers() inside every Cell on each render.
  const peerSet = useMemo(() => {
    if (selection == null) return new Set<number>();
    return new Set(peers(selection, variant));
  }, [selection, variant]);

  // Build the mistake set once per render. Wraps the pure helper so
  // the result is memoized against board / fixed / solution references
  // — since the store swaps typed arrays on mutation, a new reference
  // reliably triggers a recompute. When mistakes are disabled (flag
  // off, setting off, or solution unavailable) we hand an empty string
  // to the helper so it early-returns an empty Set, keeping the
  // per-cell membership check free.
  const mistakeSet = useMemo(
    () => computeMistakes(board, fixed, showMistakes ? solution : null),
    [showMistakes, solution, board, fixed],
  );

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
      //   - mobile (<sm): 22rem. Header (3.5rem) + footer (3.5rem)
      //     + play-page padding/gaps (~4rem) + title row (2.5rem)
      //     + 3-row control area at h-16 (~12.5rem) = ~26rem
      //     actual, but 100dvh is the *dynamic* viewport which
      //     includes the collapsed-bar state. We subtract only 22rem
      //     to keep the board large on iOS Chrome, where the initial
      //     dvh is considerably shorter than Safari due to thicker
      //     toolbars. The page scrolls slightly on the shortest
      //     phones (SE) — acceptable vs. a tiny board.
      //   - sm+: 22rem. Number pad uses h-16 buttons; desktops and
      //     tablets have enough height that the 560px width cap
      //     almost always binds first.
      // 100dvh handles iOS Safari's collapsing URL bar so we don't
      // get a sudden overflow when it shows.
      className="relative grid aspect-square w-full max-w-[min(100%,560px,calc(100dvh-22rem))] grid-cols-9 grid-rows-9 overflow-hidden rounded-lg border-2 border-foreground/60 bg-background shadow-sm sm:max-w-[min(560px,calc(100dvh-22rem))]"
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
          isMistake={mistakeSet.has(i)}
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
      {/* RAZ-18: subtle diagonal lines when playing diagonal variant.
          SVG overlay with two lines spanning corner to corner. The
          `pointer-events-none` ensures clicks pass through to cells. */}
      {variant === "diagonal" && <DiagonalOverlay />}
      {isPaused && <PauseOverlay />}
    </div>
  );
}

// RAZ-18: SVG overlay that draws the two diagonal constraint lines.
// Uses a `viewBox="0 0 9 9"` so each cell is 1x1 unit, making the
// coordinates trivial. The lines are semi-transparent and thin so
// they don't obscure digits.
function DiagonalOverlay() {
  return (
    <svg
      viewBox="0 0 9 9"
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden="true"
    >
      {/* Main diagonal: (0,0) → (9,9) */}
      <line
        x1="0" y1="0" x2="9" y2="9"
        stroke="currentColor"
        strokeWidth="0.06"
        className="text-primary/30"
      />
      {/* Anti-diagonal: (9,0) → (0,9) */}
      <line
        x1="9" y1="0" x2="0" y2="9"
        stroke="currentColor"
        strokeWidth="0.06"
        className="text-primary/30"
      />
    </svg>
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
