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
