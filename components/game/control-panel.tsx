"use client";

import { useEffect, useRef } from "react";
import { Eraser, Lightbulb, Pencil, Redo2, Undo2, WandSparkles } from "lucide-react";
import { toast } from "sonner";
import { notesMatchComputedCandidates } from "@/lib/sudoku/board";
import { useGameStore } from "@/lib/zustand/game-store";
import { tier1Message, tier2Message } from "@/lib/sudoku/hint-tier";
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
//   - right = Notes / Hint / Auto-notes toggle (fill vs clear bulk)
export function ControlPanel({ side }: { side: "left" | "right" }) {
  const undo = useGameStore((s) => s.undo);
  const redo = useGameStore((s) => s.redo);
  const erase = useGameStore((s) => s.eraseSelection);
  const hint = useGameStore((s) => s.hint);
  const mode = useGameStore((s) => s.mode);
  const toggleMode = useGameStore((s) => s.toggleMode);
  const autoFillNotes = useGameStore((s) => s.autoFillNotes);
  // RAZ-42: bulk auto-notes can be disabled in Settings (persisted).
  const autoNotesEnabled = useGameStore(
    (s) => s.settings.autoNotesEnabled !== false,
  );
  // RAZ-43: "on" when the board's pencil marks are exactly the
  // auto-computed candidate set — next tap clears; otherwise fill.
  const autoNotesMatch = useGameStore((s) =>
    notesMatchComputedCandidates(s.board, s.notes, s.meta?.variant),
  );
  const isComplete = useGameStore((s) => s.isComplete);
  // RAZ-14 — subscribe to the tiered hint session so we can (a) show
  // a "1/3" / "2/3" badge on the Hint button, (b) fire a sonner toast
  // whenever the session transitions to a new tier. Both the left and
  // right control panels mount this subscription because <ControlPanel>
  // is rendered twice; we guard the side=right branch below to ensure
  // the toast fires exactly once per tier change (the effect is side-
  // scoped).
  const hintSession = useGameStore((s) => s.hintSession);

  // Toast-on-tier-change effect. We keep a ref of the last-seen
  // (tier, cellIndex) so we only toast on a genuine change — not on
  // every unrelated re-render of the control panel. The ref survives
  // across renders; the effect fires the toast when the current pair
  // differs from the previous one AND the current session is non-null.
  //
  // We intentionally fire the toast on tier 1 (region) and tier 2
  // (technique + cell) only. Tier 3 clears the session (hintSession
  // becomes null) and the placement itself is the visual feedback —
  // an extra toast there would be noise.
  //
  // Only one of the two <ControlPanel> mounts (left/right) should
  // own this effect or we'd double-toast. We pick `side === "right"`
  // because that's where the Hint button lives — the side that cares.
  const lastSeen = useRef<{ tier: 1 | 2; index: number } | null>(null);
  useEffect(() => {
    if (side !== "right") return;
    if (!hintSession) {
      lastSeen.current = null;
      return;
    }
    const current = { tier: hintSession.tier, index: hintSession.suggestion.index };
    const prev = lastSeen.current;
    const changed =
      !prev || prev.tier !== current.tier || prev.index !== current.index;
    if (!changed) return;
    lastSeen.current = current;
    const msg =
      hintSession.tier === 1
        ? tier1Message(hintSession.suggestion)
        : tier2Message(hintSession.suggestion);
    // Short TTL — the player is actively playing and the next click
    // will supersede this toast with the deeper tier. 4s is long
    // enough to read the sentence (both tiers are <50 chars) but
    // short enough that a forgotten toast doesn't clutter the UI.
    toast.message(msg, {
      duration: 4000,
      // Stable id so the next tier REPLACES the previous toast in
      // place rather than stacking — users get a clean progression
      // of messages instead of a queue.
      id: "progressive-hint",
    });
  }, [hintSession, side]);

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
            {/* RAZ-14: Hint label mirrors the next action.
                - no session: "Hint" (reveal a nudge)
                - tier 1 active: "Hint 2/3" (tap to see technique + cell)
                - tier 2 active: "Hint 3/3" (tap to place)
                We keep the word "Hint" in the label so the button's
                purpose stays obvious at a glance; the fraction is
                a progress indicator. The badge only appears when a
                progressive session is active — legacy one-shot mode
                shows the plain label. */}
            <ControlButton
              label={
                hintSession
                  ? hintSession.tier === 1
                    ? "Hint 2/3"
                    : "Hint 3/3"
                  : "Hint"
              }
              shortcut="H"
              onClick={() => void hint()}
              disabled={isComplete}
              icon={<Lightbulb />}
              active={!!hintSession}
            />
            {/* RAZ-42: optional — hidden when the user turns off "Auto-notes"
                in Settings (persisted). Replaces every empty cell's pencil
                marks with legal candidates; one undo reverts. */}
            {autoNotesEnabled && (
              <ControlButton
                label={autoNotesMatch ? "Clear notes" : "Auto-notes"}
                shortcut=""
                onClick={autoFillNotes}
                disabled={isComplete}
                active={autoNotesMatch}
                icon={<WandSparkles />}
              />
            )}
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
