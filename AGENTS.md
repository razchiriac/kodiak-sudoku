# AGENTS.md — guidance for AI coding tools

This project is being built solo with heavy AI assistance (Cursor, Claude). The rules below keep the architecture coherent across many AI-generated commits.

## Tech choices (do not change without discussion)

- Next.js 15 (App Router), React 19, TypeScript strict.
- Tailwind CSS, shadcn/ui (Radix primitives), lucide-react.
- Supabase Postgres + Supabase Auth via `@supabase/ssr`.
- Drizzle ORM with `postgres-js`. Hand-written SQL migrations (NOT `drizzle-kit push`).
- Zustand for the active game state. TanStack Query for server-fetched data.
- Zod on every server-action / route-handler boundary.

## File patterns

- Pages: `app/<segment>/page.tsx`, Server Components by default.
- Mutations: Server Actions in `lib/server/actions.ts` (or co-located `*.actions.ts`).
- Read paths: prefer Server Components; if a client must fetch, use TanStack Query.
- Game engine: framework-free TypeScript in `lib/sudoku/*`. Never import React there.
- Drizzle schema: `lib/db/schema.ts`. Queries: `lib/db/queries.ts` (server-only).
- Supabase: `lib/supabase/server.ts` for SSR, `lib/supabase/browser.ts` for the client.

## Coding rules

- TypeScript strict. No `any`. Use `unknown` and narrow.
- Maps, not `enum`s.
- Function declarations for pure functions; arrow functions for callbacks.
- File size cap: ~200 lines. Split when bigger.
- Always validate user input with Zod. Never trust a `userId` from the client; derive from the cookie session.
- Server-side completion verification is mandatory: compare submitted board to stored solution.
- For daily puzzles, never send the solution to the client; the hint goes through `hintAction`.
- RLS policies live in `drizzle/migrations/` SQL files. Every user-owned table must have RLS enabled.

## State management

- Active game state lives in the Zustand store (`lib/zustand/game-store.ts`).
- Components subscribe to slices via selectors (one selector per state field) so per-cell rerenders stay cheap.
- Server-fetched data goes through React Server Components when possible; TanStack Query when not.
- Anonymous progress is persisted via `zustand/middleware` `persist` to `localStorage`.

## Performance

- Cell components are `memo`'d with explicit comparators.
- Notes are stored as a `Uint16Array` of bitmasks; never as a JSON object.
- DB queries return only the columns the caller needs. Drizzle makes that obvious.

## Don'ts

- Do not import lodash, moment, axios, or other "convenience" libs. The deps in `package.json` are the full list.
- Do not call `drizzle-kit push` against any non-local DB.
- Do not auto-migrate on `next build`.
- Do not introduce a Redux/Jotai/Recoil. Zustand only.
- Do not couple game logic to React.

## Migration workflow (RAZ-83)

- Source of truth for **production-applied** migrations is Supabase's tracker (`supabase_migrations`).
- Keep SQL files in `drizzle/migrations/*.sql` as the canonical migration artifacts in git.
- For local/dev DBs you can still run `npm run db:migrate`.
- For production, apply migrations via the Supabase migration path (CLI or controlled migration runner) and then deploy app code.
- Any PR that edits `lib/db/schema.ts` must include a matching `drizzle/migrations/*.sql` change. CI enforces this guard.

## Review checklist

Before merging an AI-generated change:

- [ ] `npm run typecheck` clean
- [ ] `npm run lint` clean
- [ ] `npm test` clean
- [ ] No new dependencies (or add a sentence in DECISIONS.md if there is)
- [ ] Server actions all start with `"use server"` and call `getCurrentUser()` for auth
- [ ] No solution data leaked to the client for daily puzzles
- [ ] RLS policies updated if a new user-owned table was added
