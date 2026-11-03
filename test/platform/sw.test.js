/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function worker() {
    const handlers = {};
    const cache = {addAll: jest.fn().mockResolvedValue(), match: jest.fn().mockResolvedValue(null),
        add: jest.fn().mockResolvedValue(), put: jest.fn().mockResolvedValue()};
    const context = {
        self: {location: {origin: 'https://cycling.example'}, clients: {claim: jest.fn().mockResolvedValue()},
            addEventListener: (event, handler) => { handlers[event] = handler; }},
        caches: {open: jest.fn().mockResolvedValue(cache), match: jest.fn().mockResolvedValue(null)},
        fetch: jest.fn(), URL, Response, console: {warn: jest.fn()},
    };
    runInNewContext(readFileSync('src/sw.js', 'utf8'), context);
    return {handlers, cache, ...context};
}

test('PWA installs the public desktop/mobile shell without interrupting existing rides', async () => {
    const w = worker();
    let work;
    w.handlers.install({waitUntil: promise => { work = promise; }});
    await work;
    expect(w.cache.addAll).toHaveBeenCalledWith(['/', '/mobile']);
    expect(w.self.skipWaiting).toBeUndefined();
    w.handlers.activate({waitUntil: promise => { work = promise; }});
    await work;
    expect(w.self.clients.claim).toHaveBeenCalled();
});

test.each([
    ['GET', 'https://cycling.example/api/server/coaching'],
    ['GET', 'https://cycling.example/api/server/session'],
    ['POST', 'https://cycling.example/api/server/login'],
    ['GET', 'https://third-party.example/workout.js'],
])('PWA never intercepts account data, mutations or third-party requests (%s %s)', (method, url) => {
    const w = worker();
    const respondWith = jest.fn();
    w.handlers.fetch({request: {method, url}, respondWith});
    expect(respondWith).not.toHaveBeenCalled();
});

test('PWA serves cached static assets without a network dependency during a ride', async () => {
    const w = worker();
    const cached = new Response('workout engine');
    w.caches.match.mockResolvedValue(cached);
    let response;
    w.handlers.fetch({request: {method: 'GET', url: 'https://cycling.example/engine.hash.js'},
        respondWith: promise => { response = promise; }});
    expect(await response).toBe(cached);
    expect(w.fetch).not.toHaveBeenCalled();
});

test('PWA navigation uses network first and public cached shell when offline', async () => {
    const w = worker();
    w.fetch.mockRejectedValue(new Error('Offline'));
    w.caches.match.mockResolvedValue(new Response('cached shell'));
    let response;
    w.handlers.fetch({request: {method: 'GET', mode: 'navigate', url: 'https://cycling.example/mobile'},
        respondWith: promise => { response = promise; }});
    expect(await (await response).text()).toBe('cached shell');
});

test('PWA cache warming excludes API credentials, external URLs and invalid requests', async () => {
    const w = worker();
    let work;
    w.handlers.message({data: {type: 'CACHE_ASSETS', urls: [
        'https://cycling.example/engine.hash.js', 'https://cycling.example/api/server/private.js',
        'https://third-party.example/script.js', 'not a URL',
    ]}, waitUntil: promise => { work = promise; }});
    await work;
    expect(w.cache.add).toHaveBeenCalledTimes(1);
    expect(w.cache.add).toHaveBeenCalledWith('https://cycling.example/engine.hash.js');
});

test.each(['navigate', undefined])('cache quota failures do not break a valid network response (%s)', async mode => {
    const w = worker();
    const network = new Response('fresh app');
    w.fetch.mockResolvedValue(network);
    w.cache.put.mockRejectedValue(new Error('Quota exceeded'));
    let response;
    w.handlers.fetch({request: {method: 'GET', mode, url: 'https://cycling.example/app.js'},
        respondWith: promise => { response = promise; }});
    expect(await response).toBe(network);
    expect(w.console.warn).toHaveBeenCalled();
});

test('unavailable cache reads fall back to the network for static assets', async () => {
    const w = worker();
    const network = new Response('fresh app');
    w.caches.match.mockRejectedValue(new Error('Storage disabled'));
    w.fetch.mockResolvedValue(network);
    let response;
    w.handlers.fetch({request: {method: 'GET', url: 'https://cycling.example/app.js'},
        respondWith: promise => { response = promise; }});
    expect(await response).toBe(network);
    expect(w.console.warn).toHaveBeenCalled();
});
