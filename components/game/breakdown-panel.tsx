"use client";

import {
  CheckCircle2,
  Gauge,
  Lightbulb,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import { computeBreakdown, type RunBreakdown } from "@/lib/sudoku/breakdown";
import { cn } from "@/lib/utils";

// RAZ-45: Post-Game Breakdown panel. Pure presentational component
// that takes the basic completion stats (already in scope on the
// CompletionModal) and renders the deterministic insights returned
// by `computeBreakdown`. Zero state — rerendering with new props is
// the only way state changes, which keeps the modal's existing
// React tree simple.
//
// The panel is wrapped in a try/catch at the call site so a future
// pure-function regression can never crash the whole modal — at
// worst the panel is hidden and the player still sees the existing
// Time / Mistakes / Hints grid above.

type BreakdownPanelProps = {
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  difficultyBucket: number;
};

// Map breakdown bucket kinds to a pair of (text class, dot class) so
// the panel keeps a consistent visual language: green for "good",
// amber for "watch this", muted for "neutral". We use the same
// design tokens the rest of the app uses (no new colors invented
// here) so the panel stays themeable via the palette setting.
const PACE_TONE: Record<RunBreakdown["pace"]["kind"], string> = {
  fast: "text-emerald-600 dark:text-emerald-400",
  typical: "text-foreground",
  slow: "text-amber-600 dark:text-amber-400",
};

const ACCURACY_TONE: Record<RunBreakdown["accuracy"]["kind"], string> = {
  clean: "text-emerald-600 dark:text-emerald-400",
  minor: "text-foreground",
  rough: "text-amber-600 dark:text-amber-400",
};

const ASSISTANCE_TONE: Record<RunBreakdown["assistance"]["kind"], string> = {
  unassisted: "text-emerald-600 dark:text-emerald-400",
  guided: "text-foreground",
  heavy: "text-amber-600 dark:text-amber-400",
};

export function BreakdownPanel(props: BreakdownPanelProps) {
  // We compute inline rather than memoizing because:
  //   1. The function is dirt cheap (no allocations beyond the
  //      returned object).
  //   2. The CompletionModal renders this panel exactly once when
  //      the modal opens; there's no rerender pressure.
  //   3. A try/catch wrapping a useMemo is awkward; a plain
  //      try/catch around a sync call is the simplest path.
  let breakdown: RunBreakdown | null = null;
  try {
    breakdown = computeBreakdown({
      elapsedMs: props.elapsedMs,
      mistakes: props.mistakes,
      hintsUsed: props.hintsUsed,
      difficultyBucket: props.difficultyBucket,
    });
  } catch {
    // Defensive — `computeBreakdown` is pure and shouldn't throw on
    // any real input, but the acceptance criterion is explicit:
    // "If breakdown compute fails, objective stats still render and
    // no crash occurs". Returning null is the correct behavior.
    return null;
  }
  if (!breakdown) return null;

  return (
    <section
      className="rounded-lg border bg-muted/30 p-4 text-sm"
      aria-label="Post-game breakdown"
    >
      <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" aria-hidden />
        Breakdown
      </h3>

      <ul className="grid gap-2">
        <BreakdownRow
          icon={Gauge}
          label={breakdown.pace.label}
          tone={PACE_TONE[breakdown.pace.kind]}
        />
        <BreakdownRow
          icon={CheckCircle2}
          label={breakdown.accuracy.label}
          tone={ACCURACY_TONE[breakdown.accuracy.kind]}
        />
        <BreakdownRow
          icon={Lightbulb}
          label={breakdown.assistance.label}
          tone={ASSISTANCE_TONE[breakdown.assistance.kind]}
        />
      </ul>

      <div className="mt-4 rounded-md border border-primary/20 bg-primary/5 p-3">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <TrendingUp className="h-4 w-4 text-primary" aria-hidden />
          {breakdown.recommendation.title}
        </div>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {breakdown.recommendation.body}
        </p>
      </div>
    </section>
  );
}

// Single row in the bucket list. Pulled out so the three rows stay
// visually identical without duplicating JSX. Keeps the parent
// component flat and easier to scan.
function BreakdownRow({
  icon: Icon,
  label,
  tone,
}: {
  icon: typeof Gauge;
  label: string;
  tone: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <Icon className={cn("h-4 w-4 shrink-0", tone)} aria-hidden />
      <span className={cn("text-sm", tone)}>{label}</span>
    </li>
  );
}
