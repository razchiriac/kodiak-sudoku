// RAZ-47 — Anonymous lesson progress store.
//
// Why this is its own tiny store (and not part of the main game store):
//   - The game store already does a lot. Adding lesson state would
//     bloat its persist payload and force a settings migration for
//     every signed-out player.
//   - Lesson progress has different semantics: it's monotonic
//     (a completed lesson stays completed), set-shaped (just a list
//     of ids), and updates rarely (once per lesson completion).
//   - A separate store keeps the lesson UI completely decoupled from
//     the puzzle play loop. The /learn page never needs to import
//     the game store, and vice versa.
//
// Why Zustand + persist instead of a thin localStorage wrapper:
//   - Cross-component reactivity for free: the lesson list, the play
//     hub CTA, and the lesson player itself can all subscribe and
//     stay in sync without a custom event bus.
//   - Same persistence story as the game store, so when we add
//     server-side sync for signed-in users (RAZ-47 follow-up) we can
//     mirror this store from the same hydration path the game store
//     uses today.
//
// Persistence:
//   - Stored under localStorage key `sudoku-learn` (separate namespace
//     from `sudoku-game` so a corrupt or oversized lesson payload
//     can't take the active game down with it).
//   - SSR-safe via the same no-op storage trick the game store uses.
//   - Keys are lesson ids — see `lib/learn/lessons.ts` for the
//     stable-forever id contract. Renaming a lesson id wipes the
//     player's progress for it, by design.

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

// Shape of the persisted blob. Kept deliberately small: just the set
// of completed lesson ids and a `lastCompletedAt` timestamp per id.
// The timestamp is not surfaced in the UI yet but is useful for a
// future "time-based unlocks" feature, and it costs nothing to capture
// on the way in.
export type LearnState = {
  // Map of lesson-id → ISO timestamp of completion.
  // We use a plain Record (not a Set) so the persist serializer can
  // round-trip it as JSON without custom (de)serialization.
  completed: Record<string, string>;
};

export type LearnActions = {
  // Mark a lesson completed at the given timestamp (defaults to now).
  // Idempotent: re-completing a lesson updates the timestamp but
  // doesn't re-fire any side effects.
  markCompleted: (lessonId: string, atIso?: string) => void;
  // Drop a single lesson's completion (used by the dev `?reset=` URL
  // query for testing). Not exposed in production UI.
  clearCompletion: (lessonId: string) => void;
  // Wipe all lesson progress. Same dev-only escape hatch.
  resetAll: () => void;
};

const INITIAL: LearnState = {
  completed: {},
};

export const useLearnStore = create<LearnState & LearnActions>()(
  persist(
    (set) => ({
      ...INITIAL,
      markCompleted: (lessonId, atIso) => {
        const ts = atIso ?? new Date().toISOString();
        set((s) => ({
          completed: { ...s.completed, [lessonId]: ts },
        }));
      },
      clearCompletion: (lessonId) => {
        set((s) => {
          if (!(lessonId in s.completed)) return s;
          // Build a fresh map without the dropped key. We don't mutate
          // the existing object because Zustand's shallow equality
          // check needs a new reference to fire subscribers.
          const next: Record<string, string> = {};
          for (const [k, v] of Object.entries(s.completed)) {
            if (k !== lessonId) next[k] = v;
          }
          return { completed: next };
        });
      },
      resetAll: () => set(() => ({ ...INITIAL })),
    }),
    {
      name: "sudoku-learn",
      // Same SSR-safe pattern the game store uses: when there's no
      // window, hand back a no-op storage so the persist middleware
      // doesn't crash on prerender.
      storage: createJSONStorage(() => {
        if (typeof window === "undefined") {
          return {
            getItem: () => null,
            setItem: () => undefined,
            removeItem: () => undefined,
          };
        }
        return window.localStorage;
      }),
    },
  ),
);

// Selector helpers. Components should subscribe via these (one
// selector per piece of derived state) so we keep rerenders tight.

// True iff the lesson has been completed at any point.
export function selectIsCompleted(lessonId: string) {
  return (s: LearnState): boolean => lessonId in s.completed;
}

// Plain array of completed lesson ids. Order is insertion order of
// the underlying record (i.e. the order the player completed them).
export function selectCompletedIds(s: LearnState): string[] {
  return Object.keys(s.completed);
}

// Total count of completed lessons. Cheap to compute; we expose a
// dedicated selector so subscribers don't allocate the keys array
// on every render.
export function selectCompletedCount(s: LearnState): number {
  return Object.keys(s.completed).length;
}
