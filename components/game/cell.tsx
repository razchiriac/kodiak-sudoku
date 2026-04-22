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
  // RAZ-15: true when the player has opted into real-time mistake
  // highlighting AND the cell's current value does not match the
  // puzzle solution. Visually treated the same as `isConflict`
  // (red background + destructive text) because both mean
  // "something is wrong here"; semantically we keep the flag
  // separate so aria-invalid only fires on actual conflicts —
  // mistakes are not a formal ARIA validity concept.
  isMistake: boolean;
  // Digit (1..9) that should be highlighted inside the notes grid
  // when this cell is empty and contains that digit as a pencil
  // mark. 0 means "no highlight". Populated by the parent when a
  // filled cell is selected, so empty cells telegraph "here's a
  // candidate for the selected value".
  highlightNoteDigit: number;
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
  isMistake,
  highlightNoteDigit,
  onSelect,
}: CellProps) {
  const row = Math.floor(index / 9);
  const col = index % 9;
  // RAZ-24: screen readers that implement the grid pattern expect
  // 1-indexed row/col hints on every gridcell so the virtual cursor
  // announces position (e.g. "row 3, column 5") as the user navigates.
  // Without these, VoiceOver in particular falls back to linear
  // reading which is useless on a 9x9 board.
  const rowIndex = row + 1;
  const colIndex = col + 1;

  // Background priority: wrong (conflict or mistake) > selected >
  // sameDigit > peer > base. The order matters: a cell can be both
  // selected and wrong, and we want "wrong" to dominate so the player
  // notices it. RAZ-15 extends this: a wrong value that isn't also a
  // conflict (e.g. the user typed "5" where the solution wants "3" and
  // no peer has a 5) gets the same red tint when the player has opted
  // into `showMistakes` — `isWrong` collapses both into one visual.
  const isWrong = isConflict || isMistake;
  const bg = isWrong
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
      aria-rowindex={rowIndex}
      aria-colindex={colIndex}
      // RAZ-24: aria-selected mirrors the visual "this is the active
      // cell" state so screen readers can announce the selection when
      // it changes (e.g. arrow-key navigation) without relying on the
      // label alone. aria-readonly signals that clue cells can't be
      // edited — saves the user a bump-into-wall attempt.
      aria-selected={isSelected}
      aria-readonly={isFixed || undefined}
      // aria-invalid telegraphs the current conflict state to the
      // screen reader so "cell is currently conflicting" shows up as a
      // standard error signal rather than baked into the label text.
      aria-invalid={isConflict || undefined}
      aria-label={`row ${rowIndex}, column ${colIndex}, ${
        value > 0 ? `value ${value}${isFixed ? " (clue)" : ""}` : "empty"
      }${isConflict ? ", conflict" : isMistake ? ", incorrect" : ""}`}
      tabIndex={-1}
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect(index);
      }}
      className={cn(
        // Digit size scales with viewport width via clamp() so the
        // value stays proportional whether the board is 350px or
        // 560px. The fixed sm:text-3xl breakpoint kept clues legible
        // before — the clamp range covers the same span continuously.
        "relative flex aspect-square select-none items-center justify-center text-[clamp(1.25rem,5vw,1.875rem)] font-medium transition-colors",
        bg,
        isFixed ? "text-foreground" : "text-primary",
        // RAZ-15: mistake text color mirrors conflict — a wrong digit
        // should look wrong, period. We reuse text-destructive for
        // both branches so the theme stays cohesive (dark mode,
        // colorblind palette, etc. all benefit from a single token).
        isWrong && "text-destructive",
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
        <NoteGrid mask={notesMask} highlightDigit={highlightNoteDigit} />
      ) : null}
    </button>
  );
}

// Tiny 3x3 grid of pencil-mark digits. Renders as text rather than per-
// digit elements to keep DOM small (81 cells * 9 notes = 729 nodes max
// without this optimization; this version is 81 + ~9 visible per cell).
//
// `highlightDigit` (1..9, or 0 for none) styles the matching note so
// it visually matches the parent grid's "same-digit" highlighting —
// when the player selects a filled cell of value N, every empty cell
// with N in its pencil marks shows N highlighted while leaving the
// other notes alone.
function NoteGrid({ mask, highlightDigit }: { mask: number; highlightDigit: number }) {
  const cells: React.ReactNode[] = [];
  for (let d = 1; d <= 9; d++) {
    const has = (mask & (1 << (d - 1))) !== 0;
    const isHit = has && d === highlightDigit;
    cells.push(
      <span
        key={d}
        className={cn(
          // Pencil marks scale with viewport width so they stay
          // legible on a 560px board without overflowing a 350px
          // mobile cell. Bumped the clamp up: 10px floor, 14px
          // ceiling, so the marks read clearly without crowding
          // the sub-cell.
          "flex items-center justify-center text-[clamp(0.625rem,2vw,0.875rem)] leading-none text-muted-foreground",
          !has && "opacity-0",
          // Same-digit highlight applied per sub-cell: reuse the
          // board-level bg-cell-same token so the treatment reads
          // as a single visual system.
          isHit && "rounded-sm bg-cell-same font-semibold text-foreground",
        )}
      >
        {d}
      </span>,
    );
  }
  // p-px instead of the old p-0.5 gives the slightly larger digits
  // an extra hair of room inside each sub-cell.
  return <div className="grid h-full w-full grid-cols-3 grid-rows-3 p-px">{cells}</div>;
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
    a.isMistake === b.isMistake &&
    a.highlightNoteDigit === b.highlightNoteDigit &&
    a.onSelect === b.onSelect &&
    a.index === b.index
  );
});
