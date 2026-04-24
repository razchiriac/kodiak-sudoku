"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Brain,
  Loader2,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  requestCoachingAction,
  recordCoachFeedbackAction,
  type CoachActionResult,
} from "@/lib/server/coach.actions";
import type { CoachCard } from "@/lib/server/coach";
import type { Variant } from "@/lib/sudoku/board";

// RAZ-58 — In-game AI Coach panel.
//
// Renders as a centered Dialog. Mounted by play-client.tsx; the
// "Coach" header button toggles its `open` prop. Each open fires a
// fresh requestCoachingAction call (the board state changes between
// presses so caching wouldn't help — and would risk surfacing a
// stale move suggestion against a board the player has since
// changed).
//
// Behavior summary:
//   1. On open, snapshot the current game state (passed in via
//      `snapshotProvider`) and call requestCoachingAction.
//   2. While in flight, show a small "Thinking…" spinner.
//   3. On success, render the message + rationale + (when
//      validated) a "Try this move" CTA that calls onApplyMove.
//   4. On rate-limit, surface a small banner; the player can
//      close and try again later.
//   5. 👍 / 👎 fires recordCoachFeedbackAction; one-shot per card.
//
// Why a Dialog rather than a Sheet/Drawer:
//   - The shadcn Sheet primitive isn't installed in this repo (only
//     button/dialog/tabs/tooltip). Adding a new primitive for one
//     feature isn't worth the bundle bump.
//   - Centered Dialog matches the existing CompletionModal +
//     SettingsDialog visual language, which keeps the play screen
//     coherent across overlays.
//
// snapshotProvider pattern:
//   - We INTENTIONALLY don't subscribe to the game store from this
//     component. A coach card is a snapshot in time, not a live
//     view; if the player edits the board mid-coach the card stays
//     pinned to the snapshot it was generated against. The parent
//     hands us a callback that returns a fresh snapshot when we
//     ask for one (i.e. on open).

export type CoachSnapshot = {
  puzzleId: number;
  board: string;
  difficultyBucket: number;
  variant: Variant;
  mode: "daily" | "random" | "challenge" | "quick";
  selected: number | null;
  mistakesSoFar: number;
  hintsUsedSoFar: number;
};

export type CoachPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Returns a fresh snapshot of the game state. Called only when
  // the panel is opened OR when the user requests a re-fetch.
  snapshotProvider: () => CoachSnapshot;
  // Called when the user accepts the suggested move. The parent is
  // responsible for selecting the cell and placing the digit (we
  // don't reach into the Zustand store from here so the panel can
  // be unit-tested as a pure UI shell later).
  onApplyMove: (cellIndex: number, digit: number) => void;
};

// Tone-to-color mapping. Mirrors the BreakdownPanel / DebriefCard
// vocabulary so the play screen reads as one coherent surface.
const TONE_BORDER: Record<CoachCard["tone"], string> = {
  celebratory: "border-emerald-500/30 bg-emerald-500/5",
  encouraging: "border-primary/20 bg-primary/5",
  constructive: "border-amber-500/30 bg-amber-500/5",
};

const TONE_LABEL: Record<CoachCard["tone"], string> = {
  celebratory: "Nice run",
  encouraging: "Keep going",
  constructive: "Take a beat",
};

// Validation provenance label. Tells the player whether the move
// came from the deterministic solver (highest confidence) or just
// matched the puzzle's solution. Both are safe to place; the
// distinction is purely informational.
const VALIDATION_LABEL: Record<NonNullable<CoachCard["suggestion"]>["validatedBy"], string> = {
  solver: "Solver-verified",
  solution: "Matches the puzzle",
};

// Local UI state. Discriminated by `kind` so each branch's data is
// always present. Reset on every open so a stale error from a
// previous press doesn't leak into the next one.
type PanelState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; card: CoachCard; cardId: string; difficultyBucket: number }
  | { kind: "rate-limited" }
  | { kind: "error"; reason: "schema_invalid" | "puzzle_not_found" | "clue_mismatch" | "internal" | "thrown" };

export function CoachPanel({ open, onOpenChange, snapshotProvider, onApplyMove }: CoachPanelProps) {
  const [state, setState] = useState<PanelState>({ kind: "idle" });
  // Track which 👍/👎 the user clicked so we can disable both after
  // the first click. Reset on every open.
  const [feedbackSent, setFeedbackSent] = useState<null | "up" | "down">(null);
  // Track whether the player accepted the move so we can stop
  // showing the "Try this move" CTA (and forward the signal to
  // the feedback action).
  const [accepted, setAccepted] = useState(false);
  // Guard against double-fetch on a quick open/close cycle.
  const inFlightRef = useRef(false);

  const fetchCard = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setState({ kind: "loading" });
    try {
      const snapshot = snapshotProvider();
      const result: CoachActionResult = await requestCoachingAction(snapshot);
      if (!result.ok) {
        if (result.error === "rate_limited") {
          setState({ kind: "rate-limited" });
        } else {
          setState({ kind: "error", reason: result.error });
        }
        return;
      }
      setState({
        kind: "ready",
        card: result.card,
        cardId: result.cardId,
        difficultyBucket: snapshot.difficultyBucket,
      });
    } catch {
      // Action threw or the network blew up. We deliberately don't
      // try to construct a deterministic fallback client-side
      // (would require shipping the engine + the puzzle solution
      // to the browser, which is exactly what we want to avoid).
      // The user can simply press Coach again.
      setState({ kind: "error", reason: "thrown" });
    } finally {
      inFlightRef.current = false;
    }
  }, [snapshotProvider]);

  // Re-fetch on open, reset on close. We capture the open state in
  // the dep array so React re-runs the effect on every open/close
  // transition.
  useEffect(() => {
    if (open) {
      setFeedbackSent(null);
      setAccepted(false);
      void fetchCard();
    } else {
      // Tear down any in-flight result so the next open starts
      // clean. inFlightRef stays as-is — the outstanding promise
      // will resolve and update state, but the parent's
      // onOpenChange will already have hidden the dialog.
      setState({ kind: "idle" });
    }
    // We intentionally do NOT depend on snapshotProvider here. Its
    // identity is allowed to change across renders (new closure on
    // every render is the typical case) and we don't want to
    // re-fetch on every parent re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleApply = useCallback(() => {
    if (state.kind !== "ready" || !state.card.suggestion) return;
    onApplyMove(state.card.suggestion.cellIndex, state.card.suggestion.digit);
    setAccepted(true);
    // Don't auto-close — the player might want to send 👍/👎
    // feedback on the move quality after they place it.
  }, [state, onApplyMove]);

  const handleFeedback = useCallback(
    (rating: "up" | "down") => {
      if (state.kind !== "ready" || feedbackSent) return;
      setFeedbackSent(rating);
      // Fire-and-forget. The action only logs; failure is harmless.
      void recordCoachFeedbackAction({
        cardId: state.cardId,
        rating,
        source: state.card.source,
        accepted,
        difficultyBucket: state.difficultyBucket,
      });
    },
    [state, feedbackSent, accepted],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-primary" aria-hidden />
            <span>Coach</span>
          </DialogTitle>
          <DialogDescription>
            A short nudge for your next move.
          </DialogDescription>
        </DialogHeader>

        {state.kind === "loading" || state.kind === "idle" ? (
          <div className="flex items-center gap-2 rounded-md border border-border/40 bg-muted/40 px-3 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            <span>Thinking…</span>
          </div>
        ) : null}

        {state.kind === "rate-limited" ? (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
            <div>
              <p className="font-medium">Coach is cooling down.</p>
              <p className="text-muted-foreground">
                You&apos;ve used the coach a lot in a short span. Take a few moments and try again.
              </p>
            </div>
          </div>
        ) : null}

        {state.kind === "error" ? (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium">Couldn&apos;t reach the coach.</p>
              <p className="text-muted-foreground">
                Close this and try again, or keep going on your own.
              </p>
            </div>
          </div>
        ) : null}

        {state.kind === "ready" ? (
          <div className="space-y-3">
            {/* The card itself: tone-coloured border, the message
                + rationale, and (when validated) a Try-this-move
                CTA. */}
            <div
              className={cn(
                "rounded-md border px-3 py-3 text-sm",
                TONE_BORDER[state.card.tone],
              )}
              aria-label={`Coach (${TONE_LABEL[state.card.tone]})`}
            >
              <p className="font-medium leading-snug">{state.card.message}</p>
              <p className="mt-1 text-muted-foreground leading-snug">
                {state.card.rationale}
              </p>
            </div>

            {state.card.suggestion ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden />
                  <span>{VALIDATION_LABEL[state.card.suggestion.validatedBy]}</span>
                </div>
                <Button
                  type="button"
                  className="w-full"
                  onClick={handleApply}
                  disabled={accepted}
                >
                  {accepted
                    ? "Move placed"
                    : `Try ${state.card.suggestion.digit} at row ${
                        Math.floor(state.card.suggestion.cellIndex / 9) + 1
                      }, column ${(state.card.suggestion.cellIndex % 9) + 1}`}
                </Button>
              </div>
            ) : null}

            {/* Source + feedback row. Tiny "AI" / "Solver" tag on
                the left, 👍/👎 on the right. Fits in one line on
                desktop, wraps on phones. */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                {state.card.source === "ai" ? (
                  <Sparkles className="h-3 w-3" aria-hidden />
                ) : (
                  <Brain className="h-3 w-3" aria-hidden />
                )}
                <span>
                  {state.card.source === "ai" ? "AI nudge" : "From the solver"}
                </span>
              </span>

              <span className="inline-flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Helpful"
                  onClick={() => handleFeedback("up")}
                  disabled={feedbackSent != null}
                  className="h-7 w-7"
                >
                  <ThumbsUp
                    className={cn(
                      "h-3.5 w-3.5",
                      feedbackSent === "up" && "text-emerald-600",
                    )}
                  />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Not helpful"
                  onClick={() => handleFeedback("down")}
                  disabled={feedbackSent != null}
                  className="h-7 w-7"
                >
                  <ThumbsDown
                    className={cn(
                      "h-3.5 w-3.5",
                      feedbackSent === "down" && "text-amber-600",
                    )}
                  />
                </Button>
              </span>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
