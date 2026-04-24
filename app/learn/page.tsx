import { notFound } from "next/navigation";
import { techniqueJourney } from "@/lib/flags";
import { LessonList } from "@/components/learn/lesson-list";

// RAZ-47 — Technique Journey index. Server Component that flag-gates
// the whole namespace and renders the static catalog inside a small
// client tree (LessonList) that surfaces per-lesson completion state
// from localStorage.
//
// Why force-dynamic: the route itself doesn't depend on cookies or
// per-user data, so technically we could pre-render. We mark it
// dynamic anyway because the flag is resolved per-request via Edge
// Config and we want the off-state (404) to react immediately when
// the flag flips, not after a stale ISR window.
export const dynamic = "force-dynamic";

export default async function LearnIndexPage() {
  // Same gate-first pattern the rest of the flag-gated routes use:
  // a disabled flag 404s the namespace so a half-rolled-out feature
  // doesn't leak partial UI.
  const enabled = await techniqueJourney();
  if (!enabled) notFound();

  return <LessonList />;
}
