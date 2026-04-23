"use client";

// RAZ-7: Push notification opt-in toggle for the profile edit page.
//
// Lifecycle:
// 1. On mount, checks if the browser supports push + if there's an
//    existing PushSubscription.
// 2. When the user toggles ON:
//    a. Registers the service worker at /sw.js.
//    b. Requests notification permission (browser prompt).
//    c. Subscribes via PushManager with the VAPID public key.
//    d. Sends the subscription to the server action.
// 3. When the user toggles OFF:
//    a. Unsubscribes the PushSubscription client-side.
//    b. Calls the server action to delete server-side rows.
//
// We read the VAPID public key from the NEXT_PUBLIC_ env var
// so it's available at build time (no extra fetch needed).

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  subscribePushAction,
  unsubscribePushAction,
} from "@/lib/server/actions";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/** Convert a base64 URL-safe string to Uint8Array (for PushManager). */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

export function PushToggle() {
  const [isSupported, setIsSupported] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isPending, startTransition] = useTransition();

  // On mount: detect support + existing subscription.
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (!VAPID_PUBLIC_KEY) return;
    setIsSupported(true);

    navigator.serviceWorker
      .getRegistration("/sw.js")
      .then((reg) => reg?.pushManager.getSubscription())
      .then((sub) => {
        if (sub) setIsSubscribed(true);
      })
      .catch(() => {});
  }, []);

  if (!isSupported) return null;

  const toggle = () => {
    startTransition(async () => {
      if (isSubscribed) {
        // Unsubscribe
        try {
          const reg = await navigator.serviceWorker.getRegistration("/sw.js");
          const sub = await reg?.pushManager.getSubscription();
          await sub?.unsubscribe();
        } catch {
          // Best-effort client-side cleanup.
        }
        await unsubscribePushAction();
        setIsSubscribed(false);
        toast.success("Daily reminders turned off.");
      } else {
        // Subscribe
        try {
          const permission = await Notification.requestPermission();
          if (permission !== "granted") {
            toast.error("Notification permission denied by the browser.");
            return;
          }

          const reg = await navigator.serviceWorker.register("/sw.js", {
            scope: "/",
          });
          // Wait for the SW to be ready before subscribing.
          await navigator.serviceWorker.ready;

          const sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
          });

          const json = sub.toJSON();
          const res = await subscribePushAction({
            subscription: {
              endpoint: json.endpoint!,
              keys: {
                p256dh: json.keys!.p256dh!,
                auth: json.keys!.auth!,
              },
            },
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            notifyAt: "09:00",
          });

          if (res.ok) {
            setIsSubscribed(true);
            toast.success("Daily reminders enabled at 9:00 AM local time.");
          } else {
            toast.error("Could not save subscription.");
          }
        } catch (err) {
          console.error("Push subscribe error", err);
          toast.error("Could not enable push notifications.");
        }
      }
    });
  };

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        {isSubscribed ? (
          <Bell className="h-5 w-5 text-primary" />
        ) : (
          <BellOff className="h-5 w-5 text-muted-foreground" />
        )}
        <div>
          <p className="text-sm font-medium">Daily reminders</p>
          <p className="text-xs text-muted-foreground">
            {isSubscribed
              ? "You'll get a push at 9:00 AM local time."
              : "Get a daily push notification to remind you to play."}
          </p>
        </div>
      </div>
      <Button
        size="sm"
        variant={isSubscribed ? "outline" : "default"}
        onClick={toggle}
        disabled={isPending}
      >
        {isPending ? "..." : isSubscribed ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}
