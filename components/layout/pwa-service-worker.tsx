"use client";

import { useEffect } from "react";

// RAZ-85: global PWA/TWA service-worker registration.
//
// We already had a `/sw.js` worker route for push notifications, but it
// was only registered from the profile push-toggle flow. Android install
//ability and TWA behavior benefit from always having the worker
// registered on app load (offline shell, fetch fallback, faster warm
// startup), so this tiny zero-DOM effect registers the same worker for
// every visitor when supported.
//
// Guardrails:
// - No-op on unsupported browsers.
// - No-op when registration fails (we don't block rendering).
// - Scope remains `/` so the worker can handle navigation fallback.
export function PwaServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
  }, []);

  return null;
}
