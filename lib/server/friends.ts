import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { completedGames, friendships, profiles } from "@/lib/db/schema";
import { canonicalPair } from "./friends-pair";

// Re-export so existing callers (actions.ts etc.) don't have to
// change their imports just because we split the pure helper out
// for testability.
export { canonicalPair };

// RAZ-12 — Server-side helpers for the friends / private
// leaderboards feature. Called by server actions (for writes) and
// directly by the leaderboard/friends pages (for reads).
//
// Pair canonicalisation:
//   The DB stores a single row per unordered pair with
//   user_a < user_b. Every call site that writes must go through
//   `canonicalPair()` to pick the right column ordering, or the
//   PK / check constraint will refuse the row.

/**
 * Read the friendship row between two users (or null when none).
 * Used by the send-request action to decide whether to insert new,
 * re-request, or reject as "already pending/accepted".
 */
export async function getFriendship(
  me: string,
  other: string,
): Promise<{
  userA: string;
  userB: string;
  status: string;
  requestedBy: string;
} | null> {
  const { userA, userB } = canonicalPair(me, other);
  const rows = await db
    .select({
      userA: friendships.userA,
      userB: friendships.userB,
      status: friendships.status,
      requestedBy: friendships.requestedBy,
    })
    .from(friendships)
    .where(and(eq(friendships.userA, userA), eq(friendships.userB, userB)))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Accepted friends for a user. Returns the *other* side's profile
 * for each friendship so the UI can render usernames directly.
 */
export async function listFriends(userId: string) {
  // We join twice against profiles — once for user_a and once for
  // user_b — and pick whichever one isn't the caller. A single
  // SQL trip avoids fanning out N profile lookups on the client.
  const rows = await db.execute<{
    id: string;
    username: string | null;
    display_name: string | null;
    since: Date;
  }>(
    sql`select
          p.id, p.username, p.display_name,
          f.updated_at as since
        from ${friendships} f
        join ${profiles} p on p.id = case when f.user_a = ${userId} then f.user_b else f.user_a end
        where ${friendships.status} = 'accepted'
          and (${friendships.userA} = ${userId} or ${friendships.userB} = ${userId})
        order by p.username asc nulls last, p.id asc`,
  );
  const list = (rows as unknown as {
    rows: Array<{
      id: string;
      username: string | null;
      display_name: string | null;
      since: Date;
    }>;
  }).rows;
  return list.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    since: r.since,
  }));
}

/** Incoming pending requests (someone else initiated, awaiting my response). */
export async function listIncomingRequests(userId: string) {
  const rows = await db.execute<{
    id: string;
    username: string | null;
    display_name: string | null;
    requested_at: Date;
  }>(
    sql`select
          p.id, p.username, p.display_name,
          f.created_at as requested_at
        from ${friendships} f
        join ${profiles} p on p.id = f.requested_by
        where ${friendships.status} = 'pending'
          and (${friendships.userA} = ${userId} or ${friendships.userB} = ${userId})
          and ${friendships.requestedBy} <> ${userId}
        order by f.created_at desc`,
  );
  const list = (rows as unknown as {
    rows: Array<{
      id: string;
      username: string | null;
      display_name: string | null;
      requested_at: Date;
    }>;
  }).rows;
  return list.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    requestedAt: r.requested_at,
  }));
}

/** Outgoing pending requests (I initiated, awaiting their response). */
export async function listOutgoingRequests(userId: string) {
  const rows = await db.execute<{
    id: string;
    username: string | null;
    display_name: string | null;
    requested_at: Date;
  }>(
    sql`select
          p.id, p.username, p.display_name,
          f.created_at as requested_at
        from ${friendships} f
        join ${profiles} p on p.id = case when f.user_a = ${userId} then f.user_b else f.user_a end
        where ${friendships.status} = 'pending'
          and (${friendships.userA} = ${userId} or ${friendships.userB} = ${userId})
          and ${friendships.requestedBy} = ${userId}
        order by f.created_at desc`,
  );
  const list = (rows as unknown as {
    rows: Array<{
      id: string;
      username: string | null;
      display_name: string | null;
      requested_at: Date;
    }>;
  }).rows;
  return list.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    requestedAt: r.requested_at,
  }));
}

/**
 * Private (friends-only) leaderboard for a given daily date + tier.
 * Always includes the caller themselves so "how do I rank" makes
 * sense even before accepting any requests.
 */
export async function getFriendsDailyLeaderboard(
  userId: string,
  date: string,
  opts: { bucket?: number; pure?: boolean; limit?: number } = {},
) {
  const limit = opts.limit ?? 50;
  // The scope is: me + users I'm accepted-friends with. We build
  // the id set once (Postgres can inline it as an ANY clause)
  // and reuse it as the leaderboard filter.
  const friends = await listFriends(userId);
  const ids = [userId, ...friends.map((f) => f.id)];

  const conds = [
    eq(completedGames.mode, "daily"),
    eq(completedGames.dailyDate, date),
    sql`${completedGames.userId} = any(${ids})`,
  ];
  if (opts.pure) conds.push(eq(completedGames.hintsUsed, 0));
  if (opts.bucket !== undefined)
    conds.push(eq(completedGames.difficultyBucket, opts.bucket));

  const rows = await db
    .select({
      userId: completedGames.userId,
      timeMs: completedGames.timeMs,
      mistakes: completedGames.mistakes,
      hintsUsed: completedGames.hintsUsed,
      completedAt: completedGames.completedAt,
      username: profiles.username,
      displayName: profiles.displayName,
    })
    .from(completedGames)
    .leftJoin(profiles, eq(profiles.id, completedGames.userId))
    .where(and(...conds))
    .orderBy(completedGames.timeMs, completedGames.completedAt)
    .limit(limit);
  return rows;
}

