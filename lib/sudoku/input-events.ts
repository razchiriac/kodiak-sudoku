// RAZ-28 — Compact input-event log for replays + anti-cheat.
//
// One entry per user-driven board mutation. The schema is deliberately
// terse because these entries get serialized into jsonb on the server
// side and a busy attempt can emit several hundred events; shaving
// bytes here keeps row sizes comfortable and bandwidth low.
//
// Field meanings (single-letter keys on purpose):
//   c — cell index (0..80, row-major)
//   d — digit placed (1..9 for value placement, 0 for erase)
//   t — milliseconds from game start (monotonic-ish: tied to the
//       store's `elapsedMs` so paused time doesn't count)
//   k — kind of event:
//         "v" = user placed a value (inputDigit, value mode)
//         "e" = user erased a cell (eraseSelection)
//         "h" = system-applied hint placement (RAZ-14 tier-3 reveal
//               or legacy one-shot reveal). Logged so anti-cheat
//               analysis can exclude hint-driven placements from
//               "did the user solve it themselves" signals.
//
// Notes (pencil marks) are intentionally NOT logged in v1. They're
// noisy, don't change board truth, and the anti-cheat signal we care
// about is "pattern of value placements vs. time". Ticket explicitly
// scopes the buffer to "one event per placement".

export type InputEventKind = "v" | "e" | "h";

export type InputEvent = {
  c: number; // cell index 0..80
  d: number; // digit 0..9 (0 for erase)
  t: number; // ms from game start (pause-exclusive)
  k: InputEventKind;
};

// Ring-buffer cap. A typical Expert solve runs ~200 placements plus
// some undo/redo; 1024 gives us ~5x headroom while keeping worst-case
// payload under ~50 KB (plenty for jsonb). When the buffer overflows
// we drop the OLDEST entries — recent events are more useful for both
// replay tails and anti-cheat rate heuristics than the session start.
export const EVENT_BUFFER_CAP = 1024;

// Append an event with FIFO eviction. Returns a NEW array (the store
// treats the buffer as immutable for React reactivity purposes, so we
// never mutate in place). Callers should replace the buffer reference
// on every append.
export function appendEvent(
  events: readonly InputEvent[],
  entry: InputEvent,
): InputEvent[] {
  if (events.length < EVENT_BUFFER_CAP) {
    return [...events, entry];
  }
  // Overflow: drop the single oldest. Shifting + pushing on an immutable
  // copy is O(n) but n<=1024 so it's still <50µs; not worth a real
  // ring-buffer data structure for a once-per-placement path.
  return [...events.slice(1), entry];
}

// Tiny wrapper around the payload we push to puzzle_attempts. The
// server-side insert pipes this straight into `payload` (jsonb). Having
// a dedicated type keeps the wire shape greppable.
export type InputEventPayload = {
  // Sequence number within this attempt, 0-based. Lets the server
  // (or later: the replay renderer) order multiple flushed rows for
  // the same puzzle in the right sequence without relying on clock
  // skew in `created_at`.
  seq: number;
  // `true` when this flush represents the moment of puzzle
  // completion. Useful as an end-of-attempt marker during replay.
  completed: boolean;
  // Contiguous event batch. May be empty on a completion-marker flush
  // if the player hadn't made any moves since the last save.
  events: InputEvent[];
};
