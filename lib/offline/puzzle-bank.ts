// RAZ-106: IndexedDB puzzle bank for offline gameplay.
//
// Stores a small cache of random puzzles fetched from /api/puzzles/offline-bank
// so the player can start new games without a network connection.
//
// DB name  : "sudoku-offline"
// Store    : "puzzles"  (keyPath: "id")
//
// All functions are safe to call in SSR context — they check for `indexedDB`
// availability and return graceful empty results when it is absent (private
// browsing, old browsers, server-side render).

const DB_NAME = "sudoku-offline";
const DB_VERSION = 1;
const STORE = "puzzles";

export type OfflinePuzzle = {
  id: number;
  puzzle: string;
  solution: string;
  difficultyBucket: number;
  variant: string;
  cachedAt: number; // Date.now() ms
};

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
        // keyPath "id" matches the puzzle's numeric primary key.
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(
  db: IDBDatabase,
  mode: IDBTransactionMode,
): IDBObjectStore {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Return all puzzles currently in the bank. */
export async function getPuzzleBank(): Promise<OfflinePuzzle[]> {
  if (!isAvailable()) return [];
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = tx(db, "readonly").getAll();
      req.onsuccess = () => resolve(req.result as OfflinePuzzle[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/** Upsert puzzles into the bank (add or overwrite by id). */
export async function upsertPuzzles(newPuzzles: Omit<OfflinePuzzle, "cachedAt">[]): Promise<void> {
  if (!isAvailable() || newPuzzles.length === 0) return;
  try {
    const db = await openDB();
    const store = tx(db, "readwrite");
    const now = Date.now();
    await Promise.all(
      newPuzzles.map(
        (p) =>
          new Promise<void>((resolve, reject) => {
            const req = store.put({ ...p, cachedAt: now });
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
          }),
      ),
    );
  } catch {
    // Fail silently — the offline bank is best-effort.
  }
}

/**
 * Claim one puzzle from the given difficulty bucket.
 * The puzzle is deleted from the bank so it isn't served twice.
 * Returns null if no puzzle is available for the requested bucket.
 */
export async function claimPuzzle(bucket: number): Promise<OfflinePuzzle | null> {
  if (!isAvailable()) return null;
  try {
    const db = await openDB();
    // Fetch all and pick the first matching bucket. IndexedDB doesn't support
    // compound queries without an index; our bank is small (≤40 rows) so a
    // getAll + filter is fine.
    const all = await new Promise<OfflinePuzzle[]>((resolve, reject) => {
      const req = tx(db, "readonly").getAll();
      req.onsuccess = () => resolve(req.result as OfflinePuzzle[]);
      req.onerror = () => reject(req.error);
    });

    const match = all.find((p) => p.difficultyBucket === bucket);
    if (!match) return null;

    // Delete the claimed puzzle so it isn't reused.
    await new Promise<void>((resolve, reject) => {
      const req = tx(db, "readwrite").delete(match.id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });

    return match;
  } catch {
    return null;
  }
}

/**
 * Returns the count of banked puzzles per difficulty bucket.
 * Used by the refresh hook to decide which buckets need topping up.
 */
export async function countByBucket(): Promise<Record<number, number>> {
  if (!isAvailable()) return {};
  try {
    const all = await getPuzzleBank();
    return all.reduce<Record<number, number>>((acc, p) => {
      acc[p.difficultyBucket] = (acc[p.difficultyBucket] ?? 0) + 1;
      return acc;
    }, {});
  } catch {
    return {};
  }
}
