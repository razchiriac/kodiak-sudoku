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

// Control panel. Rendered as a vertical stack of three buttons that
// flanks the 3x3 number pad in the composed play layout. Called
// twice — once per `side` — so the grouping lives here instead of
// being hard-coded in play-client.
//
// Grouping rationale:
//   - left  = Undo / Redo / Erase (history + correction; the "I
//     messed up" cluster)
//   - right = Notes / Hint / Auto-notes (mode + assist cluster)
export function ControlPanel({ side }: { side: "left" | "right" }) {
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
      {/* Flex column so each button fills the column width and three
          buttons stack vertically. gap-1 matches the number pad's
          internal spacing so the combined layout reads as one grid. */}
      <div className="flex h-full w-full flex-col gap-1">
        {side === "left" ? (
          <>
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
          </>
        ) : (
          <>
            {/* "Notes" drops the "(on)" suffix because the active
                ring + filled background already telegraph state. */}
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
            {/* Auto-notes: replaces every empty cell's pencil marks
                with the freshly computed legal candidates. One tap
                initializes notes; one undo reverts. No keyboard
                shortcut because this is primarily a touch-screen
                quality-of-life feature. */}
            <ControlButton
              label="Auto-notes"
              shortcut=""
              onClick={autoFillNotes}
              disabled={isComplete}
              icon={<WandSparkles />}
            />
          </>
        )}
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
          // flex-1 lets the three buttons in the stack share the
          // available height equally. Because the outer 5-col grid
          // cell stretches the stack to match the number pad's
          // height (the pad is the tallest sibling), flex-1 divides
          // that height by 3 so each button lines up exactly with
          // a number pad row.
          //
          // min-h-12 is a safety floor on very short viewports; h-0
          // lets flex-1 do the real sizing.
          className={cn(
            "flex h-0 min-h-12 w-full flex-1 flex-col items-center justify-center gap-1 px-2 py-2",
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
