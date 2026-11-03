const cacheName = 'auuki-shell-v1';
const isAsset = url => url.origin === self.location.origin &&
    !url.pathname.startsWith('/api/') && /\.(?:js|css|png|svg|webmanifest)$/.test(url.pathname);

self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(['/', '/mobile'])));
    // Updates wait for existing ride windows to close; never replace code mid-ride.
});

self.addEventListener('activate', event => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', event => {
    if(event.data?.type !== 'CACHE_ASSETS' || !Array.isArray(event.data.urls)) return;
    const urls = event.data.urls.filter(value => {
        try { return isAsset(new URL(value)); } catch { return false; }
    });
    event.waitUntil(caches.open(cacheName).then(async cache => {
        for(const url of urls) {
            if(!await cache.match(url)) {
                try { await cache.add(url); }
                catch { event.source?.postMessage({type: 'CACHE_ERROR'}); }
            }
        }
    }));
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if(event.request.method !== 'GET' || url.origin !== self.location.origin ||
       url.pathname.startsWith('/api/')) return;
    if(event.request.mode === 'navigate') {
        event.respondWith(fetch(event.request).then(async response => {
            if(response.ok) {
                const cache = await caches.open(cacheName);
                await cache.put(event.request, response.clone());
            }
            return response;
        }).catch(async () => (await caches.match(event.request)) ||
            (await caches.match('/')) || Response.error()));
    } else if(isAsset(url)) {
        event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(async response => {
            if(response.ok) {
                const cache = await caches.open(cacheName);
                await cache.put(event.request, response.clone());
            }
            return response;
        })));
    }
});
