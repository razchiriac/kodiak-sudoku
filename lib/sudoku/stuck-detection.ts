// RAZ-48: Stuck Detection — pure, deterministic detectors that look
// at a sliding window of recent input events plus the current
// conflict set and decide whether the player has plateaued in a way
// that warrants surfacing the rescue chip.
//
// Why pure & deterministic (no AI in v1):
//   - Every detector signal needs to be reproducible from the same
//     inputs so the rescue UX never says "you're stuck" without a
//     concrete reason the player can verify.
//   - Acceptance criterion: "Rescue suggestions are deterministic
//     and reproducible." That precludes any non-deterministic
//     (model-based) scoring at this stage.
//   - The follow-up AI rescue (a future ticket) will LAYER on top of
//     this signal — i.e. only consult the model AFTER one of the
//     deterministic detectors has fired. Keeping the gating
//     deterministic limits prompt cost and keeps the worst case
//     ("model is down") graceful.
//
// All thresholds live as named constants at the top of the file so
// they're easy to tune from cohort signal post-launch.
//
// The detectors are ORDERED — the first one that fires wins, mirroring
// the recommendation-rules pattern used in `lib/sudoku/breakdown.ts`.
// Ordering reflects what we expect to be the most actionable nudge
// for that signal:
//   1. conflict   — there's a concrete logical error sitting on the
//                   board for too long; pointing it out is the
//                   strongest rescue.
//   2. repeat     — the player is oscillating on the same cell; a
//                   region nudge usually helps them escape the loop.
//   3. idle       — last-resort signal; nothing wrong, just no
//                   forward progress. Surfaces the gentlest prompt.
//
// Calling code is expected to also enforce a per-session COOLDOWN
// between rescue prompts (see `RESCUE_COOLDOWN_MS`). The detectors
// themselves don't track that — they're stateless functions of
// (events, conflicts, elapsed). Keeping cooldown out of here means
// the same `detectStuck` can be unit-tested without faking timers.

import type { InputEvent } from "./input-events";

// Event-window we look back at when scoring `repeat`. 12 entries is
// big enough to spot a 3-cycle oscillation (place → erase → place →
// erase → place → erase = 6 events) with headroom for unrelated
// activity. Smaller windows over-trigger on noise; larger ones lag
// real signal.
const REPEAT_WINDOW = 12;

// Number of value-mode placement OR erase events on the SAME cell
// inside REPEAT_WINDOW required to call it a stuck-repeat. 4 matches
// "place, erase, place, erase" (a clear oscillation) without firing
// on a player who legitimately corrected one mistake.
const REPEAT_MIN_HITS = 4;

// How long the player can sit with no new mutation events before we
// call them idle. 90s gives a thinker plenty of room before we
// interrupt. Below 60s and we'd routinely interrupt people who are
// solving by inspection rather than placement; above 120s and the
// nudge stops feeling timely.
const IDLE_THRESHOLD_MS = 90_000;

// How long an existing conflict has to persist before we treat it as
// the kind of "you put the wrong digit somewhere two minutes ago and
// haven't found it" pattern that the rescue is designed to break.
const CONFLICT_THRESHOLD_MS = 30_000;

// Minimum gap between consecutive rescue prompts (whether dismissed
// or accepted). Keeps us from nagging — acceptance criterion calls
// out "Rescue prompt never blocks gameplay" and "strict prompt caps
// and cooldown windows" as the mitigation for over-prompting.
export const RESCUE_COOLDOWN_MS = 90_000;

// Minimum time-into-attempt before any detector is allowed to fire.
// Without this, a player who opens a fresh puzzle and pauses for 90s
// to read the rules would immediately get an idle prompt. The first
// 30s are reserved for orientation.
export const RESCUE_WARMUP_MS = 30_000;

export type StuckKind = "conflict" | "repeat" | "idle";

// Confidence is a coarse 0..1 score so the UI can choose to render
// a more-or-less prominent prompt later. v1 chip ignores it; we
// expose it now so a future "tier-2" rescue UX (more aggressive
// nudge) can gate on a higher threshold without an additional
// detector pass.
export type StuckSignal = {
  kind: StuckKind;
  // Coarse 0..1 score. Detectors set this to a fixed bucket value
  // (LOW=0.4, MED=0.6, HIGH=0.85). Not a calibrated probability.
  confidence: number;
  // Short, deterministic explanation. Surfaced in the chip tooltip
  // so a curious player can see WHY we flagged them. Rendered
  // verbatim — no template substitution at the call site.
  reason: string;
};

const CONF_LOW = 0.4;
const CONF_MED = 0.6;
const CONF_HIGH = 0.85;

export type DetectInput = {
  // Recent input events, oldest first. Pass the full ring buffer —
  // we slice internally. Empty array is fine and turns repeat off.
  events: readonly InputEvent[];
  // Number of currently-conflicted cells on the board. Sourced from
  // the store's `conflicts` set (`s.conflicts.size`). We don't need
  // the cell indices themselves for v1 detectors.
  conflictCount: number;
  // Wall-clock-ish elapsed game time in ms (the store's `elapsedMs`,
  // which excludes paused time). Used as the time anchor for both
  // idle and conflict detectors.
  elapsedMs: number;
  // `elapsedMs` value at the moment the conflict count first went
  // non-zero in the current run of conflicts. Null when there is no
  // active conflict OR when we don't know (fresh page load). The
  // store mirror keeps this updated in PlayClient — see
  // `useStuckDetector`. Without this anchor the conflict detector
  // can't compute "how long has the conflict been there".
  conflictSinceMs: number | null;
  // True when the game timer is actively running. We never fire any
  // detector while paused; otherwise an idle prompt would pop the
  // moment a player un-pauses.
  isRunning: boolean;
  // True when the puzzle is solved — guards against firing as the
  // completion modal mounts.
  isComplete: boolean;
};

// Public entry point. Returns the highest-priority signal, or null
// when nothing is stuck. Caller is responsible for cooldown bookkeeping.
export function detectStuck(input: DetectInput): StuckSignal | null {
  if (!input.isRunning) return null;
  if (input.isComplete) return null;
  if (input.elapsedMs < RESCUE_WARMUP_MS) return null;

  const conflict = detectConflict(input);
  if (conflict) return conflict;

  const repeat = detectRepeat(input);
  if (repeat) return repeat;

  const idle = detectIdle(input);
  if (idle) return idle;

  return null;
}

// Conflict detector — fires when at least one cell has been in
// conflict for `CONFLICT_THRESHOLD_MS` continuously. Uses the
// store-mirrored `conflictSinceMs` anchor so we don't have to scan
// the events list to figure out when the conflict started.
function detectConflict(input: DetectInput): StuckSignal | null {
  if (input.conflictCount === 0) return null;
  if (input.conflictSinceMs == null) return null;
  const age = input.elapsedMs - input.conflictSinceMs;
  if (age < CONFLICT_THRESHOLD_MS) return null;
  return {
    kind: "conflict",
    confidence: CONF_HIGH,
    reason: `${input.conflictCount} conflict${input.conflictCount === 1 ? "" : "s"} have been on the board for ${Math.round(age / 1000)}s`,
  };
}

// Repeat detector — fires when the most recent REPEAT_WINDOW value
// or erase events touch the same cell at least REPEAT_MIN_HITS
// times. This catches "place 5, erase, place 5, erase, place 5"
// loops where the player has fixated on a guess rather than working
// out the constraint.
function detectRepeat(input: DetectInput): StuckSignal | null {
  if (input.events.length === 0) return null;
  // Slice the tail of the ring buffer. We only consider value /
  // erase events — hint-applied placements are system actions and
  // shouldn't count toward "the player is oscillating".
  const tail = input.events
    .slice(-REPEAT_WINDOW)
    .filter((e) => e.k === "v" || e.k === "e");
  if (tail.length < REPEAT_MIN_HITS) return null;
  // Count visits per cell. Map<number, number> is fine here — the
  // window is tiny and a real Map wins on key handling vs an object.
  const visits = new Map<number, number>();
  for (const e of tail) {
    visits.set(e.c, (visits.get(e.c) ?? 0) + 1);
  }
  // Find the highest visit count. Iterating a 12-entry map is
  // trivial — we don't need the cell index, just whether SOME cell
  // crosses the threshold (the chip's reason text just needs the
  // count, not the location).
  let bestCount = 0;
  for (const count of visits.values()) {
    if (count > bestCount) bestCount = count;
  }
  if (bestCount < REPEAT_MIN_HITS) return null;
  return {
    kind: "repeat",
    confidence: CONF_MED,
    reason: `You've placed and erased the same cell ${bestCount} times — try a different region`,
  };
}

// Idle detector — fires when there have been no events for
// `IDLE_THRESHOLD_MS`. We use the LAST event's `t` as the anchor
// rather than a wall-clock "last activity" timestamp because `t` is
// monotonic in elapsed-game-time and pause-exclusive, matching how
// `elapsedMs` is computed.
function detectIdle(input: DetectInput): StuckSignal | null {
  // No events at all — the player started but hasn't placed anything.
  // Use elapsedMs as the gap anchor.
  const last = input.events[input.events.length - 1];
  const sinceLast = last == null ? input.elapsedMs : input.elapsedMs - last.t;
  if (sinceLast < IDLE_THRESHOLD_MS) return null;
  return {
    kind: "idle",
    confidence: CONF_LOW,
    reason: `${Math.round(sinceLast / 1000)}s since your last move — would a hint help?`,
  };
}
