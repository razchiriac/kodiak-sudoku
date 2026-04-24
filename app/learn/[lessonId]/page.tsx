import { notFound } from "next/navigation";
import { techniqueJourney } from "@/lib/flags";
import { LESSONS, getLessonById } from "@/lib/learn/lessons";
import { LearnClient } from "@/components/learn/learn-client";

// RAZ-47 — Lesson player route. Server Component that:
//   - Gate-checks the feature flag (404 when off).
//   - Looks up the lesson by URL id (404 on miss).
//   - Computes the next lesson id from the static catalog so the
//     completion panel can offer a "Continue" CTA.
//   - Hands all of that to the client-side `LearnClient` which owns
//     the play loop.
//
// The lesson body itself is static, so technically the route could
// be statically generated. We keep `force-dynamic` for the same
// reason the index uses it: the feature flag is resolved per-request
// and an instant kill-switch is more important than the speed win
// from prerendering.

export const dynamic = "force-dynamic";

export default async function LessonPlayerPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const enabled = await techniqueJourney();
  if (!enabled) notFound();

  const { lessonId } = await params;
  const lesson = getLessonById(lessonId);
  if (!lesson) notFound();

  // Compute "next lesson" from the catalog order. Last lesson in the
  // catalog returns null, which the client renders as "back to the
  // index" instead of "next lesson".
  const idx = LESSONS.findIndex((l) => l.id === lesson.id);
  const next = idx >= 0 && idx < LESSONS.length - 1 ? LESSONS[idx + 1] : null;

  return <LearnClient lesson={lesson} nextLessonId={next?.id ?? null} />;
}
