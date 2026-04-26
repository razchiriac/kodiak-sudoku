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
// Sudoku service worker (RAZ-7 + RAZ-85).
const OFFLINE_URL = "/offline";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open("sudoku-shell-v1")
      .then((cache) => cache.addAll([OFFLINE_URL]))
      .catch(() => {}),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  if (event.request.mode !== "navigate") return;
  event.respondWith(
    fetch(event.request).catch(async () => {
      const cache = await caches.open("sudoku-shell-v1");
      return (await cache.match(OFFLINE_URL)) || Response.error();
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
