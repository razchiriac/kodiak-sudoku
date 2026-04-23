// RAZ-12 — Pure helper for ordering user ids so `user_a < user_b`.
// Split out from lib/server/friends.ts so it can be imported by
// unit tests (friends.ts uses `server-only` which vitest chokes on).
// Every friendship write MUST flow through this function or the
// table's `(user_a, user_b)` PK + `user_a < user_b` check will
// refuse the row.
export function canonicalPair(a: string, b: string): {
  userA: string;
  userB: string;
} {
  return a < b ? { userA: a, userB: b } : { userA: b, userB: a };
}
