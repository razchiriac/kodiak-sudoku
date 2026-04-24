# DECISIONS.md

Short, dated record of meaningful architectural decisions. Append-only.

## 2026-04 Drizzle, not Prisma

**Why:** Drizzle is faster on serverless cold starts (no engine binary), works cleanly with `postgres-js`, and the SQL-in-TypeScript style is easier for AI to extend safely. Prisma's "schema.prisma" indirection breaks the pattern of "ask Cursor to add a column".

## 2026-04 Hand-written SQL migrations

**Why:** Supabase requires real SQL anyway for the `auth.users` trigger, RLS policies, and the streak trigger. Mixing Drizzle's generated DDL with hand-written SQL is more confusing than just owning the migrations. `drizzle-kit generate` stays available locally for column-shape diffs as a sanity check.

## 2026-04 Tailwind v3, not v4

**Why:** v4 alpha churn isn't worth the few-KB savings for a solo build. v3 + shadcn/ui is the most-documented path the AI tools know.

## 2026-04 Zustand for game state

**Why:** Per-cell rerender cost has to be near-zero for keyboard-driven entry to feel snappy. Zustand selectors give that without ceremony. Context would force the whole grid to rerender on every digit press; React Query is wrong for ephemeral local state.

## 2026-04 Server actions for mutations, route handlers only where needed

**Why:** Server Actions are simpler (no fetch wrapper, no manual JSON shape). Use a Route Handler only when we need a real HTTP endpoint (`/api/health`, `/auth/callback`).

## 2026-04 Supabase Auth via @supabase/ssr

**Why:** Bundled with the DB, RLS works out of the box, magic-link UX is a one-liner. NextAuth would force us to maintain our own user table separate from RLS. Clerk has a non-trivial monthly cost.

## 2026-04 No anonymous→user completion migration

**Why:** Anonymous wins are easy to fake. Migrating only the active in-progress game (not completion records) keeps the leaderboard honest. Anonymous players who want a streak should sign in first.

## 2026-04 Daily puzzle: solution never reaches the client

**Why:** A determined cheater with the solution can post any time. Hints go through `hintAction` which throttles + tracks; submission is verified server-side against the stored solution.

## 2026-04 OpenAI as AI provider (RAZ-61)

**Why:** First AI feature (post-game debrief) needs a model that supports JSON-schema-validated structured outputs natively. The official `openai` SDK ships with first-class support and the project plan explicitly says "OpenAI-first". We wire calls through `lib/server/openai.ts` (lazy singleton, key-presence helper) so subsequent AI features (RAZ-58 coach) reuse the same plumbing rather than each opening their own client. Model name is env-driven (`OPENAI_MODEL_DEBRIEF`) so prod can move tiers without a deploy. Without `OPENAI_API_KEY` set, every AI surface falls back to a deterministic local generator so previews and CI never need a paid key.
