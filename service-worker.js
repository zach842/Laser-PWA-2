const CACHE_NAME = "defender-pro-camera-pwa-v1";
const URLS_TO_CACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./main.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(URLS_TO_CACHE))
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    caches.match(event.request).then((resp) => resp || fetch(event.request))
  );
});
