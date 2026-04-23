/* eslint-disable no-console */
import { Client } from "pg";

// Pre-assign daily puzzles to the next N days.
//
// RAZ-33: The mini-daily rotation is three puzzles per date, one
// per tier (Easy / Medium / Hard). Expert is intentionally NOT
// part of the daily rotation — the all-time Expert leaderboard
// (RAZ-6) exists for that audience. Existing Expert rows from
// the pre-RAZ-33 rotation are left untouched (they belong to
// past dates which are already "in the bag").
//
// The user-facing path (`/daily?tier=easy|medium|hard`) then does a
// single SELECT ... where puzzle_date = today and difficulty_bucket = $1.

// Daily tiers we seed every date. Order matters for legibility in
// the seed output; it does not affect storage.
const DAILY_BUCKETS = [1, 2, 3] as const;

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

  // Build the candidate date list.
  const dates: string[] = [];
  for (let i = 0; i < args.days; i++) {
    const d = new Date(args.startDate);
    d.setUTCDate(d.getUTCDate() + i);
    dates.push(isoDate(d));
  }

  // Fetch all (date, bucket) rows in range so we can skip the ones
  // that already exist. Changing an already-seeded row would shift
  // a live leaderboard under our users, which is a cardinal sin.
  const existingRes = await pg.query<{ puzzle_date: string; difficulty_bucket: number }>(
    `select puzzle_date::text, difficulty_bucket from daily_puzzles
     where puzzle_date = any($1::date[])`,
    [dates],
  );
  const existing = new Set(
    existingRes.rows.map((r) => `${r.puzzle_date}:${r.difficulty_bucket}`),
  );

  let assigned = 0;
  for (const dateStr of dates) {
    for (const bucket of DAILY_BUCKETS) {
      if (existing.has(`${dateStr}:${bucket}`)) continue;

      // Pick a puzzle in the target bucket that has NOT yet been
      // used for any daily. ORDER BY random() is fine because we
      // run this script annually and each bucket has tens of
      // thousands of unused rows.
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
        console.warn(
          `No unused puzzle available for ${dateStr} bucket ${bucket}; skipping`,
        );
        continue;
      }

      await pg.query(
        `insert into daily_puzzles (puzzle_date, puzzle_id, difficulty_bucket)
         values ($1, $2, $3)
         on conflict (puzzle_date, difficulty_bucket) do nothing`,
        [dateStr, pick.rows[0].id, pick.rows[0].difficulty_bucket],
      );
      assigned++;
    }
  }

  console.log(`Assigned ${assigned} new daily puzzle rows across ${dates.length} dates.`);
  await pg.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
