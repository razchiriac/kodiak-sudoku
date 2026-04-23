// RAZ-45: Post-Game Breakdown — a pure, deterministic function that
// turns the basic stats of a completed run (elapsed time, mistakes,
// hints, difficulty) into a structured insights object the
// CompletionModal renders as a "performance narrative" panel.
//
// Why pure & deterministic (no AI in v1):
//   - The acceptance criterion says the panel must render in <300ms
//     after the modal opens. A network round-trip to an AI provider
//     would blow that budget on cold connections, AND would have to
//     gracefully degrade when the provider is down. Keeping v1
//     deterministic means the panel ALWAYS renders instantly.
//   - The free-text AI debrief is a separate ticket (RAZ-61) that
//     LAYERS ON TOP of this structured output rather than replacing
//     it. When RAZ-61 ships, the AI panel can read the same
//     `RunBreakdown` shape and add prose around it.
//
// All thresholds (TARGET_TIME_MS, mistake/hint buckets, etc.) live
// at the top of the file as named constants so they're trivial to
// tune from the experiment cohort signal we get post-launch. The
// recommendation rules are an explicit ordered list — first match
// wins. That makes the rule precedence obvious at a glance and gives
// the unit test a single fixture to enumerate.

// Per-difficulty target solve time (ms). These are NOT the leaderboard
// floors (those are anti-cheat thresholds in `actions.ts`); they're
// "what a comfortable solve looks like" — a reasonable median for a
// player who's not racing. Used to bucket pace as fast / typical /
// slow. Numbers chosen as ~2-3x the time floors which were themselves
// generous lower bounds.
const TARGET_TIME_MS: Record<number, number> = {
  1: 5 * 60 * 1000,   // Easy: 5 minutes
  2: 9 * 60 * 1000,   // Medium: 9 minutes
  3: 15 * 60 * 1000,  // Hard: 15 minutes
  4: 25 * 60 * 1000,  // Expert: 25 minutes
};

// Pace bucket boundaries, expressed as % of the difficulty's target.
// A solve at <=70% of target is "fast"; >=130% is "slow"; otherwise
// "typical". Symmetric ±30% band keeps a typical solver squarely in
// the middle category and only flags clear outliers.
const PACE_FAST_MAX_PCT = 70;
const PACE_SLOW_MIN_PCT = 130;

// Mistake bucket cutoffs. Distinct from "show mistakes" tinting —
// these are solve-end summaries.
const MISTAKES_CLEAN_MAX = 0; // exactly zero mistakes
const MISTAKES_MINOR_MAX = 2; // 1 or 2 mistakes

// Hint bucket cutoffs.
const HINTS_UNASSISTED_MAX = 0;
const HINTS_GUIDED_MAX = 2;

export type PaceKind = "fast" | "typical" | "slow";
export type AccuracyKind = "clean" | "minor" | "rough";
export type AssistanceKind = "unassisted" | "guided" | "heavy";

// Recommendation IDs. We enumerate them as a string-literal union
// (project rule: maps not enums) so callers can switch on the id
// without parsing free text.
export type RecommendationId =
  | "step-up-difficulty"
  | "try-speed-mode"
  | "try-zen-mode"
  | "slow-down-for-accuracy"
  | "study-techniques"
  | "keep-practicing";

export type RunBreakdown = {
  pace: {
    kind: PaceKind;
    // (elapsedMs / targetMs * 100), rounded to nearest integer. So
    // 100 means the user matched the target, 70 means they finished
    // in 70% of the target time. Useful for the UI to render a
    // small delta badge ("-30% vs target").
    pctOfTarget: number;
    label: string;
  };
  accuracy: {
    mistakes: number;
    kind: AccuracyKind;
    label: string;
  };
  assistance: {
    hints: number;
    kind: AssistanceKind;
    label: string;
  };
  recommendation: {
    id: RecommendationId;
    title: string;
    body: string;
  };
};

export type BreakdownInput = {
  elapsedMs: number;
  mistakes: number;
  hintsUsed: number;
  difficultyBucket: number;
};

// Bucketing helpers — kept tiny and named so the unit test can pin
// down exactly which threshold a particular fixture trips.
function paceKind(pct: number): PaceKind {
  if (pct <= PACE_FAST_MAX_PCT) return "fast";
  if (pct >= PACE_SLOW_MIN_PCT) return "slow";
  return "typical";
}

function accuracyKind(mistakes: number): AccuracyKind {
  if (mistakes <= MISTAKES_CLEAN_MAX) return "clean";
  if (mistakes <= MISTAKES_MINOR_MAX) return "minor";
  return "rough";
}

function assistanceKind(hints: number): AssistanceKind {
  if (hints <= HINTS_UNASSISTED_MAX) return "unassisted";
  if (hints <= HINTS_GUIDED_MAX) return "guided";
  return "heavy";
}

// Human-facing label for each pace bucket. Short — the UI may render
// these inside a compact badge.
function paceLabel(kind: PaceKind, pctOfTarget: number): string {
  const delta = pctOfTarget - 100;
  const sign = delta < 0 ? `-${Math.abs(delta)}%` : `+${delta}%`;
  if (kind === "fast") return `Fast pace (${sign} vs target)`;
  if (kind === "slow") return `Steady pace (${sign} vs target)`;
  return `On target (${sign})`;
}

function accuracyLabel(kind: AccuracyKind, mistakes: number): string {
  if (kind === "clean") return "No mistakes — clean solve";
  if (kind === "minor") {
    return `${mistakes} mistake${mistakes === 1 ? "" : "s"} — minor`;
  }
  return `${mistakes} mistakes — try slowing down`;
}

function assistanceLabel(kind: AssistanceKind, hints: number): string {
  if (kind === "unassisted") return "No hints used";
  if (kind === "guided") {
    return `${hints} hint${hints === 1 ? "" : "s"} — light assist`;
  }
  return `${hints} hints — heavy assist`;
}

// Recommendation rules. Ordered — first match wins. Each rule is a
// predicate over the bucket triple plus optional difficulty / pct
// context. The ordering is intentional:
//   1. Worst-mistake offenders get a slow-down nudge first (their
//      most impactful improvement is accuracy, not speed).
//   2. Heavy-hint users get a technique-study nudge (they'll plateau
//      if we just nudge them to a harder difficulty).
//   3. Confident solvers (clean + fast) get a step-up nudge.
//   4. Confident solvers (clean + typical pace) get a try-speed-mode
//      nudge to inject variety.
//   5. Long meandering solves get a try-zen-mode nudge so they're
//      not stuck in mistake-counter anxiety.
//   6. Catch-all encouragement so the panel never renders without a
//      recommendation.
type Rule = {
  id: RecommendationId;
  title: string;
  body: string;
  match: (b: {
    pace: PaceKind;
    accuracy: AccuracyKind;
    assistance: AssistanceKind;
    difficulty: number;
  }) => boolean;
};

const RULES: readonly Rule[] = [
  {
    id: "slow-down-for-accuracy",
    title: "Slow down for accuracy",
    body:
      "Your placements were quick but you made several mistakes. Try Show Mistakes or Zen mode (which blocks illegal placements) to retrain your scan-before-you-place habit.",
    match: (b) => b.accuracy === "rough",
  },
  {
    id: "study-techniques",
    title: "Study a technique",
    body:
      "Heavy hint use suggests one or two specific patterns are tripping you up. The Technique Journey breaks Sudoku down into bite-sized lessons — start there before stepping up the difficulty.",
    match: (b) => b.assistance === "heavy",
  },
  {
    id: "step-up-difficulty",
    title: "Step up to the next difficulty",
    body:
      "Clean, fast, no hints — you're ready for harder puzzles. The next bucket up will keep your skills sharp.",
    match: (b) =>
      b.accuracy === "clean" &&
      b.pace === "fast" &&
      b.assistance === "unassisted" &&
      b.difficulty < 4,
  },
  {
    id: "try-speed-mode",
    title: "Try Speed mode",
    body:
      "Solid solve at a comfortable pace. The Speed preset enables jump-on-place and a compact pad — see how much time you can shave off your next attempt.",
    match: (b) =>
      b.accuracy !== "rough" &&
      b.pace !== "slow" &&
      b.assistance !== "heavy",
  },
  {
    id: "try-zen-mode",
    title: "Try Zen mode",
    body:
      "Long, careful solve. Zen mode blocks illegal placements before they land, so you can take all the time you want without watching the mistake counter creep up.",
    match: (b) => b.pace === "slow" && b.accuracy !== "clean",
  },
  {
    id: "keep-practicing",
    title: "Solid run — keep going",
    body:
      "A complete solve is a complete solve. Try a different mode preset or a different difficulty next to keep things fresh.",
    match: () => true,
  },
];

// Compute a deterministic breakdown for a run. This function NEVER
// throws on real inputs — defensive guards above the buckets handle
// the edge cases (zero elapsed time, unknown difficulty bucket). The
// return is always a fully-populated `RunBreakdown` so the UI can
// render unconditionally without optional-chaining noise.
export function computeBreakdown(input: BreakdownInput): RunBreakdown {
  const target =
    TARGET_TIME_MS[input.difficultyBucket] ?? TARGET_TIME_MS[2];
  // Guard against zero or wildly small target so we don't divide-by-
  // zero or produce a 5000% pace label on unusual difficulty buckets.
  const safeTarget = Math.max(target, 60_000);
  const pctOfTarget = Math.round((input.elapsedMs / safeTarget) * 100);
  const pace = paceKind(pctOfTarget);
  const accuracy = accuracyKind(input.mistakes);
  const assistance = assistanceKind(input.hintsUsed);

  const matchedRule =
    RULES.find((r) =>
      r.match({
        pace,
        accuracy,
        assistance,
        difficulty: input.difficultyBucket,
      }),
    ) ?? RULES[RULES.length - 1];

  return {
    pace: {
      kind: pace,
      pctOfTarget,
      label: paceLabel(pace, pctOfTarget),
    },
    accuracy: {
      mistakes: input.mistakes,
      kind: accuracy,
      label: accuracyLabel(accuracy, input.mistakes),
    },
    assistance: {
      hints: input.hintsUsed,
      kind: assistance,
      label: assistanceLabel(assistance, input.hintsUsed),
    },
    recommendation: {
      id: matchedRule.id,
      title: matchedRule.title,
      body: matchedRule.body,
    },
  };
}
