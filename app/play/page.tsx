import Link from "next/link";
import { redirect } from "next/navigation";
import { Calendar, GraduationCap, Sparkles, Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABEL } from "@/lib/utils";
import { getCurrentUser } from "@/lib/supabase/server";
import { listRecentSavedGames } from "@/lib/db/queries";
import { modePresets, techniqueJourney } from "@/lib/flags";
import { ModePresetPicker } from "@/components/game/mode-preset-picker";

// Reads the caller's session and saved games; never static.
export const dynamic = "force-dynamic";

// Difficulty picker / dashboard. Server Component so we can render the
// "Continue" card directly from saved_games without a client fetch.
export default async function PlayHomePage() {
  const user = await getCurrentUser();
  const saved = user ? await listRecentSavedGames(user.id, 3) : [];
  // RAZ-54: resolve the Mode Presets flag server-side so the client
  // picker hides itself instantly when the flag is off — no flicker
  // from a client effect that runs after first paint.
  const modePresetsEnabled = await modePresets();
  // RAZ-47: same SSR-resolved-flag pattern. When off, the Learn CTA
  // is omitted from the DOM entirely (not hidden via CSS) so the
  // grid below collapses cleanly to two cards. Off-flag = the route
  // 404s anyway, so we never want to advertise a dead link.
  const techniqueJourneyEnabled = await techniqueJourney();

  return (
    <div className="container max-w-3xl py-10">
      {/* RAZ-54: preset picker. Renders nothing when the feature flag
          is off (the client component checks the mirrored flag in the
          store). Placed above the difficulty buttons so a player
          decides "how" before they decide "how hard". */}
      <ModePresetPicker enabled={modePresetsEnabled} variant="home" />

      {saved.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Continue
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {saved.map(({ saved: s, puzzle }) => (
              <Link
                key={s.id}
                href={`/play/${puzzle.id}`}
                className="rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
              >
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  {DIFFICULTY_LABEL[puzzle.difficultyBucket]}
                </div>
                <div className="mt-1 text-sm">
                  In progress · {Math.floor(s.elapsedMs / 60_000)}m
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          New puzzle
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3, 4].map((bucket) => (
            <NewPuzzleButton key={bucket} bucket={bucket} />
          ))}
        </div>
      </section>

      <section className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Link
          href="/daily"
          className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent"
        >
          <Calendar className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">Today's daily</div>
            <div className="text-sm text-muted-foreground">One puzzle, the whole world.</div>
          </div>
        </Link>
        <Link
          href="/play/diagonal"
          className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent"
        >
          <Swords className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">Diagonal Sudoku</div>
            <div className="text-sm text-muted-foreground">Extra constraints, extra fun.</div>
          </div>
        </Link>
        <Link
          href="/leaderboard"
          className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent"
        >
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <div className="font-medium">Leaderboard</div>
            <div className="text-sm text-muted-foreground">See who's fastest today.</div>
          </div>
        </Link>
        {/* RAZ-47: entry to the Technique Journey. Sits in the same
            secondary-CTA grid as the daily and the diagonal variant
            so it reads as one of "the other things you can do here"
            rather than a top-of-page hero. Hidden entirely when the
            flag is off — the route also 404s in that state, so this
            keeps the UI honest. */}
        {techniqueJourneyEnabled && (
          <Link
            href="/learn"
            className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-accent"
          >
            <GraduationCap className="h-5 w-5 text-primary" />
            <div>
              <div className="font-medium">Learn techniques</div>
              <div className="text-sm text-muted-foreground">
                Guided lessons for naked singles and beyond.
              </div>
            </div>
          </Link>
        )}
      </section>
    </div>
  );
}

// New-puzzle entry: a Server Action button that picks a random puzzle of
// the given difficulty and redirects. We use a Server Action (rather than
// a link to /api) so the user lands on a stable URL for the puzzle they
// just got.
function NewPuzzleButton({ bucket }: { bucket: number }) {
  async function startNew() {
    "use server";
    const { getRandomPuzzleByBucket } = await import("@/lib/db/queries");
    const puzzle = await getRandomPuzzleByBucket(bucket);
    if (!puzzle) throw new Error(`No puzzles in bucket ${bucket}`);
    redirect(`/play/${puzzle.id}`);
  }

  return (
    <form action={startNew}>
      <Button type="submit" variant="outline" className="h-20 w-full flex-col gap-1 text-base">
        <span className="font-semibold">{DIFFICULTY_LABEL[bucket]}</span>
        <span className="text-xs text-muted-foreground">Start a new puzzle</span>
      </Button>
    </form>
  );
}
