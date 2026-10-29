/* Inkshelf service worker: app shell works offline, covers are kept, data always comes fresh. */
const SHELL = "inkshelf-shell-v1";
const COVERS = "inkshelf-covers-v1";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png", "./favicon-64.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, COVERS].includes(k)).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

async function trimCovers() {
  const c = await caches.open(COVERS);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - 400))) await c.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Pages: network first so updates show at once, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((r) => {
          const copy = r.clone();
          caches.open(SHELL).then((c) => c.put("./index.html", copy));
          return r;
        })
        .catch(() => caches.match("./index.html").then((r) => r || caches.match("./")))
    );
    return;
  }

  // Covers: cache first, kept for offline.
  const isCover = (url.pathname.endsWith("/functions/v1/inkshelf") && url.searchParams.get("action") === "cover") || url.pathname.includes("/storage/v1/object/public/covers/");
  if (isCover) {
    e.respondWith(
      caches.open(COVERS).then((c) =>
        c.match(req).then(
          (hit) =>
            hit ||
            fetch(req).then((r) => {
              if (r.ok || r.type === "opaque") {
                c.put(req, r.clone());
                trimCovers();
              }
              return r;
            })
        )
      )
    );
    return;
  }

  // Own files, fonts and the sync library: serve cached, refresh in the background.
  const same = url.origin === location.origin;
  if (same || /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname) || /cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(
      caches.open(SHELL).then((c) =>
        c.match(req).then((hit) => {
          const net = fetch(req)
            .then((r) => {
              if (r.ok || r.type === "opaque") c.put(req, r.clone());
              return r;
            })
            .catch(() => hit);
          return hit || net;
        })
      )
    );
  }
  // Everything else (search, sync, latest chapters) goes straight to the network.
});
