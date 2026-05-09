// RAZ-7: Serves the push notification service worker at /sw.js.
//
// Service workers MUST be served from the root scope (or higher) to
// control the full origin. Next.js App Router doesn't have a public/
// directory in this project, so we use a route handler that returns
// JavaScript with the correct MIME type and a long cache + SW
// update headers.
//
// The actual SW code now handles two concerns:
// 1) push notifications (RAZ-7),
// 2) navigation fallback for offline PWA/TWA sessions (RAZ-85).

const SW_SOURCE = /* js */ `
// Sudoku service worker (RAZ-7 + RAZ-85 + RAZ-106).
//
// v2 changes (RAZ-106):
//   - Cache name bumped to "sudoku-shell-v2"; activate handler deletes v1.
//   - /play/offline shell is pre-cached alongside /offline so the player
//     can start a new puzzle even when fully offline.
//   - Fetch handler routes /play/* navigations to /play/offline when
//     network is unavailable, giving players a smooth offline start.
//   - Background Sync handler posts DRAIN_COMPLETION_QUEUE to the active
//     window so queued offline completions are submitted as soon as the
//     device reconnects (even if no tab was open during the sync).
const CACHE_NAME = "sudoku-shell-v2";
const OFFLINE_URL = "/offline";
const OFFLINE_PLAY_URL = "/play/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // Pre-cache both fallback pages. /play/offline must be cached for the
      // /play/* → offline-play routing to work when there is no network.
      .then((cache) => cache.addAll([OFFLINE_URL, OFFLINE_PLAY_URL]))
      .catch(() => {}),
  );
  // Skip waiting so v2 activates immediately on the next page load rather
  // than waiting for all v1-controlled tabs to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Delete old shell caches (v1 and any other sudoku-shell-* variants)
    // so stale assets don't accumulate.
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("sudoku-shell-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME);
      // RAZ-106: route /play/* to the offline play shell so the player can
      // pick up a puzzle from IndexedDB instead of seeing a generic error.
      const url = new URL(event.request.url);
      if (url.pathname.startsWith("/play")) {
        return (await cache.match(OFFLINE_PLAY_URL)) || Response.error();
      }
      return (await cache.match(OFFLINE_URL)) || Response.error();
    }),
  );
});

// RAZ-106: Background Sync. When the device reconnects after being offline,
// the browser fires a "sync" event for any tag registered via
// registration.sync.register(). We forward it as a message to the active
// window so the in-page drainCompletionQueue() can submit queued solves.
// If no window is open the message is simply not delivered; the next page
// load will drain via the online event listener in providers.tsx.
self.addEventListener("sync", (event) => {
  if (event.tag !== "drain-completions") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          c.postMessage({ type: "DRAIN_COMPLETION_QUEUE" });
        }
      }),
  );
});

self.addEventListener("push", (event) => {
  const fallback = { title: "Sudoku", body: "Your daily puzzle is waiting!", url: "/daily" };
  let data = fallback;
  try {
    data = Object.assign(fallback, event.data?.json());
  } catch {
    // If the payload isn't valid JSON, fall back to defaults.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icons/192.png",
      badge: "/icons/192.png",
      data: { url: data.url },
    }),
  );
});

// When the user taps the notification, focus an existing tab or
// open a new one pointing at the daily puzzle page.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/daily";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      return clients.openWindow(url);
    }),
  );
});
`;

export async function GET() {
  return new Response(SW_SOURCE, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // SW spec: the browser re-fetches the SW periodically. A short
      // max-age lets us roll out fixes within an hour while still
      // avoiding a fetch on every page load.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      // Scope the worker to the root so it can handle navigation
      // fallback and notification deep-links app-wide.
      "Service-Worker-Allowed": "/",
    },
  });
}
