"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { track } from "@vercel/analytics";
import { RotateCcw, Share2, Sparkles, Swords, Trophy, Users } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BreakdownPanel } from "@/components/game/breakdown-panel";
import { AiDebriefCard } from "@/components/game/debrief-card";
import { useGameStore } from "@/lib/zustand/game-store";
import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";
import { buildShareBlock, buildShareText, buildShareUrl } from "@/lib/share/format";

// RAZ-78: map of submitCompletionAction error codes to user-facing
// copy. Anything not in the map falls through to "Couldn't save:
// <code>" so a regression doesn't strand us with a blank message.
// Keep the entries short — the modal is a small surface and the
// player has just earned a "Solved!" celebration; we don't want to
// drown that in apology text.
const ERROR_COPY: Record<string, string> = {
  timed_out:
    "Server didn't respond in 30 seconds — your network may be slow. Tap Retry.",
  submit_failed: "Something went wrong recording your time. Tap Retry.",
  schema_invalid: "Couldn't read your completion locally. Tap Retry.",
  unauthenticated: "Please sign in to record this completion.",
  puzzle_not_found: "We couldn't find this puzzle on the server.",
  rate_limited: "Too many submissions in a row. Wait a few seconds and retry.",
};

// Shown automatically when the player completes the puzzle. Submission
// to the server happens in the parent play page via an effect that
// watches `isComplete`; this component is purely presentational.
export function CompletionModal({
  open,
  onOpenChange,
  submitting,
  submitError,
  onRetry,
  previousBestMs,
  shareEnabled = false,
  dailyDate,
  isQuickPlay = false,
  challenge = null,
  challengeLinkEnabled = false,
  currentUsername = null,
  isSignedIn = false,
  rankContext = null,
  breakdownEnabled = false,
  aiDebriefEnabled = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  submitError: string | null;
  // RAZ-78: optional Retry callback. Wired by PlayClient to the
  // shared `runSubmit` so the player can re-attempt a failed
  // submission without leaving the modal. Only rendered when a
  // submitError is set AND we're not currently submitting (so a
  // double-tap on a slow network doesn't spawn parallel requests).
  // Optional so existing callers (no failure paths to retry) stay
  // valid without a code change.
  onRetry?: () => void | Promise<void>;
  // RAZ-22 / pb-ribbon: previous best time (ms) for this user in this
  // difficulty, or null when the flag is off / the user is anonymous /
  // they have no prior completions in this bucket. When non-null AND
  // strictly greater than the current `elapsedMs`, we render the "New
  // best!" ribbon. We keep the conditional inside the modal so the
  // parent can be dumb about flag state.
  previousBestMs: number | null;
  // RAZ-11 / share-result: server-resolved flag value. When false the
  // Share button is suppressed. Kept as a simple boolean so the modal
  // stays dumb about flag internals.
  shareEnabled?: boolean;
  // The daily date for the finished solve (YYYY-MM-DD), forwarded so
  // the share URL can deep-link to /daily/<date>. Unused for random.
  dailyDate?: string;
  // RAZ-34: true when this session was launched via /play/quick. We
  // swap the modal's action buttons so the player can chain another
  // Easy puzzle with a single tap and jump straight to the weekly
  // quick-play leaderboard.
  isQuickPlay?: boolean;
  // RAZ-13: when the player opened this puzzle via `?from=<user>`,
  // the server passes down the sender's best random-mode time. We
  // use it to render a small "you beat / you missed" comparison line
  // in the modal so the challenge has a satisfying resolution.
  challenge?: {
    username: string;
    displayName: string | null;
    bestTimeMs: number;
  } | null;
  // RAZ-13: whether the feature flag is on. Gates BOTH the outgoing
  // "Challenge a friend" action (suppressed when off or when the
  // viewer has no username) AND the incoming-challenge result line.
  challengeLinkEnabled?: boolean;
  // RAZ-13: current viewer's username, needed to build the share URL
  // `/play/<id>?from=<username>`. Null when anonymous or when the
  // signed-in user has never set a username — the action is hidden.
  currentUsername?: string | null;
  // RAZ-86: auth context for share-funnel analytics.
  isSignedIn?: boolean;
  // RAZ-32: rank context returned by `submitCompletionAction` for a
  // successful daily submit. Drives the "You beat X% of today's
  // solvers" banner. Null for random mode, archive completions,
  // anonymous users, or when the `daily-compare` flag is off.
  rankContext?: { total: number; slower: number; percentile: number } | null;
  // RAZ-45: server-resolved value of `post-game-breakdown`. When on,
  // we render the BreakdownPanel below the existing stat grid. The
  // panel itself is purely client-computed from the same Zustand
  // state already in scope here, so this prop is a simple show/hide
  // gate — no network round trip, no extra server payload.
  breakdownEnabled?: boolean;
  // RAZ-61: server-resolved value of `ai-debrief`. When on, we
  // render the AiDebriefCard beneath the BreakdownPanel. The card
  // fires a server action ONCE per `cacheKey` (built from puzzle id
  // + attempt id) and persists the result to localStorage so a
  // refresh / reopen doesn't burn another OpenAI call.
  aiDebriefEnabled?: boolean;
}) {
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const mistakes = useGameStore((s) => s.mistakes);
  const hintsUsed = useGameStore((s) => s.hintsUsed);
  const meta = useGameStore((s) => s.meta);
  // RAZ-61: stable per-completion id from RAZ-81. Used to build the
  // localStorage cache key so a refresh / reopen of the modal
  // doesn't re-fire the (paid) AI debrief generation action.
  const attemptId = useGameStore((s) => s.attemptId);
  const router = useRouter();
  const [sharing, setSharing] = useState(false);
  const telemetryContext = useMemo(
    () =>
      ({
        mode: meta?.mode ?? "random",
        difficulty_bucket: meta?.difficultyBucket ?? 0,
        hint_band: toCountBand(hintsUsed),
        mistake_band: toCountBand(mistakes),
        auth_state: isSignedIn ? "signed-in" : "anonymous",
      }) as const,
    [hintsUsed, isSignedIn, meta?.difficultyBucket, meta?.mode, mistakes],
  );

  useEffect(() => {
    if (!open || !meta) return;
    safeTrack("completion_modal_shown", telemetryContext);
  }, [meta, open, telemetryContext]);

  if (!meta) return null;

  // RAZ-11 share handler. We try navigator.share first (iOS / Android
  // pop the native sheet which is WAY better UX than a toast). If the
  // Web Share API isn't available OR the user cancels / it throws, we
  // fall back to copying the whole block to the clipboard and toasting.
  // Wrapped in a handler instead of inlined so the JSX stays flat.
  async function handleShare() {
    if (!meta) return;
    setSharing(true);
    safeTrack("completion_share_clicked", {
      ...telemetryContext,
      surface: "result",
    });
    try {
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const shareInput = {
        mode: meta.mode,
        difficultyBucket: meta.difficultyBucket,
        elapsedMs,
        mistakes,
        hintsUsed,
        dailyDate,
        puzzleId: meta.puzzleId,
        today:
          typeof window !== "undefined"
            ? new Date().toISOString().slice(0, 10)
            : undefined,
      } as const;
      const text = buildShareText(shareInput);
      const urlStr = buildShareUrl(shareInput, { baseUrl });
      // navigator.share is feature-detected. On desktop browsers that
      // DON'T expose it we skip straight to clipboard. canShare is also
      // checked because some browsers expose share() but reject the
      // payload (e.g. Firefox desktop at time of writing).
      const nav = navigator as Navigator & {
        share?: (data: { text?: string; url?: string; title?: string }) => Promise<void>;
        canShare?: (data: { text?: string; url?: string; title?: string }) => boolean;
      };
      const payload = { title: "Sudoku", text, url: urlStr };
      if (nav.share && (!nav.canShare || nav.canShare(payload))) {
        try {
          await nav.share(payload);
          safeTrack("completion_share_native_success", {
            ...telemetryContext,
            surface: "result",
          });
          toast.success("Shared from your device");
          return;
        } catch (err) {
          // AbortError: user cancelled the sheet. Don't fall through
          // to clipboard — they explicitly backed out.
          if (err instanceof Error && err.name === "AbortError") return;
          // Any other error (e.g. NotAllowedError): fall through to
          // clipboard.
        }
      }
      const block = buildShareBlock(shareInput, { baseUrl });
      await navigator.clipboard.writeText(block);
      safeTrack("completion_share_clipboard_success", {
        ...telemetryContext,
        surface: "result",
      });
      toast.success("Result copied to clipboard");
    } catch {
      safeTrack("completion_share_clipboard_failure", {
        ...telemetryContext,
        surface: "result",
      });
      toast.error("Couldn't share. Try again?");
    } finally {
      setSharing(false);
    }
  }

  // A "personal best" for this session means: we have a previous best
  // AND the current solve beat it. We deliberately do not require zero
  // mistakes or hints for v1 - a faster messy solve is still a faster
  // solve. We can tighten this later by adding a `pureOnly` flag.
  const isNewBest =
    previousBestMs !== null && elapsedMs < previousBestMs;
  const deltaMs = previousBestMs !== null ? previousBestMs - elapsedMs : 0;

  // RAZ-13 challenge share handler. Copies a bare
  // `/play/<id>?from=<username>` URL to the clipboard — shorter and
  // more obviously "play this puzzle" than the RAZ-11 share block.
  // We don't emit social stats here because the whole point is that
  // the recipient plays fresh; the sender's time arrives as a server-
  // rendered banner, not as a query param the receiver could fake.
  async function handleChallenge() {
    if (!meta || !currentUsername) return;
    safeTrack("completion_challenge_clicked", telemetryContext);
    try {
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const url = `${baseUrl}/play/${meta.puzzleId}?from=${encodeURIComponent(
        currentUsername,
      )}&utm_source=sudoku_app&utm_medium=share&utm_campaign=challenge_share&utm_content=completion_modal`;
      const nav = navigator as Navigator & {
        share?: (data: { text?: string; url?: string; title?: string }) => Promise<void>;
        canShare?: (data: { text?: string; url?: string; title?: string }) => boolean;
      };
      const payload = {
        title: "Sudoku challenge",
        text: `Beat my time on this Sudoku puzzle: ${formatTime(elapsedMs)}`,
        url,
      };
      if (nav.share && (!nav.canShare || nav.canShare(payload))) {
        try {
          await nav.share(payload);
          safeTrack("completion_challenge_native_success", telemetryContext);
          toast.success("Challenge sent");
          return;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      safeTrack("completion_challenge_clipboard_success", telemetryContext);
      toast.success("Challenge link copied");
    } catch {
      safeTrack("completion_challenge_failure", telemetryContext);
      toast.error("Couldn't copy link. Try again?");
    }
  }

  // Show the challenge action when the flag is on, the viewer has a
  // username (no username = no meaningful `?from=` param), and we're
  // in a random puzzle where the URL has a stable puzzleId. Daily
  // mode is excluded because `/daily` rotates; a recipient clicking
  // the link tomorrow would get a different puzzle.
  const showChallengeAction =
    challengeLinkEnabled &&
    !!currentUsername &&
    meta.mode === "random";

  // Post-solve comparison for an incoming challenge. Positive delta =
  // the viewer beat the sender (we render "-M:SS vs @user"); negative
  // delta = the viewer lost ("+M:SS vs @user"). A tie renders as
  // "matched @user's time".
  const challengeDeltaMs = challenge ? challenge.bestTimeMs - elapsedMs : 0;
  const challengeName = challenge
    ? challenge.displayName ?? challenge.username
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Trophy className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-2xl">Solved!</DialogTitle>
          <DialogDescription className="text-center">
            {meta.mode === "daily"
              ? "Daily puzzle complete. Your time has been submitted to the leaderboard."
              : `${DIFFICULTY_LABEL[meta.difficultyBucket]} puzzle complete.`}
          </DialogDescription>
        </DialogHeader>

        {isNewBest && (
          <div
            className="mx-auto flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary"
            role="status"
            aria-live="polite"
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            <span>
              New personal best! -{formatTime(deltaMs)} vs {formatTime(previousBestMs!)}
            </span>
          </div>
        )}

        {/* RAZ-32: "You beat X% of today's solvers" for daily mode.
            Shown only when the server returned a rank context with
            at least one solver (ourselves). Total-of-one is
            intentionally suppressed: "you beat 0% (0 of 1)" is a
            buzzkill and not socially useful. */}
        {rankContext && rankContext.total > 1 ? (
          <div
            className="mx-auto flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm"
            role="status"
            aria-live="polite"
          >
            <Users className="h-4 w-4 text-primary" aria-hidden />
            <span>
              You beat{" "}
              <span className="font-semibold">{rankContext.percentile}%</span>{" "}
              of today&apos;s solvers (
              <span className="font-mono tabular-nums">
                {rankContext.slower} of {rankContext.total}
              </span>
              )
            </span>
          </div>
        ) : null}

        {/* RAZ-13: resolution line for an incoming challenge. Only
            rendered when the flag is on AND the page received a
            challenge payload. Three cases: beat them, tied, lost. */}
        {challengeLinkEnabled && challenge ? (
          <div
            className="mx-auto flex items-center gap-2 rounded-full border border-primary/30 bg-primary/5 px-4 py-1.5 text-sm"
            role="status"
            aria-live="polite"
          >
            <Swords className="h-4 w-4 text-primary" aria-hidden />
            <span>
              {challengeDeltaMs > 0 ? (
                <>
                  You beat{" "}
                  <span className="font-semibold">@{challengeName}</span> by{" "}
                  <span className="font-mono tabular-nums">
                    {formatTime(challengeDeltaMs)}
                  </span>
                </>
              ) : challengeDeltaMs === 0 ? (
                <>
                  Matched{" "}
                  <span className="font-semibold">@{challengeName}</span>&apos;s
                  time
                </>
              ) : (
                <>
                  <span className="font-semibold">@{challengeName}</span> was
                  faster by{" "}
                  <span className="font-mono tabular-nums">
                    {formatTime(-challengeDeltaMs)}
                  </span>
                </>
              )}
            </span>
          </div>
        ) : null}

        <dl className="grid grid-cols-3 gap-4 py-2 text-center">
          <Stat label="Time" value={formatTime(elapsedMs)} />
          <Stat label="Mistakes" value={mistakes.toString()} />
          <Stat label="Hints" value={hintsUsed.toString()} />
        </dl>

        {/* RAZ-45 Post-Game Breakdown panel. Rendered below the stat
            grid so the player sees raw numbers FIRST and then the
            interpretive narrative. Hidden when the flag is off; if
            the compute throws (which it shouldn't on real input),
            BreakdownPanel returns null and the rest of the modal
            keeps rendering normally. */}
        {breakdownEnabled ? (
          <BreakdownPanel
            elapsedMs={elapsedMs}
            mistakes={mistakes}
            hintsUsed={hintsUsed}
            difficultyBucket={meta.difficultyBucket}
          />
        ) : null}

        {/* RAZ-61 AI debrief card. Sits beneath the deterministic
            breakdown so the player sees the numerical buckets first
            and the AI prose second. Gated by both:
              - `aiDebriefEnabled` (Edge Config flag), AND
              - the modal `open` state — we don't want to fire the
                action until the player has actually opened the
                modal. The CompletionModal mounts on every game so
                a render-while-closed would burn API budget for no
                visible result.
            We also gate on `attemptId` so a stale snapshot without
            an attempt id doesn't accidentally reuse another run's
            cached debrief — better to skip the card entirely than
            mislabel data. */}
        {aiDebriefEnabled && open && attemptId ? (
          <AiDebriefCard
            cacheKey={`${meta.mode}:${meta.puzzleId}:${attemptId}`}
            input={{
              elapsedMs,
              mistakes,
              hintsUsed,
              difficultyBucket: meta.difficultyBucket,
              // Map the modal's mode discriminator to the action's
              // enum. CompletionModal already knows whether we're
              // in quick-play; daily / random fall through.
              mode: isQuickPlay
                ? "quick"
                : meta.mode === "daily"
                  ? "daily"
                  : challenge
                    ? "challenge"
                    : "random",
              previousBestMs,
              personalBestImproved:
                previousBestMs !== null && elapsedMs < previousBestMs,
            }}
          />
        ) : null}

        {submitError && (
          // RAZ-78: friendlier error copy than the raw error code
          // we used to render. The raw codes (e.g. "schema_invalid",
          // "timed_out") were for debugging, not for end users.
          // Map the small set we actually surface to plain English
          // and fall back to the raw code for anything unexpected.
          <div className="space-y-2">
            <p className="text-center text-sm text-destructive">
              {ERROR_COPY[submitError] ?? `Couldn't save: ${submitError}`}
            </p>
            {/* Retry button — only when we have a handler AND we're
                not already mid-submit. Prevents the player from
                kicking off a parallel request by tapping during a
                pending retry. */}
            {onRetry && !submitting ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void onRetry()}
                  aria-label="Retry recording your completion"
                >
                  <RotateCcw className="mr-2 h-4 w-4" aria-hidden />
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        )}
        {submitting && (
          <p className="text-center text-sm text-muted-foreground">Saving your time...</p>
        )}

        <DialogFooter className="sm:justify-center">
          {shareEnabled ? (
            <Button
              variant="outline"
              onClick={handleShare}
              disabled={sharing}
              aria-label="Share your result"
            >
              <Share2 className="mr-2 h-4 w-4" aria-hidden />
              {meta.mode === "daily" ? "Share daily result" : "Share result"}
            </Button>
          ) : null}
          {/* RAZ-13: "Challenge a friend" copies a clean
              /play/<id>?from=<username> link. Rendered beside Share
              so players have a clear social-loop menu: broadcast
              (Share) vs 1:1 (Challenge). */}
          {showChallengeAction ? (
            <Button
              variant="outline"
              onClick={handleChallenge}
              aria-label="Challenge a friend to beat your time"
            >
              <Swords className="mr-2 h-4 w-4" aria-hidden />
              Challenge a friend
            </Button>
          ) : null}
          {/* RAZ-34: in quick-play we override both the primary CTA
              (loops back to /play/quick for a fresh random Easy) and
              expose a dedicated link to the weekly quick leaderboard.
              Daily mode keeps its original leaderboard-only footer. */}
          {isQuickPlay ? (
            <>
              <Button
                variant="outline"
                onClick={() => router.push("/leaderboard/quick")}
              >
                Weekly board
              </Button>
              <Button onClick={() => router.push("/play/quick")}>
                Next puzzle
              </Button>
            </>
          ) : meta.mode === "daily" ? (
            <Button onClick={() => router.push("/leaderboard")}>View leaderboard</Button>
          ) : (
            <Button onClick={() => router.push("/play")}>New puzzle</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-lg tabular-nums">{value}</dd>
    </div>
  );
}

function toCountBand(value: number): "0" | "1-2" | "3-5" | "6+" {
  if (value <= 0) return "0";
  if (value <= 2) return "1-2";
  if (value <= 5) return "3-5";
  return "6+";
}

function safeTrack(name: string, properties: Record<string, string | number>) {
  try {
    track(name, properties);
  } catch {
    // Tracking failures should never block gameplay or share actions.
  }
}
