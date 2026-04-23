import "server-only";

// RAZ-71 — `db.execute()` shape normalizer.
//
// Why this exists:
//   Drizzle's `db.execute(sql\`...\`)` returns the underlying driver's
//   result shape unchanged. For `postgres-js` (the driver this app
//   uses, see `lib/db/client.ts`) that's a plain Array — the rows ARE
//   the result. For `node-postgres` (`pg`) it's an object shaped like
//   `{ rows: T[], rowCount, ... }`.
//
//   Several query helpers in this codebase were originally written
//   assuming the `pg` shape (`(result as unknown as { rows: T[] }).rows`)
//   and have been silently broken since the project settled on
//   `postgres-js`: every such call site was producing `undefined` and
//   then either crashing on `.map(...)` (profile heatmap, friends
//   leaderboard) or quietly returning empty data (daily archive
//   prev/next nav, custom puzzle aggregates).
//
// What this helper does:
//   Normalizes both shapes into a plain `T[]`. If the underlying
//   driver ever changes again (or we switch to `pg`), call sites
//   don't move — only this helper does. The boolean `Array.isArray`
//   check is the safe discriminator: postgres-js's `RowList` extends
//   Array, while `pg`'s result is a non-array object.
//
// Why a helper instead of refactoring to `db.select(...)`:
//   Several of the affected queries use SQL features that aren't
//   first-class in Drizzle's query builder (FILTER on aggregates,
//   subqueries used as derived tables, CASE inside JOINs). Rewriting
//   them was much higher risk than this one-line change at each
//   call site.
export function execRows<T>(result: unknown): T[] {
  // postgres-js returns RowList<T> which inherits from Array — this
  // is the path we actually take in production.
  if (Array.isArray(result)) return result as T[];
  // node-postgres compatibility: `{ rows: [...] }`. Also covers any
  // future driver that adopts the same convention. We treat a
  // missing `.rows` as an empty result rather than throwing because
  // a defensive empty is always safer than a TypeError on the
  // happy-path render of a Server Component.
  const obj = (result ?? {}) as { rows?: T[] };
  return obj.rows ?? [];
}
