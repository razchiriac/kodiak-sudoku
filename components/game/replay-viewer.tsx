"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatTime } from "@/lib/utils";
import { boardAt, replayDuration } from "@/lib/sudoku/replay";
import type { InputEvent } from "@/lib/sudoku/input-events";
import { BOARD_SIZE } from "@/lib/sudoku/board";

// RAZ-113: Solve Replay viewer. Shows the completed puzzle playing back
// cell-by-cell at configurable speed with a seekable scrubber.

const SPEEDS = [1, 2, 5, 10] as const;
type Speed = (typeof SPEEDS)[number];

type ReplayViewerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  puzzle: string;
  events: InputEvent[];
  /** Total solve time in ms (from completed_games.time_ms). */
  totalMs: number;
};

export function ReplayViewer({
  open,
  onOpenChange,
  puzzle,
  events,
  totalMs,
}: ReplayViewerProps) {
  const duration = replayDuration(events);
  const effectiveDuration = Math.max(duration, totalMs);

  const [playing, setPlaying] = useState(false);
  const [currentMs, setCurrentMs] = useState(0);
  const [speed, setSpeed] = useState<Speed>(2);

  // rAF-based playback loop.
  const lastFrameRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  const tick = useCallback(
    (timestamp: number) => {
      if (lastFrameRef.current === null) {
        lastFrameRef.current = timestamp;
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const deltaReal = timestamp - lastFrameRef.current;
      lastFrameRef.current = timestamp;
      const deltaGame = deltaReal * speed;

      setCurrentMs((prev) => {
        const next = prev + deltaGame;
        if (next >= effectiveDuration) {
          setPlaying(false);
          return effectiveDuration;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(tick);
    },
    [speed, effectiveDuration],
  );

  useEffect(() => {
    if (playing) {
      lastFrameRef.current = null;
      rafRef.current = requestAnimationFrame(tick);
    } else if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [playing, tick]);

  // Reset when dialog opens.
  useEffect(() => {
    if (open) {
      setCurrentMs(0);
      setPlaying(false);
    }
  }, [open]);

  const frame = boardAt(puzzle, events, currentMs);

  const handlePlayPause = () => {
    if (currentMs >= effectiveDuration) {
      setCurrentMs(0);
      setPlaying(true);
    } else {
      setPlaying((p) => !p);
    }
  };

  const handleScrub = (value: number[]) => {
    const ms = value[0];
    setCurrentMs(ms);
    setPlaying(false);
  };

  // Build a fixed mask from the puzzle string so we can dim clue cells.
  const fixedMask = useRef<Uint8Array>(new Uint8Array(BOARD_SIZE));
  useEffect(() => {
    const mask = new Uint8Array(BOARD_SIZE);
    for (let i = 0; i < BOARD_SIZE; i++) {
      mask[i] = Number(puzzle[i]) !== 0 ? 1 : 0;
    }
    fixedMask.current = mask;
  }, [puzzle]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md flex flex-col max-h-[90vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle>Solve Replay</DialogTitle>
          <DialogDescription>
            Watch your solve play back move by move.
          </DialogDescription>
        </DialogHeader>

        {/* Mini board — read-only, no interaction */}
        <div className="mx-auto aspect-square w-full max-w-[360px]">
          <div
            className="grid h-full w-full"
            style={{
              gridTemplateColumns: "repeat(9, 1fr)",
              gridTemplateRows: "repeat(9, 1fr)",
            }}
            role="img"
            aria-label="Replay board"
          >
            {Array.from({ length: BOARD_SIZE }, (_, i) => {
              const row = Math.floor(i / 9);
              const col = i % 9;
              const digit = frame.board[i];
              const isFixed = fixedMask.current[i] === 1;
              const isActive = frame.activeCell === i;
              return (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-center text-sm font-medium select-none",
                    "border-border/40 border-[0.5px]",
                    // Thicker borders on 3x3 box boundaries.
                    col % 3 === 0 && col !== 0 && "border-l-[1.5px] border-l-foreground/30",
                    row % 3 === 0 && row !== 0 && "border-t-[1.5px] border-t-foreground/30",
                    col === 0 && "border-l-[2px] border-l-foreground/50",
                    col === 8 && "border-r-[2px] border-r-foreground/50",
                    row === 0 && "border-t-[2px] border-t-foreground/50",
                    row === 8 && "border-b-[2px] border-b-foreground/50",
                    // Active cell highlight (pulsing ring).
                    isActive && "bg-primary/20 ring-2 ring-primary/60",
                    // Clue cells are dimmer.
                    isFixed && "text-muted-foreground",
                    !isFixed && digit !== 0 && "text-primary font-semibold",
                  )}
                >
                  {digit !== 0 ? digit : ""}
                </div>
              );
            })}
          </div>
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 pt-2">
          {/* Scrubber */}
          <div className="flex items-center gap-3">
            <span className="w-14 text-right font-mono text-xs tabular-nums text-muted-foreground">
              {formatTime(currentMs)}
            </span>
            <input
              type="range"
              min={0}
              max={effectiveDuration}
              step={100}
              value={currentMs}
              onChange={(e) => handleScrub([Number(e.target.value)])}
              className="flex-1 accent-primary"
              aria-label="Replay progress"
            />
            <span className="w-14 font-mono text-xs tabular-nums text-muted-foreground">
              {formatTime(effectiveDuration)}
            </span>
          </div>

          {/* Play/pause + speed */}
          <div className="flex items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              onClick={handlePlayPause}
              aria-label={playing ? "Pause" : "Play"}
              className="gap-1.5"
            >
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {currentMs >= effectiveDuration ? "Restart" : playing ? "Pause" : "Play"}
            </Button>

            <div className="flex items-center gap-1">
              {SPEEDS.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={speed === s ? "secondary" : "ghost"}
                  onClick={() => setSpeed(s)}
                  className={cn(
                    "h-7 px-2 text-xs font-mono",
                    speed === s && "ring-1 ring-primary",
                  )}
                >
                  {s}×
                </Button>
              ))}
            </div>
          </div>

          {/* Event counter */}
          <p className="text-center text-xs text-muted-foreground">
            Move {frame.eventIndex} of {events.length}
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
