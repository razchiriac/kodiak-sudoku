"use client";

import { Lightbulb, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCoachTips } from "./use-coach-tips";

// RAZ-49 — Adaptive Coach Mode banner.
//
// The visible surface of the deterministic coaching-tip system. Sits
// directly under the rescue chip (RAZ-48) so the two systems can
// stack without overlapping the board. Renders nothing when no tip
// is active, so the parent layout doesn't reflow.
//
// Design constraints from the ticket:
//   - "Tips never block gameplay" — the banner is a sibling of the
//     board, not an overlay. Tapping outside doesn't dismiss
//     anything (the banner has its own X for that).
//   - "Player can fully disable adaptive coach" — the per-user
//     toggle in Settings flips `settings.coachingTips`, which the
//     hook reads as a kill switch. The Edge Config flag is a
//     separate kill switch above that.
//   - "Tips are short and dismissible" — the message + detail render
//     in two short lines; an X dismisses and arms the per-kind
//     cooldown / per-puzzle snooze policy in the hook.
//
// Severity → palette map:
//   - "warn" (conflict-explainer): amber. Same palette as the
//     rescue chip so the player learns "amber = the assistant is
//     pointing at something to fix".
//   - "info" (everything else): slate. Quieter than amber so habit
//     nudges don't compete visually with active conflicts.

export function CoachTipBanner() {
  const tip = useCoachTips();
  if (!tip) return null;

  const isWarn = tip.severity === "warn";
  // Co-located classnames rather than a lookup table because we
  // only have two severities. A third would be the moment to
  // introduce a map.
  const containerCls = isWarn
    ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200"
    : "border-slate-200 bg-slate-50 text-slate-900 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-200";
  const buttonHoverCls = isWarn
    ? "hover:bg-amber-100 dark:hover:bg-amber-900/40"
    : "hover:bg-slate-100 dark:hover:bg-slate-800/60";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Coaching tip: ${tip.message}`}
      className={`flex w-full max-w-[560px] items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-sm ${containerCls}`}
    >
      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="flex flex-1 flex-col gap-0.5">
        <span className="text-xs font-medium leading-snug sm:text-sm">
          {tip.message}
        </span>
        {/* Secondary line is optional — many tips are self-contained. */}
        {tip.detail ? (
          <span className="text-[11px] leading-snug opacity-80 sm:text-xs">
            {tip.detail}
          </span>
        ) : null}
      </div>
      <Button
        size="icon"
        variant="ghost"
        className={`h-7 w-7 shrink-0 ${buttonHoverCls}`}
        aria-label="Dismiss coaching tip"
        onClick={tip.dismiss}
      >
        <X className="h-4 w-4" aria-hidden />
      </Button>
    </div>
  );
}
