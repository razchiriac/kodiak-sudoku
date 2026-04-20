"use client";

import { useGameStore } from "@/lib/zustand/game-store";
import { cn } from "@/lib/utils";

// Number pad. Renders as a 3x3 grid below the board (matches the
// visual rhythm of a phone keypad and gives chunky tap targets on
// mobile). In the composed play layout it's sandwiched between two
// stacks of control buttons, so it grid-col-spans 3 of the 5-col
// parent grid.
//
// Two state-aware behaviors live here:
//   - Remaining-digit subscript: how many of this digit are still
//     missing from the board. Helps the player pick the "closest to
//     done" digit next. Shown at every breakpoint now that each
//     button has plenty of vertical room.
//   - Notes indicator: in notes mode, each digit button reflects
//     whether that digit is currently a pencil mark on the selected
//     cell. Without this the notes-mode ring is the only hint you
//     are toggling marks, and you can't tell which ones are on.
export function NumberPad() {
  const inputDigit = useGameStore((s) => s.inputDigit);
  const board = useGameStore((s) => s.board);
  const mode = useGameStore((s) => s.mode);
  const selection = useGameStore((s) => s.selection);
  const notes = useGameStore((s) => s.notes);

  // Live digit counts. Recomputed on every render but cheap (single
  // 81 pass) so we avoid the complexity of a memoized selector.
  const counts = new Array<number>(10).fill(0);
  for (let i = 0; i < 81; i++) counts[board[i]]++;

  // Notes indicator is only meaningful when the user is in notes
  // mode AND has selected an empty cell. inputDigit refuses to write
  // notes to filled or clue cells, so lighting up a button there
  // would be a false promise.
  const notesMask =
    mode === "notes" && selection != null && board[selection] === 0
      ? notes[selection]
      : 0;

  return (
    // col-span-3 so the pad occupies the middle 3 of 5 columns in
    // the play-client composition. A 3x3 grid inside means each
    // button lines up under the column above it.
    <div className="col-span-3 grid w-full grid-cols-3 gap-1">
      {Array.from({ length: 9 }, (_, i) => {
        const digit = i + 1;
        const remaining = 9 - counts[digit];
        const exhausted = remaining === 0;
        const isNoted = (notesMask & (1 << (digit - 1))) !== 0;
        return (
          <button
            key={digit}
            type="button"
            // In notes mode the "exhausted" rule doesn't apply: you
            // can still pencil a digit that's fully placed on the
            // board (rare, but removing notes on peers of a value
            // placement can leave stale ones you want to clean up).
            disabled={exhausted && mode === "value"}
            onClick={() => inputDigit(digit)}
            className={cn(
              // Flex column owns the layout. The remaining-count is
              // a normal flow child so it never overlaps the digit.
              //
              // Height strategy:
              //   - mobile: aspect-square so each button matches its
              //     column width (thumb-friendly, reads like a phone
              //     keypad at 374px viewport ~75px per button).
              //   - sm+:   aspect-auto + h-16 so the pad doesn't
              //     balloon to 3×112=336px tall at the 560px max
              //     width, which would squeeze the board on a
              //     short laptop viewport.
              "flex aspect-square min-h-12 flex-col items-center justify-center gap-0.5 rounded-md border bg-card text-2xl font-semibold leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-30 sm:aspect-auto sm:h-16",
              // Notes mode: a soft ring on every button telegraphs
              // the mode.
              mode === "notes" && "ring-2 ring-primary/40",
              // Per-digit "this note is ON for the selected cell"
              // indicator. Filled background + primary text so it
              // reads clearly even without the ring.
              isNoted && "bg-primary/20 text-primary ring-primary",
            )}
            aria-label={`${mode === "notes" ? "Toggle note" : "Place"} ${digit}${
              exhausted && mode === "value" ? " (none remaining)" : ""
            }${isNoted ? " (currently noted)" : ""}`}
            aria-pressed={mode === "notes" ? isNoted : undefined}
          >
            <span>{digit}</span>
            {/* Remaining-count subscript. We used to hide this below
                sm because the 9-in-a-row layout left no vertical
                room; with the 3x3 layout each button is ~74-112px
                tall, so the count fits everywhere. */}
            <span className="text-[10px] font-normal leading-none text-muted-foreground">
              {remaining}
            </span>
          </button>
        );
      })}
    </div>
  );
}
