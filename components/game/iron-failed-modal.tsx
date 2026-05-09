"use client";

import { useRouter } from "next/navigation";
import { Swords } from "lucide-react";
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
import { formatTime } from "@/lib/utils";

// RAZ-112: modal shown when an Iron Mode run ends due to a wrong
// placement. Displays the failed cell, progress percentage, and
// elapsed time. Offers "Try Again" (reloads the page for a fresh
// puzzle) and a dismiss action.

export function IronFailedModal() {
  const router = useRouter();
  const ironFailed = useGameStore((s) => s.ironFailed);
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const meta = useGameStore((s) => s.meta);
  const fixed = useGameStore((s) => s.fixed);

  if (!ironFailed || !meta) return null;

  // Total empty cells the player needed to fill (non-fixed cells).
  let totalToFill = 0;
  for (let i = 0; i < 81; i++) {
    if (!fixed[i]) totalToFill++;
  }
  const progressPct =
    totalToFill > 0
      ? Math.round((ironFailed.filledCount / totalToFill) * 100)
      : 0;

  const failRow = Math.floor(ironFailed.cell / 9) + 1;
  const failCol = (ironFailed.cell % 9) + 1;

  return (
    <Dialog open onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-sm"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-destructive" />
            Run Ended
          </DialogTitle>
          <DialogDescription>
            Iron Mode — one wrong move, and it&apos;s over.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col rounded-md border bg-muted/30 p-3">
              <span className="text-xs text-muted-foreground">
                Failed at
              </span>
              <span className="font-mono text-lg font-semibold">
                R{failRow}C{failCol}
              </span>
            </div>
            <div className="flex flex-col rounded-md border bg-muted/30 p-3">
              <span className="text-xs text-muted-foreground">
                Progress
              </span>
              <span className="font-mono text-lg font-semibold">
                {progressPct}%
              </span>
            </div>
            <div className="flex flex-col rounded-md border bg-muted/30 p-3 col-span-2">
              <span className="text-xs text-muted-foreground">
                Time
              </span>
              <span className="font-mono text-lg font-semibold tabular-nums">
                {formatTime(elapsedMs)}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button
            className="w-full"
            onClick={() => router.push("/play")}
          >
            Try Again
          </Button>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => router.push("/")}
          >
            Back to Home
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
