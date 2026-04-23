import { describe, expect, it } from "vitest";
import { execRows } from "./exec-rows";

// RAZ-71 regression coverage. The bug we're guarding against: every
// call site that historically did `(result as { rows: T[] }).rows`
// silently produced `undefined` under postgres-js (the driver this
// app actually uses) because postgres-js returns rows as a plain
// Array, not a wrapper object. The page-level symptom was a 500
// (TypeError on `.map`) on `/profile/[username]` and a different
// 500 (invalid SQL) on `/leaderboard`. This file pins the helper's
// behaviour so the bug can't quietly come back.
describe("execRows", () => {
  it("returns the array as-is when the driver hands back a plain array (postgres-js path)", () => {
    // postgres-js's `RowList<T>` extends Array, so this is the path
    // that runs in production. The helper must be a pass-through.
    const driverResult = [{ id: 1 }, { id: 2 }];
    const rows = execRows<{ id: number }>(driverResult);
    expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
    // identity preservation matters too — we don't want a needless
    // copy on the hot path.
    expect(rows).toBe(driverResult);
  });

  it("unwraps the .rows property when the driver wraps results (node-postgres path)", () => {
    // node-postgres returns `{ rows: T[], rowCount, ... }`. We want
    // forward-compat in case anyone ever swaps the driver back.
    const driverResult = { rows: [{ id: 1 }], rowCount: 1, command: "SELECT" };
    expect(execRows<{ id: number }>(driverResult)).toEqual([{ id: 1 }]);
  });

  it("returns an empty array for null/undefined instead of throwing", () => {
    // Defensive default. If a query helper ever forgets to await or
    // a future driver returns nothing, we'd rather render an empty
    // section than crash a Server Component render.
    expect(execRows(undefined)).toEqual([]);
    expect(execRows(null)).toEqual([]);
  });

  it("returns an empty array when the wrapper object lacks a .rows field", () => {
    // Same defensive intent as above for unknown driver shapes.
    expect(execRows({ rowCount: 0 })).toEqual([]);
  });
});
