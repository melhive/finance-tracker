// ---------------------------------------------------------------------------
// VAULT — Service Worker
//
// Bump CACHE_VERSION on every deploy. That's the ONLY line you need to
// change to ship an update — everything else (cache busting, cleanup,
// notifying the open app) happens automatically below.
// ---------------------------------------------------------------------------
const CACHE_VERSION = "v1.27.0";
const CACHE_NAME = `vault-cache-${CACHE_VERSION}`;

// Files that make up the app shell. Add new CSS/JS files here as they're
// created so they're available offline immediately after install.
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./js/app.js",
  "./js/crypto.js",
  "./js/photocrop.js",
  "./js/db.js",
  "./js/confirm.js",
  "./js/profiles.js",
  "./js/dashboard.js",
  "./js/security.js",
  "./js/stats.js",
  "./js/reports.js",
  "./js/budgets.js",
  "./js/categories.js",
  "./js/accounts.js",
  "./js/goals.js",
  "./js/debts.js",
  "./js/ledgerdetail.js",
  "./js/tags.js",
  "./js/recurring.js",
  "./js/backup.js",
  "./js/dedupe.js",
  "./js/browse.js",
  "./js/upcoming.js",
  "./js/swipe.js",
  "./js/csvimport.js",
  "./js/onboarding.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/logo-wordmark.svg",
  "./changelog.json"
];

// --- INSTALL ---------------------------------------------------------------
// Pre-cache the app shell as soon as the new service worker is downloaded.
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  // Full autoupdate: activate this version immediately, without waiting
  // for old tabs to close or for any user action. Combined with
  // clients.claim() below and the controllerchange-triggered reload in
  // app.js, an open tab picks up a new deploy on its own on next load.
  self.skipWaiting();
});

// --- ACTIVATE ----------------------------------------------------------------
// Delete any caches from previous versions so storage doesn't grow forever
// and stale files can never be served by accident.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("vault-cache-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// --- FETCH -------------------------------------------------------------------
// Cache-first for app shell files (instant offline load), falling back to
// network for anything not yet cached, and updating the cache in the
// background when a fresh copy is fetched (stale-while-revalidate-ish).
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline and not cached — nothing we can do

      return cached || networkFetch;
    })
  );
});
