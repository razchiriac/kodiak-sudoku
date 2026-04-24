"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Brain,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  generateDebriefAction,
  recordDebriefFeedbackAction,
} from "@/lib/server/debrief.actions";
import type { Debrief } from "@/lib/server/debrief";

// RAZ-61 — Post-Game AI Debrief card.
//
// Renders inside the CompletionModal, beneath the BreakdownPanel
// (RAZ-45). Same input shape as the panel — `breakdown.input` —
// plus a `cacheKey` so a refresh of the modal doesn't re-fire the
// (paid) generation action.
//
// Behavior summary:
//   1. On mount, check localStorage[`sudoku-ai-debrief:${cacheKey}`]
//      for a cached debrief. If found, render directly (no network).
//   2. Otherwise, call generateDebriefAction. The action ALWAYS
//      returns a debrief (deterministic fallback is built-in), so
//      there's no "no result" UI to design.
//   3. While the action is in flight, show a small inline
//      "Generating debrief…" spinner. Modal still renders all the
//      stat cards above so the player isn't blocked.
//   4. Persist the result to localStorage so re-opens are free.
//   5. 👍 / 👎 feedback persists per debrief (one-shot — the
//      buttons disable after a click) so we don't double-count a
//      user spam-clicking.
//
// Failure modes:
//   - Network error talking to the server action → render the
//     hand-built deterministic fallback locally so the card never
//     shows a blank state.
//   - Rate-limit response → render the deterministic fallback
//     and tag the card with a small "AI cooldown" subnote.
//
// Why localStorage rather than the Zustand store: the debrief is
// per-completion data, not per-game. The store gets cleared when
// startGame fires next; localStorage survives across sessions and
// covers the "user closes the tab and comes back to /play and we
// somehow re-render the modal" edge case for free.

// Shape of the cached entry. Versioned so a future schema change
// can invalidate stale cache entries cleanly.
type CachedDebrief = {
  version: 1;
  debriefId: string;
  debrief: Debrief;
  generatedAt: number;
};

const CACHE_VERSION = 1 as const;
const CACHE_PREFIX = "sudoku-ai-debrief:";
// Keep cached debriefs around for 90 days. Long enough that a user
// who comes back to a completed daily a week later still sees their
// debrief; short enough that we don't bloat localStorage indefinitely.
const CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Tone-to-color mapping. Reuses the same tonal vocabulary the
// BreakdownPanel uses so the modal reads as one coherent surface
// rather than a stack of panels designed in isolation.
const TONE_BORDER: Record<Debrief["tone"], string> = {
  congratulatory: "border-emerald-500/30 bg-emerald-500/5",
  encouraging: "border-primary/20 bg-primary/5",
  constructive: "border-amber-500/30 bg-amber-500/5",
};

const TONE_ICON: Record<Debrief["tone"], string> = {
  congratulatory: "text-emerald-600 dark:text-emerald-400",
  encouraging: "text-primary",
  constructive: "text-amber-600 dark:text-amber-400",
};

// Map next-action ids to the destination the CTA navigates to.
// Centralized here (and not in the engine) because routing is a
// frontend concern. The engine just emits an id; this layer turns
// the id into a path.
const NEXT_ACTION_HREF: Record<Debrief["nextActionId"], Route> = {
  "play-same-difficulty": "/play",
  "play-harder": "/play",
  "play-easier": "/play",
  "try-zen-mode": "/play?preset=zen" as Route,
  "try-speed-mode": "/play?preset=speed" as Route,
  "study-techniques": "/learn",
  "back-to-hub": "/play",
};

export type AiDebriefCardProps = {
  // Input shape forwarded to the server action. Same as the
  // BreakdownPanel input plus the `mode` discriminator.
  input: {
    elapsedMs: number;
    mistakes: number;
    hintsUsed: number;
    difficultyBucket: number;
    mode: "daily" | "random" | "custom" | "challenge" | "quick";
    previousBestMs?: number | null;
    personalBestImproved?: boolean;
  };
  // Stable string the card uses to dedupe across refreshes. Pass
  // something that uniquely identifies this completion: e.g.
  // `random:${puzzleId}:${attemptId}` or `daily:${date}:${userId}`.
  // When the cacheKey changes, the card refetches.
  cacheKey: string;
};

export function AiDebriefCard({ input, cacheKey }: AiDebriefCardProps) {
  const router = useRouter();

  // Local UI state. We intentionally don't use TanStack Query or
  // SWR here — the action is fired exactly once per cacheKey and
  // we want the simplest possible state machine. A `useEffect` +
  // a few `useState` hooks is plenty.
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [debriefId, setDebriefId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rateLimited, setRateLimited] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<null | "up" | "down">(null);

  // Use a ref to track whether we've already fired for this
  // cacheKey in this React tree. Without this, StrictMode's
  // double-mount in dev would fire the action twice.
  const firedFor = useRef<string | null>(null);

  // Resolve / fetch effect. Runs whenever cacheKey changes.
  useEffect(() => {
    if (firedFor.current === cacheKey) return;
    firedFor.current = cacheKey;
    setLoading(true);
    setRateLimited(false);
    setFeedbackSent(null);

    // 1. Cache hit?
    const cached = readCache(cacheKey);
    if (cached) {
      setDebrief(cached.debrief);
      setDebriefId(cached.debriefId);
      setLoading(false);
      return;
    }

    // 2. Cache miss — fire the action. We DO NOT abort on unmount
    //    because the result is cheap to swallow and it lets a
    //    quick-dismiss-then-reopen still benefit from the cache.
    let cancelled = false;
    void (async () => {
      try {
        const res = await generateDebriefAction(input);
        if (cancelled) return;
        if (res.ok) {
          const id = makeDebriefId();
          setDebrief(res.debrief);
          setDebriefId(id);
          writeCache(cacheKey, { debrief: res.debrief, debriefId: id });
        } else if (res.error === "rate_limited") {
          // Render the local-only deterministic fallback. We DON'T
          // call the engine again — the server returned the
          // canonical fallback shape via its own deterministic
          // path on success, but here we never got that far.
          // Instead, we synthesize a minimal client-side debrief
          // from the input so the card stays useful.
          const local = clientFallbackDebrief(input);
          const id = makeDebriefId();
          setDebrief(local);
          setDebriefId(id);
          setRateLimited(true);
          // Don't cache the rate-limited fallback — we want the
          // next render to retry.
        } else {
          // schema_invalid or internal — should never happen for
          // valid input but render the safety net just in case.
          const local = clientFallbackDebrief(input);
          const id = makeDebriefId();
          setDebrief(local);
          setDebriefId(id);
        }
      } catch {
        // Network error talking to the server action. Same UX as
        // an internal error: render the local fallback.
        if (cancelled) return;
        const local = clientFallbackDebrief(input);
        const id = makeDebriefId();
        setDebrief(local);
        setDebriefId(id);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [cacheKey, input]);

  const onFeedback = useCallback(
    async (rating: "up" | "down") => {
      if (!debrief || !debriefId || feedbackSent) return;
      setFeedbackSent(rating);
      // Fire-and-forget — the action only logs in v1, so a network
      // failure here is a non-event for the user.
      try {
        await recordDebriefFeedbackAction({
          debriefId,
          rating,
          bullets: debrief.bullets,
          source: debrief.source ?? "deterministic",
          difficultyBucket: input.difficultyBucket,
        });
      } catch {
        // No-op — we already set local UI state to reflect the click.
      }
    },
    [debrief, debriefId, feedbackSent, input.difficultyBucket],
  );

  // Loading state. Tiny skeleton so the modal doesn't reflow when
  // the debrief lands.
  if (loading) {
    return (
      <section
        className="rounded-lg border bg-muted/20 p-4 text-sm"
        aria-label="AI debrief loading"
      >
        <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Brain className="h-3.5 w-3.5" aria-hidden />
          AI debrief
        </h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span>Generating a personal debrief…</span>
        </div>
      </section>
    );
  }

  // No debrief at all (extremely unlikely — only happens if the
  // useEffect short-circuits before any branch sets state).
  if (!debrief) return null;

  const tone = debrief.tone;
  const isAi = debrief.source === "ai";

  return (
    <section
      className={cn(
        "rounded-lg border p-4 text-sm",
        TONE_BORDER[tone],
      )}
      aria-label="AI debrief"
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Brain className={cn("h-3.5 w-3.5", TONE_ICON[tone])} aria-hidden />
          {isAi ? "AI debrief" : "Performance summary"}
        </h3>
        {/* Honest source-of-truth badge. We don't want to claim AI
            wrote bullets when the deterministic fallback did. */}
        {!isAi && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Deterministic
          </span>
        )}
        {rateLimited && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
            AI cooldown
          </span>
        )}
      </header>

      <ul className="grid gap-2">
        {debrief.bullets.map((bullet, i) => (
          <li key={i} className="flex items-start gap-2">
            <Sparkles
              className={cn("mt-0.5 h-4 w-4 shrink-0", TONE_ICON[tone])}
              aria-hidden
            />
            <span className="text-sm leading-relaxed">{bullet}</span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="default"
          onClick={() => router.push(NEXT_ACTION_HREF[debrief.nextActionId])}
          className="gap-1.5"
        >
          {debrief.nextActionLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        </Button>

        {/* Feedback row. Disabled after a click — we don't want a
            user to flip-flop or double-rate. The aria labels make
            it screen-reader friendly. */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          {feedbackSent ? (
            <span aria-live="polite">Thanks for the feedback!</span>
          ) : (
            <>
              <span className="mr-1">Useful?</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Helpful debrief"
                onClick={() => void onFeedback("up")}
              >
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                aria-label="Not helpful debrief"
                onClick={() => void onFeedback("down")}
              >
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------
// Local helpers
// ---------------------------------------------------------------

// Read cache. Returns null on miss / parse error / TTL expiry.
// Catch-all try/catch because localStorage can throw in private-
// browsing modes and on a malformed entry (e.g. user manually
// edited it in DevTools).
function readCache(cacheKey: string): CachedDebrief | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CACHE_PREFIX + cacheKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDebrief;
    if (parsed.version !== CACHE_VERSION) return null;
    if (Date.now() - parsed.generatedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Write cache. Best-effort — a quota error is silently ignored
// because losing the cache only costs us a re-fire next time.
function writeCache(
  cacheKey: string,
  payload: { debrief: Debrief; debriefId: string },
): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CachedDebrief = {
      version: CACHE_VERSION,
      debriefId: payload.debriefId,
      debrief: payload.debrief,
      generatedAt: Date.now(),
    };
    window.localStorage.setItem(CACHE_PREFIX + cacheKey, JSON.stringify(entry));
  } catch {
    // No-op — see comment above.
  }
}

// Generate a debrief id. We don't need crypto-strength uniqueness
// here (it's just a correlation key for telemetry); a simple
// random base36 string keyed by Date.now() is enough.
function makeDebriefId(): string {
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

// Synthetic client-side fallback used ONLY when the server action
// fails (rate-limited, network error). The "real" deterministic
// fallback lives in `lib/server/debrief.ts` and is what the action
// returns on a happy path with no API key. We keep this version
// tiny — three short hand-written bullets keyed off mistakes /
// hints — to avoid duplicating the server's recommendation logic.
function clientFallbackDebrief(
  input: AiDebriefCardProps["input"],
): Debrief {
  const cleanRun = input.mistakes === 0 && input.hintsUsed === 0;
  const heavy = input.mistakes >= 3 || input.hintsUsed >= 3;
  const tone: Debrief["tone"] = cleanRun
    ? "congratulatory"
    : heavy
      ? "constructive"
      : "encouraging";
  const bullets: [string, string, string] = cleanRun
    ? [
        "You finished without a single mistake.",
        "No hints used — pure scan-and-place.",
        "Try a harder bucket to keep the streak going.",
      ]
    : heavy
      ? [
          `${input.mistakes} mistake${input.mistakes === 1 ? "" : "s"} this run.`,
          `${input.hintsUsed} hint${input.hintsUsed === 1 ? "" : "s"} used.`,
          "Slow down on the next puzzle and double-check each placement.",
        ]
      : [
          "Solid completion overall.",
          input.mistakes > 0
            ? `${input.mistakes} mistake${input.mistakes === 1 ? "" : "s"} — minor wobble.`
            : "Mistake-free placement run.",
          "Try another puzzle to lock the technique in.",
        ];
  return {
    bullets,
    tone,
    nextActionId: heavy ? "play-easier" : cleanRun ? "play-harder" : "play-same-difficulty",
    nextActionLabel: heavy
      ? "Try an easier puzzle"
      : cleanRun
        ? "Step up the difficulty"
        : "Play another",
    source: "deterministic",
  };
}
