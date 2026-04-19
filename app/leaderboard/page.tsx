import { getDailyLeaderboard, getDailyPuzzle } from "@/lib/db/queries";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTime, DIFFICULTY_LABEL } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 60;

// Daily leaderboard. Shows two tabs: "Pure" (no hints) is the default and
// is what we promote in marketing; "All" includes anyone who finished,
// regardless of hints. We sort by time, ties broken by completion time.
export default async function LeaderboardPage() {
  const today = new Date().toISOString().slice(0, 10);
  const daily = await getDailyPuzzle(today);

  const [pure, all] = daily
    ? await Promise.all([
        getDailyLeaderboard(today, { pure: true, limit: 50 }),
        getDailyLeaderboard(today, { pure: false, limit: 50 }),
      ])
    : [[], []];

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-bold">Daily leaderboard</h1>
          <p className="text-sm text-muted-foreground">
            {daily
              ? `${today} · ${DIFFICULTY_LABEL[daily.puzzle.difficultyBucket]}`
              : "No daily puzzle scheduled today."}
          </p>
        </div>
      </header>

      <Tabs defaultValue="pure">
        <TabsList>
          <TabsTrigger value="pure">Pure</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
        <TabsContent value="pure">
          <Board rows={pure} pure />
        </TabsContent>
        <TabsContent value="all">
          <Board rows={all} pure={false} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Row = Awaited<ReturnType<typeof getDailyLeaderboard>>[number];

function Board({ rows, pure }: { rows: Row[]; pure: boolean }) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
        {pure
          ? "No hint-free completions yet today. Be the first."
          : "No completions yet today. Be the first."}
      </p>
    );
  }
  return (
    <ol className="divide-y rounded-lg border bg-card">
      {rows.map((r, i) => (
        <li key={`${r.userId}-${r.completedAt.toString()}`} className="flex items-center gap-3 p-3">
          <span className="w-6 text-right font-mono text-sm tabular-nums text-muted-foreground">
            {i + 1}
          </span>
          <span className="flex-1 truncate text-sm">
            {r.displayName ?? r.username ?? "Anonymous"}
          </span>
          <span className="font-mono text-sm tabular-nums">{formatTime(r.timeMs)}</span>
          {!pure && (
            <span className="w-12 text-right text-xs text-muted-foreground">
              {r.hintsUsed > 0 ? `+${r.hintsUsed}h` : ""}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}
