import { createHash } from "node:crypto";
import { and, count, eq, gte } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/lib/db/client";
import { rateLimitEvents } from "@/lib/db/schema";
import type { RateLimitWindow } from "./rate-limit-config";

export {
  HINT_BUCKET,
  HINT_LIMITS,
  DEBRIEF_BUCKET,
  DEBRIEF_LIMITS,
  COACH_BUCKET,
  COACH_LIMITS,
  type RateLimitWindow,
} from "./rate-limit-config";

// RAZ-29 — Simple sliding-window rate limiter backed by Postgres.
//
// Why a log + count rather than an atomic counter:
//   * Postgres has no built-in bounded counter; adding one would need
//     an advisory-lock dance that's fiddly to get right.
//   * The call rates we're guarding are measured in single-digit QPS,
//     so two indexed `count(*)` scans per attempt are cheap (<1 ms
//     each against the bucket/key/created_at composite index).
//   * A log leaves us with data to audit abuse patterns later.
//
// Why a single bucket string rather than an enum:
//   * We'll add more rate-limited surfaces soon (sign-in, paste-
//     puzzle). Keeping `bucket` free-form means zero migrations.
//
// Error mode: on DB failure we FAIL OPEN. Blocking a user because the
// database blipped is worse UX than briefly letting a motivated
// scraper through. The Supabase dashboard alerts us to sustained DB
// errors long before they matter here.

export type RateLimitDecision =
  | { ok: true }
  | { ok: false; retryAfterMs: number; window: RateLimitWindow };

// Resolve an opaque "actor key" from the incoming request, preferring
// a stable user_id when the caller is signed in and falling back to an
// IP-derived hash when they're not.
//
// Why hash the IP rather than store it raw: (1) GDPR-nicer — the raw
// IP isn't written to a durable log; (2) prevents the rate-limit
// table from doubling as an IP dossier for every visitor who ever
// clicked Hint.
//
// The hash is truncated to 16 hex chars (~64 bits). Collision risk
// across the visitor population is negligible for rate-limit purposes
// and the shorter string keeps the index compact.
export async function rateLimitActorKey(userId: string | null): Promise<string> {
  if (userId) return `u:${userId}`;
  const h = await headers();
  const xff = h.get("x-forwarded-for") ?? "";
  // x-forwarded-for can be a comma-separated chain "client, proxy1,
  // proxy2". The leftmost entry is the original client per RFC 7239.
  const ip = xff.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
  const hash = createHash("sha256").update(ip).digest("hex").slice(0, 16);
  return `ip:${hash}`;
}

// Check every configured window. Returns the first ok:false we see,
// or ok:true if the caller is under every limit.
//
// Does NOT record the current attempt — callers should call
// `recordRateLimitEvent` after they've decided the request was
// legitimate (i.e. after all validation). That split means a 400-level
// validation error doesn't consume the caller's quota.
export async function checkRateLimit(
  bucket: string,
  key: string,
  windows: RateLimitWindow[],
): Promise<RateLimitDecision> {
  try {
    for (const w of windows) {
      const since = new Date(Date.now() - w.windowMs);
      const rows = await db
        .select({ n: count() })
        .from(rateLimitEvents)
        .where(
          and(
            eq(rateLimitEvents.bucket, bucket),
            eq(rateLimitEvents.key, key),
            gte(rateLimitEvents.createdAt, since),
          ),
        );
      const n = rows[0]?.n ?? 0;
      if (n >= w.max) {
        // Conservative retry: we don't know exactly when the oldest
        // matching event will age out, so we tell the caller to wait
        // the full window. Honest and avoids a retry-storm of callers
        // polling once per second.
        return { ok: false, retryAfterMs: w.windowMs, window: w };
      }
    }
    return { ok: true };
  } catch {
    return { ok: true };
  }
}

// Record a successful call. Separate from `checkRateLimit` so a caller
// that decided NOT to honour the request (e.g. after a validation
// failure) doesn't charge the actor's quota.
export async function recordRateLimitEvent(bucket: string, key: string): Promise<void> {
  try {
    await db.insert(rateLimitEvents).values({ bucket, key });
  } catch {
    // Fail open — see module header. Worst case: this attempt doesn't
    // count toward future windows. That's a 1-call free pass, not an
    // integrity problem.
  }
}

