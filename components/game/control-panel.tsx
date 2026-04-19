"use client";

import { Eraser, Lightbulb, Pencil, Redo2, Undo2, WandSparkles } from "lucide-react";
import { useGameStore } from "@/lib/zustand/game-store";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Row of action buttons next to the grid. Keyboard shortcuts are shown in
// tooltips so the player can discover them without leaving the play
// screen.
export function ControlPanel() {
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const erase = useGameStore((s) => s.eraseSelection);
  const hint = useGameStore((s) => s.hint);
  const mode = useGameStore((s) => s.mode);
  const toggleMode = useGameStore((s) => s.toggleMode);
  const autoFillNotes = useGameStore((s) => s.autoFillNotes);
  const isComplete = useGameStore((s) => s.isComplete);

  return (
    <TooltipProvider delayDuration={250}>
      {/* Width matches SudokuGrid above. With six buttons we use a
          3-column grid on mobile (so each button gets ~120px and the
          "Auto-notes" label fits cleanly) and expand to a single 6-up
          row on the sm breakpoint where 560px / 6 leaves plenty of
          horizontal room. */}
      <div className="grid w-full max-w-[560px] grid-cols-3 gap-2 sm:grid-cols-6">
        <ControlButton
          label="Undo"
          shortcut="U"
          onClick={undo}
          disabled={isComplete}
          icon={<Undo2 />}
        />
        <ControlButton
          label="Redo"
          shortcut="R"
          onClick={redo}
          disabled={isComplete}
          icon={<Redo2 />}
        />
        <ControlButton
          label="Erase"
          shortcut="Backspace"
          onClick={erase}
          disabled={isComplete}
          icon={<Eraser />}
        />
        {/* "Notes" label drops the "(on)" suffix because the active
            ring + filled background already telegraph state on every
            screen size. */}
        <ControlButton
          label="Notes"
          shortcut="N"
          onClick={toggleMode}
          disabled={isComplete}
          active={mode === "notes"}
          icon={<Pencil />}
        />
        <ControlButton
          label="Hint"
          shortcut="H"
          onClick={() => void hint()}
          disabled={isComplete}
          icon={<Lightbulb />}
        />
        {/* Auto-notes: replaces every empty cell's pencil marks with
            the freshly computed legal candidates. One tap initializes
            the player's notes; one undo reverts. No keyboard shortcut
            because this is primarily a touch-screen quality-of-life
            feature. */}
        <ControlButton
          label="Auto-notes"
          shortcut=""
          onClick={autoFillNotes}
          disabled={isComplete}
          icon={<WandSparkles />}
        />
      </div>
    </TooltipProvider>
  );
}

function ControlButton({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
  active,
}: {
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active ? "secondary" : "outline"}
          onClick={onClick}
          disabled={disabled}
          // min-h-14 (56px) matches the iOS recommended hit target.
          // text-xs labels stay readable on a phone without crowding
          // the icon. The parent grid handles horizontal sizing, so
          // we only need w-full here.
          className={cn(
            "flex min-h-14 w-full flex-col gap-1 px-2 py-2",
            active && "ring-2 ring-primary",
          )}
          aria-label={label}
        >
          {icon}
          <span className="text-xs">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label}
        {/* Some buttons (auto-notes) have no keyboard shortcut. We
            skip the kbd entirely instead of rendering an empty box. */}
        {shortcut && (
          <kbd className="ml-1 rounded bg-muted px-1 text-[10px]">{shortcut}</kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
