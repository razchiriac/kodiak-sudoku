"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Share2, Sparkles, Swords, Trophy } from "lucide-react";
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
import { useGameStore } from "@/lib/zustand/game-store";
import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";
import { buildShareBlock, buildShareText, buildShareUrl } from "@/lib/share/format";

// Shown automatically when the player completes the puzzle. Submission
// to the server happens in the parent play page via an effect that
// watches `isComplete`; this component is purely presentational.
export function CompletionModal({
  open,
  onOpenChange,
  submitting,
  submitError,
  previousBestMs,
  shareEnabled = false,
  dailyDate,
  isQuickPlay = false,
  challenge = null,
  challengeLinkEnabled = false,
  currentUsername = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  submitting: boolean;
  submitError: string | null;
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
}) {
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const mistakes = useGameStore((s) => s.mistakes);
  const hintsUsed = useGameStore((s) => s.hintsUsed);
  const meta = useGameStore((s) => s.meta);
  const router = useRouter();
  const [sharing, setSharing] = useState(false);

  if (!meta) return null;

  // RAZ-11 share handler. We try navigator.share first (iOS / Android
  // pop the native sheet which is WAY better UX than a toast). If the
  // Web Share API isn't available OR the user cancels / it throws, we
  // fall back to copying the whole block to the clipboard and toasting.
  // Wrapped in a handler instead of inlined so the JSX stays flat.
  async function handleShare() {
    if (!meta) return;
    setSharing(true);
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
      toast.success("Copied to clipboard");
    } catch {
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
    try {
      const baseUrl =
        typeof window !== "undefined" ? window.location.origin : "";
      const url = `${baseUrl}/play/${meta.puzzleId}?from=${encodeURIComponent(
        currentUsername,
      )}`;
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
          return;
        } catch (err) {
          if (err instanceof Error && err.name === "AbortError") return;
        }
      }
      await navigator.clipboard.writeText(url);
      toast.success("Challenge link copied");
    } catch {
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

        {submitError && (
          <p className="text-center text-sm text-destructive">{submitError}</p>
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
              Share
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
              Challenge
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
