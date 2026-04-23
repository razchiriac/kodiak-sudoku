"use client";

import { useMemo, useState } from "react";
import { useGameStore } from "@/lib/zustand/game-store";
import { encodeNotes } from "@/lib/sudoku/notes-codec";
import { serializeBoard } from "@/lib/sudoku/board";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// RAZ-9 — Print dialog. Small controlled dialog with two radio groups:
//   1. Board content: Original puzzle vs My progress
//   2. Pencil marks:  None / Template (auto-candidates) / My current notes
//
// On "Download PDF" we build a URL with the selected params and
// navigate via <a download>. The route handler does the heavy work
// (see app/print/[puzzleId]/route.ts).
//
// Why a controlled dialog rather than just a share-style popover
//   Two distinct choices with sensible defaults warrants a modal so
//   the player can review before kicking off the PDF render. It's
//   also a better handoff point for a future "preview" step (e.g.
//   a thumbnail of the generated PDF) without restructuring the UI.
//
// State source
//   The current board + notes live in the game-store. Progress is
//   serialized to an 81-char string via `serializeBoard`; notes use
//   the same base64 codec the autosave path does. This keeps the
//   route handler decoupled from the store — it just parses query
//   params.

type PrintDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  puzzleId: number;
};

type BoardChoice = "original" | "progress";
type MarksChoice = "none" | "template" | "notes";

export function PrintDialog({
  open,
  onOpenChange,
  puzzleId,
}: PrintDialogProps) {
  // Subscribe to the board + notes. We DON'T compute any derived
  // state here — the encoding step is deferred to the click handler
  // so an open dialog has zero per-placement re-render cost while
  // the player keeps solving.
  const board = useGameStore((s) => s.board);
  const notes = useGameStore((s) => s.notes);

  // Does the player have ANY pencil marks right now? If not, the
  // "My current notes" option is nonsensical — we disable it and
  // let the label hint why. Cheap: 81 array reads.
  const hasNotes = useMemo(() => {
    for (let i = 0; i < notes.length; i++) if (notes[i] !== 0) return true;
    return false;
  }, [notes]);

  const [boardChoice, setBoardChoice] = useState<BoardChoice>("original");
  const [marksChoice, setMarksChoice] = useState<MarksChoice>("none");

  // Build the download URL from the current selections. We only run
  // this on submit (not on every render) because encodeNotes
  // allocates and base64-encodes the whole Uint16Array — fine once
  // per click, wasteful on every render.
  function handleDownload() {
    const params = new URLSearchParams();
    if (boardChoice === "progress") {
      params.set("board", serializeBoard(board));
    } else {
      params.set("board", "original");
    }
    if (marksChoice === "template") {
      params.set("marks", "template");
    } else if (marksChoice === "notes") {
      params.set("marks", encodeNotes(notes));
    } else {
      params.set("marks", "none");
    }
    // Using location.assign rather than a synthetic <a download> click:
    // Chrome and Safari both respect Content-Disposition here, so the
    // browser prompts a Save dialog and stays on the current page
    // (no flash-of-blank-tab).
    window.location.assign(
      `/print/${puzzleId}?${params.toString()}`,
    );
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Print this puzzle</DialogTitle>
          <DialogDescription>
            Generates a PDF you can download and print.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 pt-2">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Board content</legend>
            <RadioRow
              name="board"
              value="original"
              label="Original puzzle"
              hint="Just the clues, as first generated."
              checked={boardChoice === "original"}
              onChange={() => setBoardChoice("original")}
            />
            <RadioRow
              name="board"
              value="progress"
              label="My progress"
              hint="Clues plus anything you've placed so far."
              checked={boardChoice === "progress"}
              onChange={() => setBoardChoice("progress")}
            />
          </fieldset>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Pencil marks</legend>
            <RadioRow
              name="marks"
              value="none"
              label="None"
              hint="Blank cells."
              checked={marksChoice === "none"}
              onChange={() => setMarksChoice("none")}
            />
            <RadioRow
              name="marks"
              value="template"
              label="Template"
              hint="Auto-computed candidates for every empty cell."
              checked={marksChoice === "template"}
              onChange={() => setMarksChoice("template")}
            />
            <RadioRow
              name="marks"
              value="notes"
              label="My current notes"
              hint={
                hasNotes
                  ? "Your pencil marks as they are right now."
                  : "You haven't added any pencil marks yet."
              }
              checked={marksChoice === "notes"}
              onChange={() => setMarksChoice("notes")}
              disabled={!hasNotes}
            />
          </fieldset>

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleDownload}>Download PDF</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Small local primitive for the two radio groups. Kept local because
// the project doesn't have a shared <RadioGroup> in components/ui
// yet, and a one-off at this spec doesn't justify adding one.
function RadioRow({
  name,
  value,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  name: string;
  value: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      className={[
        "flex items-start gap-3 rounded-md border p-3 text-sm",
        "cursor-pointer transition-colors",
        disabled
          ? "cursor-not-allowed opacity-60"
          : checked
            ? "border-primary bg-accent"
            : "hover:bg-accent/50",
      ].join(" ")}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="mt-0.5 h-4 w-4"
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
