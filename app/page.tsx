import Link from "next/link";
import type { Route } from "next";
import { Calendar, Keyboard, Trophy, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { quickPlay } from "@/lib/flags";

// Landing page. Server Component; the only interactive bits are the CTA
// links. We deliberately keep this page tiny so first-paint is fast and
// the user can be on a puzzle in one click.
//
// RAZ-34: when the `quick-play` flag is on we surface a third CTA that
// deep-links into /play/quick (auto-new-random Easy loop) and a matching
// feature card pointing at the weekly count-based leaderboard. Flag off
// = zero visual change, so we can ship safely.
export default async function HomePage() {
  const quickPlayFlag = await quickPlay();
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
          {quickPlayFlag ? (
            <Button asChild size="lg" variant="outline">
              <Link href="/play/quick">Quick play</Link>
            </Button>
          ) : null}
        </div>
      </section>

      <section
        className={
          quickPlayFlag
            ? "grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4"
            : "grid w-full max-w-4xl grid-cols-1 gap-6 sm:grid-cols-3"
        }
      >
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
        {/* RAZ-34: quick-play feature card. Linked so the whole card
            becomes a CTA for players who scroll past the hero buttons. */}
        {quickPlayFlag ? (
          <Feature
            icon={<Zap className="h-5 w-5" />}
            title="Quick play"
            body="Chained Easy puzzles for short sessions. Weekly board ranks by solves."
            href="/leaderboard/quick"
          />
        ) : null}
      </section>
    </div>
  );
}

function Feature({
  icon,
  title,
  body,
  href,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  // Optional deep-link. When present the whole card becomes a Link; we
  // keep the non-link variant because most feature cards are
  // informational, not navigational.
  href?: Route;
}) {
  const inner = (
    <>
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <h3 className="mb-1 font-semibold">{title}</h3>
      <p className="text-sm text-muted-foreground">{body}</p>
    </>
  );
  if (href) {
    return (
      <Link
        href={href}
        className="rounded-lg border bg-card p-5 transition-colors hover:bg-accent"
      >
        {inner}
      </Link>
    );
  }
  return <div className="rounded-lg border bg-card p-5">{inner}</div>;
}
