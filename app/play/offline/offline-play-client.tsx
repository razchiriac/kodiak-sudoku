"use client";

// RAZ-106: Client component for offline play. Claims a puzzle from the
// IndexedDB bank on mount and renders PlayClient with isOffline=true.

import { useEffect, useState } from "react";
import { claimPuzzle, type OfflinePuzzle } from "@/lib/offline/puzzle-bank";
import { PlayClient } from "@/app/play/[puzzleId]/play-client";
import { Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type Props = {
  bucket: number;
  isSignedIn: boolean;
  hapticsEnabled: boolean;
  autoSwitchDigitEnabled: boolean;
  autoPauseEnabled: boolean;
  shareEnabled: boolean;
  compactControlsEnabled: boolean;
  longPressNoteEnabled: boolean;
  jumpOnPlaceEnabled: boolean;
  showMistakesEnabled: boolean;
  breakdownEnabled: boolean;
  stuckRescueEnabled: boolean;
  adaptiveCoachEnabled: boolean;
  modePresetsEnabled: boolean;
  progressiveHintsEnabled: boolean;
};

type State =
  | { status: "loading" }
  | { status: "ready"; puzzle: OfflinePuzzle }
  | { status: "empty" };

export function OfflinePlayClient({
  bucket,
  isSignedIn,
  hapticsEnabled,
  autoSwitchDigitEnabled,
  autoPauseEnabled,
  shareEnabled,
  compactControlsEnabled,
  longPressNoteEnabled,
  jumpOnPlaceEnabled,
  showMistakesEnabled,
  breakdownEnabled,
  stuckRescueEnabled,
  adaptiveCoachEnabled,
  modePresetsEnabled,
  progressiveHintsEnabled,
}: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    claimPuzzle(bucket).then((puzzle) => {
      setState(puzzle ? { status: "ready", puzzle } : { status: "empty" });
    });
  }, [bucket]);

  if (state.status === "loading") {
    return (
      <div className="container flex max-w-3xl items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading offline puzzle…</p>
      </div>
    );
  }

  if (state.status === "empty") {
    return (
      <div className="container flex max-w-3xl flex-col items-center gap-6 py-20 text-center">
        <Wifi className="h-12 w-12 text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">No offline puzzles available</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Connect to the internet and return to the home screen to download
            puzzles for offline play.
          </p>
        </div>
        <Button asChild>
          <Link href="/play">Go home</Link>
        </Button>
      </div>
    );
  }

  const { puzzle } = state;

  return (
    <PlayClient
      puzzle={{
        id: puzzle.id,
        puzzle: puzzle.puzzle.trim(),
        solution: puzzle.solution.trim(),
        difficultyBucket: puzzle.difficultyBucket,
        variant: puzzle.variant ?? "standard",
      }}
      savedGame={null}
      isSignedIn={isSignedIn}
      mode="random"
      previousBestMs={null}
      isOffline={true}
      hapticsEnabled={hapticsEnabled}
      autoSwitchDigitEnabled={autoSwitchDigitEnabled}
      autoPauseEnabled={autoPauseEnabled}
      shareEnabled={shareEnabled}
      compactControlsEnabled={compactControlsEnabled}
      longPressNoteEnabled={longPressNoteEnabled}
      jumpOnPlaceEnabled={jumpOnPlaceEnabled}
      showMistakesEnabled={showMistakesEnabled}
      breakdownEnabled={breakdownEnabled}
      stuckRescueEnabled={stuckRescueEnabled}
      adaptiveCoachEnabled={adaptiveCoachEnabled}
      modePresetsEnabled={modePresetsEnabled}
      progressiveHintsEnabled={progressiveHintsEnabled}
    />
  );
}
