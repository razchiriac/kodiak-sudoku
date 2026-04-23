import Link from "next/link";
import { redirect } from "next/navigation";
import { Swords } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DIFFICULTY_LABEL } from "@/lib/utils";

// RAZ-18: Diagonal variant landing page. Same layout as the standard
// /play page but filters by variant = "diagonal". Puzzle generation
// happens via a Server Action redirect just like the standard page.

export const dynamic = "force-dynamic";

export default function DiagonalPlayPage() {
  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Swords className="h-6 w-6 text-primary" />
          Diagonal Sudoku
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Classic Sudoku rules plus two extra constraints: each main diagonal
          must also contain the digits 1-9 exactly once.
        </p>
      </header>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          New diagonal puzzle
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[1, 2, 3].map((bucket) => (
            <DiagonalButton key={bucket} bucket={bucket} />
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Diagonal puzzles are available in Easy, Medium, and Hard.
        </p>
      </section>

      <section className="mt-10">
        <Link
          href="/play"
          className="text-sm text-muted-foreground hover:underline"
        >
          ← Back to standard puzzles
        </Link>
      </section>
    </div>
  );
}

function DiagonalButton({ bucket }: { bucket: number }) {
  async function startNew() {
    "use server";
    const { getRandomPuzzleByBucket } = await import("@/lib/db/queries");
    const puzzle = await getRandomPuzzleByBucket(bucket, "diagonal");
    if (!puzzle) {
      // No diagonal puzzles seeded yet for this bucket. Show a
      // user-friendly redirect rather than a 500.
      redirect("/play/diagonal?error=no-puzzles");
    }
    redirect(`/play/${puzzle.id}`);
  }

  return (
    <form action={startNew}>
      <Button type="submit" variant="outline" className="h-20 w-full flex-col gap-1 text-base">
        <span className="font-semibold">{DIFFICULTY_LABEL[bucket]}</span>
        <span className="text-xs text-muted-foreground">Diagonal puzzle</span>
      </Button>
    </form>
  );
}
