# Sudoku

A fast, keyboard-first Sudoku web app. Free to play, daily puzzles, leaderboards, and stats.

Built solo with Next.js 15 + Supabase + Drizzle, optimized for low cost and operational simplicity. See `/Users/raz/.cursor/plans/sudoku_web_app_build_plan_d9ec8836.plan.md` for the full design plan.

## Stack

- **Framework:** Next.js 15 (App Router), React 19, TypeScript strict
- **UI:** Tailwind CSS, shadcn/ui (Radix primitives), lucide-react
- **DB / Auth:** Supabase Postgres, Supabase Auth (`@supabase/ssr`)
- **ORM:** Drizzle (postgres-js driver), hand-written SQL migrations for RLS/triggers
- **Client state:** Zustand for the active game; TanStack Query for server fetches
- **Validation:** Zod everywhere on the server boundary
- **Deploy:** Vercel Hobby

## Repo layout

```
app/                Next.js App Router pages, server actions, route handlers
components/         React components
  game/             Sudoku grid, cell, controls, timer, completion modal
  layout/           Header, footer, theme toggle, auth menu
  ui/               shadcn-style primitives (button, dialog, tabs, tooltip)
lib/
  sudoku/           Pure TypeScript game engine (board, validate, solver, history)
  zustand/          Client-side game store
  db/               Drizzle schema, client, queries
  supabase/         SSR + browser auth clients
  server/           Server Actions
drizzle/migrations  Hand-written SQL migrations (DDL + RLS + triggers)
scripts/            Import / seed / migrate scripts
types/              Local ambient type declarations
```

## Local development

```sh
# 1. Install
npm install
cp .env.example .env

# 2. Point DATABASE_URL at a local or dev Supabase Postgres.
#    Apply the migration:
npm run db:migrate

# 3. Import puzzles (see scripts/README.md to download the dataset first).
npm run puzzles:import -- --limit 50000 --per-bucket 5000

# 4. Seed daily puzzles for the next year.
npm run puzzles:seed-daily

# 5. Run the app.
npm run dev
```

## Common scripts

| Command                        | What it does                              |
| ------------------------------ | ----------------------------------------- |
| `npm run dev`                  | Next.js dev server                        |
| `npm run build`                | Production build                          |
| `npm run typecheck`            | `tsc --noEmit`                            |
| `npm run test`                 | Vitest (engine + scripts)                 |
| `npm run lint`                 | Next.js / ESLint                          |
| `npm run db:migrate`           | Apply hand-written SQL migrations         |
| `npm run puzzles:import`       | Import the Kaggle dataset                 |
| `npm run puzzles:seed-daily`   | Pre-seed daily puzzles                    |

## Deployment

See `/Users/raz/.cursor/plans/sudoku_web_app_build_plan_d9ec8836.plan.md` §16. Short version:

1. Two Supabase projects: `sudoku-dev` and `sudoku-prod`.
2. Vercel project pointed at `main`. Set env vars from `.env.example`.
3. Run `npm run db:migrate` once against prod.
4. Import puzzles + seed daily once against prod.
5. Add Sentry DSN, Resend SMTP for magic links, configure auth redirect URLs.
6. Point Cloudflare DNS at Vercel.

## Testing

- Unit tests for the engine (`lib/sudoku/*`) via Vitest. Run with `npm test`.
- Add Playwright e2e tests for the critical flows before launch (anonymous play → win, sign-in → save → resume, daily → submit → leaderboard).
