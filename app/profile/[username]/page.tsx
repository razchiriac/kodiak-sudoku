import { notFound } from "next/navigation";
import Link from "next/link";
import { Flame, Trophy } from "lucide-react";
import { getProfileByUsername, listRecentCompletions, getUserStats } from "@/lib/db/queries";
import { DIFFICULTY_LABEL, formatTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const revalidate = 30;

// Public profile: stats per difficulty, daily streak, recent completions.
// Anyone can view; the underlying queries do not include private data
// (everything here is either fully public or already RLS-permitted).
export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const profile = await getProfileByUsername(username);
  if (!profile) notFound();

  const [stats, recent] = await Promise.all([
    getUserStats(profile.id),
    listRecentCompletions(profile.id, 20),
  ]);

  return (
    <div className="container max-w-3xl py-10">
      <header className="mb-8 flex items-center gap-4">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-primary/10 text-2xl">
          {(profile.displayName ?? profile.username ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-bold">{profile.displayName ?? profile.username}</h1>
          <p className="text-sm text-muted-foreground">@{profile.username}</p>
        </div>
        <div className="ml-auto flex items-center gap-4">
          <Stat
            icon={<Flame className="h-4 w-4" />}
            label="Streak"
            value={profile.currentDailyStreak.toString()}
            sub={`best ${profile.longestDailyStreak}`}
          />
        </div>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((b) => {
          const s = stats.find((x) => x.difficulty === b);
          return (
            <div key={b} className="rounded-lg border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {DIFFICULTY_LABEL[b]}
              </div>
              <div className="mt-1 font-semibold">{s?.count ?? 0} solved</div>
              <div className="text-xs text-muted-foreground">
                Best: {s?.bestTimeMs ? formatTime(s.bestTimeMs) : "—"}
              </div>
              <div className="text-xs text-muted-foreground">
                Avg: {s?.avgTimeMs ? formatTime(s.avgTimeMs) : "—"}
              </div>
            </div>
          );
        })}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Recent completions
        </h2>
        {recent.length === 0 ? (
          <p className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">
            No completions yet.
          </p>
        ) : (
          <ol className="divide-y rounded-lg border bg-card">
            {recent.map(({ completed, puzzle }) => (
              <li
                key={completed.id}
                className="flex items-center gap-3 p-3 text-sm"
              >
                <Trophy className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Link
                  href={`/play/${puzzle.id}`}
                  className="flex-1 truncate hover:underline"
                >
                  {DIFFICULTY_LABEL[puzzle.difficultyBucket]}
                  {completed.mode === "daily" && " · Daily"}
                </Link>
                <span className="font-mono tabular-nums">{formatTime(completed.timeMs)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="text-right">
      <div className="flex items-center justify-end gap-1 text-xs uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="font-mono text-2xl tabular-nums">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}
