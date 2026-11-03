// Separate from the seven-item FIT activity cache: coaching history must not be evicted with it.
export async function openCoachingStorage(indexedDB) {
    const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('auuki-coaching', 1);
        request.onupgradeneeded = () => request.result.createObjectStore('state');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('Coaching storage is blocked by another browser tab.'));
    });
    database.onversionchange = () => database.close();
    const key = 'auuki-coaching-v1';
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
