const CACHE_NAME = "noise-heat-camera-v4";
const ASSETS = [
  "./",
  "./index.html",
  "./manifest.json",
  "./src/style.css",
  "./src/app.js",
  "./src/audio-meter.js",
  "./src/source-estimator.js",
  "./src/webgl-overlay.js",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
