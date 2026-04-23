import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";
import { sendPush, isWebPushConfigured } from "@/lib/server/push";

// RAZ-7: Vercel Cron handler — runs every hour. For each hour it
// finds all push subscriptions whose `notify_at` matches the
// current hour in the subscription's IANA timezone and sends a
// "Your daily puzzle is waiting!" notification.
//
// Design decisions:
//
// 1. We run every hour (not once at 09:00 UTC) so that users in
//    different timezones each get notified at their preferred local
//    hour. The WHERE clause asks Postgres to compute the local hour
//    for each row via `extract(hour from now() at time zone tz)`.
//
// 2. Expired/gone subscriptions (410) are deleted inline so the
//    table doesn't accumulate dead rows.
//
// 3. The cron is protected by a `CRON_SECRET` header so it can't
//    be hit by the public internet. Vercel injects this header
//    automatically for cron routes.

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes (Vercel limit for crons)

export async function GET(request: Request) {
  // Vercel cron auth: the `Authorization` header carries the
  // CRON_SECRET env var on Vercel production/preview. In local dev
  // we skip the check so you can curl it for testing.
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isWebPushConfigured()) {
    return NextResponse.json({ skipped: true, reason: "VAPID keys not configured" });
  }

  // Find subscriptions whose preferred notify_at hour matches the
  // current hour in their timezone. Postgres's `AT TIME ZONE`
  // handles DST transitions automatically.
  //
  // Example: if it's 14:00 UTC and a subscription has
  // notify_at = '09:00' and timezone = 'America/New_York' (UTC-5
  // in summer), the local time is 10:00 which doesn't match 09.
  // But at 13:00 UTC, local time is 09:00 → match.
  const rows = await db
    .select({
      id: pushSubscriptions.id,
      subJson: pushSubscriptions.subJson,
      userId: pushSubscriptions.userId,
    })
    .from(pushSubscriptions)
    .where(
      sql`${pushSubscriptions.notifyAt} = to_char(now() at time zone ${pushSubscriptions.timezone}, 'HH24:MI')`,
    );

  let sent = 0;
  let failed = 0;
  const expired: number[] = [];

  for (const row of rows) {
    const result = await sendPush(
      row.subJson as unknown as import("web-push").PushSubscription,
      {
        title: "Sudoku",
        body: "Your daily puzzle is waiting!",
        url: "/daily",
      },
    );

    if (result.ok) {
      sent++;
    } else {
      failed++;
      // 410 Gone = the subscription has expired or the user
      // revoked permission. Clean it up so we stop trying.
      if (result.statusCode === 410 || result.statusCode === 404) {
        expired.push(row.id);
      }
    }
  }

  // Batch-delete expired subscriptions.
  if (expired.length > 0) {
    await db
      .delete(pushSubscriptions)
      .where(sql`${pushSubscriptions.id} = any(${expired})`);
  }

  return NextResponse.json({
    ok: true,
    matched: rows.length,
    sent,
    failed,
    cleaned: expired.length,
  });
}
