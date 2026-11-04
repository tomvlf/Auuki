/*
 * storage.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * models training load, planning logic, and adaptation rules used to generate and explain workouts.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

// Separate from the seven-item FIT activity cache: coaching history must not be evicted with it.
export async function openCoachingStorage(indexedDB) {
    const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('athlima-coaching', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Coaching storage is blocked by another browser tab.'));
    });
    database.onversionchange = () => database.close();
    const key = 'athlima-coaching-v1';
    const initial = await new Promise((resolve, reject) => {
        const transaction = database.transaction('state', 'readonly');
        const request = transaction.objectStore('state').get(key);
        transaction.oncomplete = () => resolve(request.result ?? null);
        transaction.onabort = () => reject(transaction.error || new Error('Coaching history could not be read.'));
    });
    let current = initial;
    return {
        getItem: () => current,
        setItem: (key, value) => new Promise((resolve, reject) => {
            const transaction = database.transaction('state', 'readwrite');
            const store = transaction.objectStore('state');
            let conflict = false;
            const request = store.get(key);
            request.onsuccess = () => {
                if((request.result ?? null) !== current) {
                    conflict = true;
                    transaction.abort();
                } else store.put(value, key);
            };
            transaction.oncomplete = () => { current = value; resolve(); };
            transaction.onabort = () => reject(conflict
                ? new Error('Coaching history changed in another tab. Reload before editing.')
                : transaction.error || new Error('Coaching changes could not be saved.'));
        }),
        close: () => database.close(),
    };
}
