"use client";

import { useRouter } from "next/navigation";
import { Sparkles, Trophy } from "lucide-react";
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

// Shown automatically when the player completes the puzzle. Submission
// to the server happens in the parent play page via an effect that
// watches `isComplete`; this component is purely presentational.
export function CompletionModal({
  open,
  onOpenChange,
  submitting,
  submitError,
  previousBestMs,
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
}) {
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const mistakes = useGameStore((s) => s.mistakes);
  const hintsUsed = useGameStore((s) => s.hintsUsed);
  const meta = useGameStore((s) => s.meta);
  const router = useRouter();

  if (!meta) return null;

  // A "personal best" for this session means: we have a previous best
  // AND the current solve beat it. We deliberately do not require zero
  // mistakes or hints for v1 - a faster messy solve is still a faster
  // solve. We can tighten this later by adding a `pureOnly` flag.
  const isNewBest =
    previousBestMs !== null && elapsedMs < previousBestMs;
  const deltaMs = previousBestMs !== null ? previousBestMs - elapsedMs : 0;

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
          {meta.mode === "daily" ? (
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
