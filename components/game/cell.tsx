"use client";

import { memo } from "react";
import { cn } from "@/lib/utils";
import { displayDigit } from "@/lib/sudoku/display";
import { getSymbol, type SymbolSetId } from "@/lib/sudoku/symbols";

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
  // RAZ-110: when true, show digits as 0–8 instead of 1–9. The
  // internal value (1–9) is unchanged; only the displayed glyph
  // and aria-label text are transformed here.
  zeroBasedMode: boolean;
  // RAZ-116: which symbol set to use for rendering. "digits" is the
  // default pass-through; "colors"/"shapes"/"colorShapes" render
  // colored glyphs instead of plain digit text.
  symbolSet: SymbolSetId;
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
  zeroBasedMode,
  symbolSet,
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

  // RAZ-116: resolve the symbol definition for the current value.
  // In "digits" mode, falls back to the RAZ-110 displayDigit path.
  const sym = value > 0 ? getSymbol(value, symbolSet) : null;
  const useSymbols = symbolSet !== "digits";

  // RAZ-110: the display digit is 0–8 in zero-based mode, 1–9 otherwise.
  // Used for both the visual render and the aria-label so screen readers
  // announce the same glyph the player sees.
  const displayValue = value > 0
    ? (useSymbols ? sym?.ariaLabel ?? String(value) : displayDigit(value, zeroBasedMode))
    : null;

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
        displayValue != null
          ? `value ${displayValue}${isFixed ? " (clue)" : ""}`
          : "empty"
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
        // RAZ-116: in symbol mode with a custom color, let the inline
        // style own the text color. Only apply the default text tokens
        // for digits mode or when no custom color is set.
        useSymbols && sym?.color && !isWrong
          ? ""
          : isFixed ? "text-foreground" : "text-primary",
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
      {value > 0 && sym ? (
        useSymbols ? (
          <span
            className="leading-none"
            style={sym.color ? { color: isWrong ? undefined : sym.color } : undefined}
            aria-hidden
          >
            {sym.glyph}
          </span>
        ) : (
          displayDigit(value, zeroBasedMode)
        )
      ) : notesMask !== 0 ? (
        <NoteGrid mask={notesMask} highlightDigit={highlightNoteDigit} zeroBasedMode={zeroBasedMode} symbolSet={symbolSet} />
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
//
// RAZ-110: `zeroBasedMode` transforms each note glyph (d-1 instead of d).
// RAZ-116: `symbolSet` renders colored dots/shapes instead of digit text.
function NoteGrid({
  mask,
  highlightDigit,
  zeroBasedMode,
  symbolSet,
}: {
  mask: number;
  highlightDigit: number;
  zeroBasedMode: boolean;
  symbolSet: SymbolSetId;
}) {
  const useSymbols = symbolSet !== "digits";
  const cells: React.ReactNode[] = [];
  for (let d = 1; d <= 9; d++) {
    const has = (mask & (1 << (d - 1))) !== 0;
    const isHit = has && d === highlightDigit;
    const noteSym = useSymbols ? getSymbol(d, symbolSet) : null;
    cells.push(
      <span
        key={d}
        className={cn(
          "flex items-center justify-center text-[clamp(0.625rem,2vw,0.875rem)] leading-none text-muted-foreground",
          !has && "opacity-0",
          isHit && "rounded-sm bg-cell-same font-semibold text-foreground",
        )}
        style={useSymbols && noteSym?.color && has ? { color: noteSym.color } : undefined}
      >
        {useSymbols && noteSym ? noteSym.glyph : displayDigit(d, zeroBasedMode)}
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
    a.zeroBasedMode === b.zeroBasedMode &&
    a.symbolSet === b.symbolSet &&
    a.onSelect === b.onSelect &&
    a.index === b.index
  );
});
