import { notFound, redirect } from "next/navigation";
import { getRandomPuzzleByBucket } from "@/lib/db/queries";
import { quickPlay } from "@/lib/flags";

// RAZ-34: Quick-play entry route. Picks a fresh random Easy puzzle on
// every hit and redirects to `/play/[id]?quick=1`. The `?quick=1`
// query flag marks the session as "quick mode" so the completion
// modal shows a "Next puzzle" CTA that loops back here. That loop is
// the whole point of the feature — short sessions, no friction,
// chained solves.
//
// We intentionally redirect rather than rendering PlayClient inline:
//   - Keeps the URL showing the actual puzzle id (friendlier for
//     sharing + browser history).
//   - Avoids duplicating the resume-from-saved-game logic in
//     /play/[puzzleId]/page.tsx.
//   - Refreshing /play/quick legitimately gives you a different
//     puzzle, matching the "auto-start a new puzzle" semantics.

// The random-pick and session read make this dynamic by definition.
export const dynamic = "force-dynamic";

export default async function QuickPlayPage() {
  // Flag gate first — a disabled flag 404s the whole namespace so we
  // never half-implement the feature if something goes wrong.
  const enabled = await quickPlay();
  if (!enabled) notFound();

  // Easy = bucket 1. Same helper used by the main /play home page so
  // we benefit from the TABLESAMPLE-backed constant-time pick.
  const puzzle = await getRandomPuzzleByBucket(1);
  if (!puzzle) {
    // Defensive: should never happen (we have ~30k Easy puzzles seeded)
    // but better to 404 loudly than silently redirect to /play/NaN.
    notFound();
  }

  // The `quick=1` param is what tells the play page to render in
  // quick mode. Using a redirect (not a rewrite) gives the browser
  // a real URL it can show in the address bar.
  redirect(`/play/${puzzle.id}?quick=1`);
}
