import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABEL } from "@/lib/utils";
import { arrowSudoku } from "@/lib/flags";

// RAZ-120: Arrow Sudoku variant landing page. Same layout as the diagonal
// /play/diagonal page but filters by variant = "arrow". Puzzle selection
// happens via a Server Action redirect just like diagonal and standard.

export const dynamic = "force-dynamic";

export default async function ArrowPlayPage() {
  // Gate behind the feature flag — if off, 404 so we don't advertise
  // a dead end from /play.
  const enabled = await arrowSudoku();
  if (!enabled) {
    redirect("/play");
  }

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ArrowUpRight className="h-6 w-6 text-primary" />
          Arrow Sudoku
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Classic Sudoku rules plus arrow constraints: digits along each arrow
          must sum to the digit in the circle cell.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          New arrow puzzle
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3].map((bucket) => (
            <ArrowButton key={bucket} bucket={bucket} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Arrow puzzles are available in Easy, Medium, and Hard.
        </p>
      </section>

      <section className="mt-10">
        <Link
          href="/play"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to all puzzles
        </Link>
      </section>
    </div>
  );
}

function ArrowButton({ bucket }: { bucket: number }) {
  async function startNew() {
    "use server";
    const { getRandomPuzzleByBucket } = await import("@/lib/db/queries");
    const puzzle = await getRandomPuzzleByBucket(bucket, "arrow");
    if (!puzzle) {
      redirect("/play/arrow?error=no-puzzles");
    }
    redirect(`/play/${puzzle.id}`);
  }

  return (
    <form action={startNew}>
      <Button type="submit" variant="outline" className="h-20 w-full flex-col gap-1 text-base">
        <span className="font-semibold">{DIFFICULTY_LABEL[bucket]}</span>
        <span className="text-xs text-muted-foreground">Arrow puzzle</span>
      </Button>
    </form>
  );
}
