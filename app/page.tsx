import Link from "next/link";
import { Calendar, Keyboard, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";

// Landing page. Server Component; the only interactive bits are the CTA
// links. We deliberately keep this page tiny so first-paint is fast and
// the user can be on a puzzle in one click.
export default function HomePage() {
  return (
    <div className="container flex flex-col items-center gap-12 py-16">
      <section className="flex max-w-2xl flex-col items-center gap-6 text-center">
        <span className="rounded-full border bg-card px-3 py-1 text-xs uppercase tracking-wider text-muted-foreground">
          Free · No ads
        </span>
        <h1 className="text-4xl font-bold tracking-tight sm:text-6xl">
          The smoothest Sudoku you can play in a browser
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          Keyboard-first. Beautiful interactions. A new daily puzzle every day with a global
          leaderboard. Play anonymously or sign in to track your streak.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/play">Play now</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/daily">Today's daily</Link>
          </Button>
        </div>
      </section>

      <section className="grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3">
        <Feature
          icon={<Keyboard className="h-5 w-5" />}
          title="Keyboard first"
          body="Arrow keys, vim bindings, undo, redo, notes, hints — every action has a shortcut."
        />
        <Feature
          icon={<Calendar className="h-5 w-5" />}
          title="Daily puzzle"
          body="One shared puzzle every day. Solve it before midnight UTC to extend your streak."
        />
        <Feature
          icon={<Trophy className="h-5 w-5" />}
          title="Honest leaderboards"
          body="Pure runs (no hints) ranked separately so the board is fair without disabling help."
        />
      </section>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </div>
  );
}
