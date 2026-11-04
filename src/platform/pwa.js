/*
 * pwa.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

export async function registerPwa() {
    if(!('serviceWorker' in navigator) || (typeof module !== 'undefined' && module.hot)) return;
    try {
        const registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), {
            type: 'module', scope: '/',
        });
        await navigator.serviceWorker.ready;
        const worker = registration.active;
        if(worker) worker.postMessage({type: 'CACHE_ASSETS', urls: performance.getEntriesByType('resource').map(entry => entry.name)});
    } catch(error) {
        window.dispatchEvent(new CustomEvent('pwa:error', {detail: `Offline app caching is unavailable: ${error.message}`}));
    }
}
