"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";

// One cell of the 9x9 grid. Memoized aggressively because rerenders happen
// 81 times for any board change; we only re-render a cell when one of its
// presentational props changes.
//
// All highlight logic lives here as pure styling. The parent SudokuGrid
// computes the boolean flags via Zustand selectors so this component stays
// dumb.

type CellProps = {
  index: number;
  value: number;
  notesMask: number;
  isFixed: boolean;
  isSelected: boolean;
  isPeer: boolean;
  isSameDigit: boolean;
  isConflict: boolean;
  onSelect: (index: number) => void;
};

function CellInner({
  index,
  value,
  notesMask,
  isFixed,
  isSelected,
  isPeer,
  isSameDigit,
  isConflict,
  onSelect,
}: CellProps) {
  const row = Math.floor(index / 9);
  const col = index % 9;

  // Background priority is conflict > selected > sameDigit > peer > base.
  // The order matters: a cell can be both selected and conflicting, and
  // we want the conflict to dominate so the player notices it.
  const bg = isConflict
    ? "bg-cell-conflict"
    : isSelected
      ? "bg-cell-selected"
      : isSameDigit
        ? "bg-cell-same"
        : isPeer
          ? "bg-cell-peer"
          : isFixed
            ? "bg-cell-fixed"
            : "bg-cell";

  return (
    <button
      type="button"
      role="gridcell"
      aria-label={`row ${row + 1}, column ${col + 1}, ${
        value > 0 ? `value ${value}${isFixed ? " (clue)" : ""}` : "empty"
      }`}
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(index);
      }}
      className={cn(
        "relative flex aspect-square select-none items-center justify-center text-2xl font-medium transition-colors sm:text-3xl",
        bg,
        isFixed ? "text-foreground" : "text-primary",
        isConflict && "text-destructive",
        // Thick borders on the 3x3 box edges. We rely on row/col mod 3
        // rather than passing borders from the parent so cells own their
        // visual identity.
        "border border-border/40",
        col % 3 === 0 && "border-l-2 border-l-foreground/60",
        col === 8 && "border-r-2 border-r-foreground/60",
        row % 3 === 0 && "border-t-2 border-t-foreground/60",
        row === 8 && "border-b-2 border-b-foreground/60",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
      )}
    >
      {value > 0 ? (
        value
      ) : notesMask !== 0 ? (
        <NoteGrid mask={notesMask} highlight={isSameDigit ? -1 : 0} />
      ) : null}
    </button>
  );
}

// Tiny 3x3 grid of pencil-mark digits. Renders as text rather than per-
// digit elements to keep DOM small (81 cells * 9 notes = 729 nodes max
// without this optimization; this version is 81 + ~9 visible per cell).
function NoteGrid({ mask, highlight: _highlight }: { mask: number; highlight: number }) {
  const cells: React.ReactNode[] = [];
  for (let d = 1; d <= 9; d++) {
    const has = (mask & (1 << (d - 1))) !== 0;
    cells.push(
      <span
        key={d}
        className={cn(
          "flex items-center justify-center text-[10px] leading-none text-muted-foreground sm:text-xs",
          !has && "opacity-0",
        )}
      >
        {d}
      </span>,
    );
  }
  return <div className="grid h-full w-full grid-cols-3 grid-rows-3 p-0.5">{cells}</div>;
}

// Tight memo comparator. We compare every prop explicitly to avoid the
// default shallow check missing a primitive change.
export const Cell = memo(CellInner, (a, b) => {
  return (
    a.value === b.value &&
    a.notesMask === b.notesMask &&
    a.isFixed === b.isFixed &&
    a.isSelected === b.isSelected &&
    a.isPeer === b.isPeer &&
    a.isSameDigit === b.isSameDigit &&
    a.isConflict === b.isConflict &&
    a.onSelect === b.onSelect &&
    a.index === b.index
  );
});
