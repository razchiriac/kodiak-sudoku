/* eslint-disable no-console */
import { Client } from "pg";

// Pre-assign one puzzle to each of the next N days. The user-facing path
// for the daily puzzle is then a single SELECT ... where puzzle_date = today.
//
// Default difficulty rotation by weekday gives players some variety
// without making the experience random:
//   Mon Easy, Tue Medium, Wed Hard, Thu Medium, Fri Hard, Sat Expert, Sun Medium
// The rotation is documented as part of the product, so changing it later
// requires a clear announcement.
const ROTATION: Record<number, number> = {
  // 0 = Sunday in JS Date.getUTCDay()
  0: 2, // Sun -> Medium
  1: 1, // Mon -> Easy
  2: 2, // Tue -> Medium
  3: 3, // Wed -> Hard
  4: 2, // Thu -> Medium
  5: 3, // Fri -> Hard
  6: 4, // Sat -> Expert
};

type CliArgs = { days: number; startDate: Date };

function parseArgs(): CliArgs {
  const args: CliArgs = { days: 365, startDate: new Date() };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--days") args.days = Number(process.argv[++i]);
    else if (a === "--from") args.startDate = new Date(process.argv[++i]);
  }
  return args;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const args = parseArgs();
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pg = new Client({ connectionString: url });
  await pg.connect();

  // Find which dates already have a puzzle assigned so we don't disturb
  // them. The daily puzzle is part of the leaderboard's identity; never
  // change a date's puzzle once it has been seen by users.
  const existingRes = await pg.query<{ puzzle_date: string }>(
    `select puzzle_date::text from daily_puzzles
     where puzzle_date >= $1 and puzzle_date < $1::date + $2::int`,
    [isoDate(args.startDate), args.days],
  );
  const existing = new Set(existingRes.rows.map((r) => r.puzzle_date));

  // For each missing date, pick a random puzzle that has not yet been used
  // for any past or future daily, with the rotation's difficulty.
  let assigned = 0;
  for (let i = 0; i < args.days; i++) {
    const d = new Date(args.startDate);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = isoDate(d);
    if (existing.has(dateStr)) continue;

    const bucket = ROTATION[d.getUTCDay()];

    // Pick a puzzle that has never been used as a daily before. We use
    // ORDER BY random() because we run this once a year and the cost is
    // trivial; no need for tablesample tricks.
    const pick = await pg.query<{ id: string; difficulty_bucket: number }>(
      `select p.id::text, p.difficulty_bucket
       from puzzles p
       where p.difficulty_bucket = $1
         and not exists (
           select 1 from daily_puzzles d where d.puzzle_id = p.id
         )
       order by random()
       limit 1`,
      [bucket],
    );
    if (pick.rowCount === 0) {
      console.warn(`No unused puzzle available for ${dateStr} bucket ${bucket}; skipping`);
      continue;
    }

    await pg.query(
      `insert into daily_puzzles (puzzle_date, puzzle_id, difficulty_bucket)
       values ($1, $2, $3)
       on conflict (puzzle_date) do nothing`,
      [dateStr, pick.rows[0].id, pick.rows[0].difficulty_bucket],
    );
    assigned++;
  }

  console.log(`Assigned ${assigned} new daily puzzles.`);
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
