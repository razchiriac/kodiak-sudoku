# Scripts

One-off and recurring maintenance scripts for the Sudoku app. All scripts read `DATABASE_URL` from `.env`. None of them should ever run in the Vercel serverless runtime.

## migrate.ts

Apply hand-written SQL migrations from `drizzle/migrations/`. Idempotent.

```sh
npm run db:migrate
```

## import-puzzles.ts

Imports a curated subset of the Kaggle "3 Million Sudoku Puzzles with Ratings" dataset.

### Get the dataset

```sh
mkdir -p data/raw
# Requires `kaggle` CLI configured with your API token.
kaggle datasets download -d radcliffe/3-million-sudoku-puzzles-with-ratings -p data/raw --unzip
mv data/raw/sudoku-3m.csv data/raw/sudoku-3m.csv  # already named this in v3 of the dataset
```

The script accepts either `puzzle`/`solution` columns or `quizzes`/`solutions` from older variants.

### Run

```sh
# Quick check on a small slice first
npm run puzzles:import -- --limit 50000 --per-bucket 5000

# Real run (adjust per-bucket to taste; 30k * 4 = 120k rows is comfortable on free tier)
npm run puzzles:import -- --per-bucket 30000

# Override cutoffs after you've inspected the rating distribution
npm run puzzles:import -- --cutoffs '[2.5,4.0,6.5]'
```

The script is idempotent. Re-running it sample-imports new rows and skips any whose `puzzle` text already exists.

## seed-daily.ts

Pre-assigns one puzzle to each of the next 365 days. Run once after the first import, then again yearly (or whenever the daily table gets close to running out).

```sh
npm run puzzles:seed-daily
# Or specify a window:
npm run puzzles:seed-daily -- --days 90 --from 2026-05-01
```

Existing assignments are never overwritten.
