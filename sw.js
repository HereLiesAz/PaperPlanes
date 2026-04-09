const CACHE_NAME = 'paper-planes-v2';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './manifest.json'
];

self.addEventListener('install', event => {
    // Force the waiting service worker to become the active service worker
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
});

self.addEventListener('activate', event => {
    // Purge the obsolete timelines
    event.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
            );
        })
    );
    // Claim the clients immediately so the browser doesn't need a reload to see the new worker
    return self.clients.claim();
});

self.addEventListener('fetch', event => {
    // Network-First strategy. 
    // Ask the server for the newest reality. If the server is dead, fall back to the cache.
    if (event.request.url.startsWith(self.location.origin)) {
        event.respondWith(
            fetch(event.request)
                .then(fetchRes => {
                    return caches.open(CACHE_NAME).then(cache => {
                        cache.put(event.request.url, fetchRes.clone());
                        return fetchRes;
                    });
                })
                .catch(() => {
                    return caches.match(event.request);
                })
        );
    }
});
