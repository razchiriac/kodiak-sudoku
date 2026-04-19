"use client";

import { useEffect } from "react";
import { Pause, Play } from "lucide-react";
import { useGameStore } from "@/lib/zustand/game-store";
import { Button } from "@/components/ui/button";
import { formatTime } from "@/lib/utils";

// Timer display + pause control. We use a 1Hz interval (not rAF) because
// the render cost dominates wall-clock precision: nobody cares about
// sub-second display.
export function Timer() {
  const elapsedMs = useGameStore((s) => s.elapsedMs);
  const isPaused = useGameStore((s) => s.isPaused);
  const isComplete = useGameStore((s) => s.isComplete);
  const meta = useGameStore((s) => s.meta);
  const tick = useGameStore((s) => s.tick);
  const togglePause = useGameStore((s) => s.togglePause);

  // Tick once a second. Pausing/completion gates the increment inside
  // tick() itself so we never overshoot when the game ends mid-interval.
  useEffect(() => {
    if (!meta) return;
    const id = window.setInterval(() => tick(1000), 1000);
    return () => window.clearInterval(id);
  }, [meta, tick]);

  // Pause when the tab is hidden; this prevents the timer from counting
  // while the user has stepped away. Re-render doesn't matter because the
  // tick handler reads isPaused from the store at call time.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden && !isPaused && !isComplete && meta) togglePause();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isPaused, isComplete, meta, togglePause]);

  return (
    <div className="flex items-center gap-2">
      <span
        className="font-mono text-lg tabular-nums"
        aria-live="off"
        aria-label={`elapsed time ${formatTime(elapsedMs)}`}
      >
        {formatTime(elapsedMs)}
      </span>
      <Button
        size="icon"
        variant="ghost"
        onClick={togglePause}
        disabled={isComplete}
        aria-label={isPaused ? "Resume" : "Pause"}
      >
        {isPaused ? <Play /> : <Pause />}
      </Button>
    </div>
  );
}
