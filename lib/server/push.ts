import "server-only";
import webPush from "web-push";

// RAZ-7: Web Push helpers.
//
// VAPID (Voluntary Application Server Identification) is the
// authentication mechanism that lets our server send push
// messages through browser push services (FCM, Mozilla, Apple)
// without per-browser API keys.
//
// The key pair is generated once (via `web-push generate-vapid-keys`)
// and stored in env vars. The public key is shared with the client
// (PushManager.subscribe needs it); the private key never leaves
// the server.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:hello@example.com";

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
}

/**
 * Send a push notification to a single subscription. Returns true on
 * success, false on failure (e.g. expired subscription). The caller
 * should delete subscriptions that return false with a 410 status.
 */
export async function sendPush(
  subJson: webPush.PushSubscription,
  payload: PushPayload,
): Promise<{ ok: boolean; statusCode?: number }> {
  try {
    const res = await webPush.sendNotification(
      subJson,
      JSON.stringify(payload),
      { TTL: 60 * 60 }, // 1 hour TTL
    );
    return { ok: true, statusCode: res.statusCode };
  } catch (err: unknown) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err
        ? (err as { statusCode: number }).statusCode
        : undefined;
    return { ok: false, statusCode };
  }
}

/** Whether VAPID keys are configured. If not, the feature is inert. */
export function isWebPushConfigured(): boolean {
  return VAPID_PUBLIC_KEY.length > 0 && VAPID_PRIVATE_KEY.length > 0;
}
