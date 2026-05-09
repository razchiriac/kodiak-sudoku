"use client";

// RAZ-106: Hook that keeps the offline puzzle bank topped up and drains the
// completion queue when the device is online.
//
// Mounted once in app/providers.tsx (when the `offline-play` flag is on).
// On mount and on every `navigator.online` event it:
//   1. Checks which difficulty buckets have fewer than MIN_PER_BUCKET puzzles.
//   2. Fetches fresh puzzles for those buckets from /api/puzzles/offline-bank.
//   3. Upserts them into IndexedDB via puzzle-bank.ts.
//   4. Drains the completion queue via completion-queue.ts.
//
// Background Sync (from the service worker) sends a DRAIN_COMPLETION_QUEUE
// message to the active window; the listener wired in providers.tsx calls
// drainCompletionQueue() in response.

import { useEffect } from "react";
import { countByBucket, upsertPuzzles } from "./puzzle-bank";
import { drainCompletionQueue } from "./completion-queue";

const MIN_PER_BUCKET = 3;
const ALL_BUCKETS = [1, 2, 3, 4];

async function refresh() {
  if (typeof navigator === "undefined" || !navigator.onLine) return;

  // Drain any queued offline completions first.
  await drainCompletionQueue();

  // Top up buckets that are running low.
  const counts = await countByBucket();
  const depleted = ALL_BUCKETS.filter((b) => (counts[b] ?? 0) < MIN_PER_BUCKET);
  if (depleted.length === 0) return;

  try {
    const res = await fetch(
      `/api/puzzles/offline-bank?buckets=${depleted.join(",")}&count=5`,
      { cache: "no-store" },
    );
    if (!res.ok) return;
    const { puzzles } = (await res.json()) as {
      puzzles: {
        id: number;
        puzzle: string;
        solution: string;
        difficultyBucket: number;
        variant: string;
      }[];
    };
    await upsertPuzzles(puzzles);
  } catch {
    // Network error during refresh — silently skip; will retry on next online event.
  }
}

export function usePuzzleBankRefresh(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    // Run immediately, then on every reconnect.
    void refresh();
    window.addEventListener("online", refresh);
    return () => window.removeEventListener("online", refresh);
  }, [enabled]);
}
