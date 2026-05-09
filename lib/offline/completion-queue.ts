// RAZ-106: IndexedDB completion queue for offline gameplay.
//
// When a puzzle is completed while offline, the submit args are stored here
// instead of being sent to `submitCompletionAction` directly. The queue is
// drained as soon as the device reconnects (via the `online` event in
// use-puzzle-bank-refresh, or via Background Sync triggered by the service
// worker).
//
// DB name  : "sudoku-offline"
// Store    : "completion-queue"  (keyPath: "queuedAt")
//
// The existing `attemptId` idempotency token (RAZ-81) on `completed_games`
// deduplicates any race where the queue is drained more than once — a drain
// that finds an already-inserted row just falls through silently.

import type { SubmitInput } from "@/lib/server/actions";

const DB_NAME = "sudoku-offline";
const DB_VERSION = 1;
const STORE = "completion-queue";

type QueueEntry = SubmitInput & { queuedAt: number };

// ─── Internal helpers ────────────────────────────────────────────────────────

function isAvailable(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        // keyPath "queuedAt" gives each entry a unique timestamp key.
        db.createObjectStore(STORE, { keyPath: "queuedAt" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Add a completion to the queue for later submission.
 * Called from /play/offline when the puzzle is solved and the device is offline.
 */
export async function enqueueCompletion(args: SubmitInput): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDB();
    const entry: QueueEntry = { ...args, queuedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const req = db
        .transaction(STORE, "readwrite")
        .objectStore(STORE)
        .put(entry);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Fail silently — we at least recorded the game locally in Zustand/localStorage.
    console.error("[offline] failed to enqueue completion");
  }
}

/**
 * Drain the queue by calling submitCompletionAction for each pending entry.
 * Removes successfully submitted entries. Leaves failed entries for the next
 * drain attempt. Safe to call concurrently — each entry has a unique key.
 */
export async function drainCompletionQueue(): Promise<void> {
  if (!isAvailable()) return;
  try {
    const db = await openDB();
    const entries = await new Promise<QueueEntry[]>((resolve, reject) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as QueueEntry[]);
      req.onerror = () => reject(req.error);
    });

    if (entries.length === 0) return;

    // Lazy import: submitCompletionAction is a Server Action (server-only).
    // We import dynamically so this file can be bundled for the client
    // without pulling in server-only code at module-eval time. The import
    // resolves fine in a browser context because Next.js replaces Server
    // Action bodies with RPC stubs in the client bundle.
    const { submitCompletionAction } = await import("@/lib/server/actions");

    for (const entry of entries) {
      const { queuedAt, ...submitArgs } = entry;
      try {
        const result = await submitCompletionAction(submitArgs);
        // Accept both ok:true and already_completed_today (idempotent replay).
        if (result.ok || result.error === "already_completed_today") {
          await new Promise<void>((resolve, reject) => {
            const req = db
              .transaction(STORE, "readwrite")
              .objectStore(STORE)
              .delete(queuedAt);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          });
        }
      } catch {
        // Network still down or server error — leave the entry for the next drain.
      }
    }
  } catch {
    // IDB unavailable or unexpected error — nothing to do.
  }
}
