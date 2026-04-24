"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { LESSONS } from "@/lib/learn/lessons";
import { useLearnStore, selectCompletedCount } from "@/lib/learn/progress";

// RAZ-47 — Client-side lesson list with per-row "completed" badges.
//
// Why this is a client component:
//   The completed flag lives in localStorage (anonymous-first MVP).
//   Reading it from a Server Component would either always return
//   "not completed" (no cookie/DB to read from) or force us to ship
//   the progress to the server prematurely. Easier to render the
//   static catalog server-side wrapped around this small client tree
//   that swaps the icon based on the persisted set.
//
// Hydration note:
//   On first paint the persisted store is still being rehydrated from
//   localStorage. Zustand's persist middleware does this synchronously
//   in the browser (the no-op SSR storage returns null), so by the
//   time React hydrates the client tree, the completed map is already
//   populated. No flash of "not completed" — but if a future change
//   moves to async storage, we'd want a loading state here.

export function LessonList() {
  // We subscribe to the completed-count selector so the header
  // updates the moment a lesson is marked complete (e.g. the player
  // finishes one in another tab and switches back).
  const completedCount = useLearnStore(selectCompletedCount);
  // Subscribe once to the entire completed map so per-row reads below
  // share a single subscription; computing membership inline beats
  // calling useLearnStore inside a .map (which would create N separate
  // subscriptions per render).
  const completed = useLearnStore((s) => s.completed);

  return (
    <div className="container max-w-2xl py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Technique Journey</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Bite-sized lessons that teach one Sudoku deduction technique at a
          time. {completedCount} of {LESSONS.length} complete.
        </p>
      </header>

      <ol className="divide-y rounded-lg border bg-card">
        {LESSONS.map((lesson) => {
          const isDone = lesson.id in completed;
          return (
            <li key={lesson.id}>
              <Link
                href={`/learn/${lesson.id}`}
                className="flex items-start gap-3 p-4 transition-colors hover:bg-accent"
              >
                {/* Completed = filled check, otherwise an empty circle.
                    We size them identically so the row layout doesn't
                    shift after a completion. */}
                {isDone ? (
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{lesson.title}</span>
                    <span className="rounded-full border px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
                      {lesson.technique.replace("-", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {lesson.tagline}
                  </p>
                </div>
              </Link>
            </li>
          );
        })}
      </ol>

      {/* Subtle note for first-time visitors that progress is local
          and per-device. Keeps expectations honest before we wire up
          server-side sync in a follow-up. */}
      <p className="mt-4 text-xs text-muted-foreground">
        Progress is saved on this device. Sign-in sync coming soon.
      </p>
    </div>
  );
}
