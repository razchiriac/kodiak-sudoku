"use client";

import { Eraser, Lightbulb, Pencil, Redo2, Undo2 } from "lucide-react";
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
  const isComplete = useGameStore((s) => s.isComplete);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex w-full max-w-[min(90vw,560px)] items-center justify-between gap-2">
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
        <ControlButton
          label={mode === "notes" ? "Notes (on)" : "Notes"}
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
          className={cn("flex h-12 flex-1 flex-col gap-0.5 px-2", active && "ring-2 ring-primary")}
          aria-label={label}
        >
          {icon}
          <span className="text-[10px]">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {label} <kbd className="ml-1 rounded bg-muted px-1 text-[10px]">{shortcut}</kbd>
      </TooltipContent>
    </Tooltip>
  );
}
