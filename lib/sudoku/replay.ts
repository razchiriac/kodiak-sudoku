// RAZ-113: Solve Replay engine. Pure-functional replay controller that
// takes a flat list of InputEvents (stitched from puzzle_attempts rows)
// and reconstructs the board state at any point in time. Used by the
// ReplayViewer component for playback and scrubbing.
//
// Framework-free — no React, no store. The viewer component owns the
// animation loop and calls `boardAt(ms)` on each frame.

import type { InputEvent } from "./input-events";
import { BOARD_SIZE, parseBoard, type Board } from "./board";

export type ReplayFrame = {
  board: Board;
  /** Index of the cell that was just placed/erased, or null at t=0. */
  activeCell: number | null;
  /** How many events have been applied up to this point. */
  eventIndex: number;
};

/**
 * Given the original puzzle string and a sorted list of input events,
 * reconstruct the board state at `targetMs`. Events are applied in
 * order up to (and including) the last event whose `t <= targetMs`.
 *
 * Performance: iterates the event list linearly from the start. For a
 * typical 200-event solve this takes <0.1ms so there's no need for
 * binary search or caching. If profiling shows this is hot on 10x
 * playback, we can add a frame cache keyed on event index.
 */
export function boardAt(
  puzzle: string,
  events: readonly InputEvent[],
  targetMs: number,
): ReplayFrame {
  const board = parseBoard(puzzle);
  let activeCell: number | null = null;
  let eventIndex = 0;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (ev.t > targetMs) break;
    applyEvent(board, ev);
    activeCell = ev.c;
    eventIndex = i + 1;
  }

  return { board, activeCell, eventIndex };
}

/**
 * Apply a single event to a mutable board. Erase events (d=0) clear
 * the cell; value/hint events set the digit. We skip hint events
 * during replay display as an option, but by default we apply them
 * so the board reaches the solved state.
 */
function applyEvent(board: Board, ev: InputEvent): void {
  if (ev.c < 0 || ev.c >= BOARD_SIZE) return;
  board[ev.c] = ev.d;
}

/**
 * Stitch multiple puzzle_attempts batches into a single sorted event
 * list. Each batch has a `seq` number and an `events` array. We sort
 * by seq first, then concatenate, then sort the combined list by `t`
 * (timestamp) for safety — the client should already emit events in
 * order, but a clock glitch or buffer overflow could produce slightly
 * out-of-order timestamps across batches.
 */
export function stitchBatches(
  batches: readonly { seq: number; events: InputEvent[] }[],
): InputEvent[] {
  const sorted = [...batches].sort((a, b) => a.seq - b.seq);
  const all: InputEvent[] = [];
  for (const batch of sorted) {
    all.push(...batch.events);
  }
  // Stable sort by timestamp within the stitched stream.
  all.sort((a, b) => a.t - b.t);
  return all;
}

/**
 * Total duration of a replay in ms. Returns the timestamp of the last
 * event, or 0 if the event list is empty.
 */
export function replayDuration(events: readonly InputEvent[]): number {
  if (events.length === 0) return 0;
  return events[events.length - 1].t;
}
