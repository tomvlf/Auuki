const SETTINGS = ['ftp', 'weight', 'theme', 'dockMode', 'measurement', 'volume', 'dataTileSwitch'];

async function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open('store', 3);
        request.onsuccess = () => {
            const database = request.result;
            if(!['workouts', 'activity'].every(name => database.objectStoreNames.contains(name))) {
                database.close();
                reject(new Error('App data is not ready. Reload before backing up or restoring.'));
            } else resolve(database);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error('App storage is blocked by another tab.'));
    });
}

async function records(database, name) {
    return new Promise((resolve, reject) => {
        const transaction = database.transaction(name, 'readonly');
        const request = transaction.objectStore(name).getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = () => reject(transaction.error || new Error('Unable to read app data.'));
    });
}

function base64(bytes) {
    let text = '';
    for(let offset = 0; offset < bytes.length; offset += 8192) {
        text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    }
    return btoa(text);
}

export async function createBackup(library = []) {
    const database = await openDatabase();
    try {
        const [workouts, activityRecords] = await Promise.all([
            records(database, 'workouts'), records(database, 'activity'),
        ]);
        const activities = await Promise.all(activityRecords.map(async record => ({
            ...record, blob: base64(new Uint8Array(await record.blob.arrayBuffer())),
        })));
        const calendar = JSON.parse(window.localStorage.getItem('training-calendar') || '[]');
        if(!Array.isArray(calendar)) throw new Error('Stored training calendar must be an array.');
        // Built-in workout IDs are generated per browser load; retain scheduled copies.
        for(const entry of calendar) {
            const workout = library.find(w => String(w.id) === entry.workoutId);
            if(workout && !workouts.some(w => w.id === workout.id)) workouts.push(workout);
        }
        return {version: 1, savedAt: new Date().toISOString(), workouts, activities,
            settings: Object.fromEntries(SETTINGS.map(key => [key, window.localStorage.getItem(key)])),
            calendar};
    } finally { database.close(); }
}

export async function restoreBackup(backup) {
    if(backup?.version !== 1 || !Array.isArray(backup.workouts) || !Array.isArray(backup.activities) ||
       !Array.isArray(backup.calendar) || !backup.settings || typeof backup.settings !== 'object' ||
       Object.entries(backup.settings).some(([key, value]) => !SETTINGS.includes(key) ||
           (value !== null && typeof value !== 'string')) ||
       backup.workouts.some(w => !w?.id || !w.meta || !Array.isArray(w.intervals)) ||
       backup.calendar.some(e => !e?.id || !e.workoutId || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))) {
        throw new Error('Invalid server backup. No data was restored.');
    }
    const activities = backup.activities.map(record => {
        if(!record?.id || record.summary?.id !== record.id || typeof record.blob !== 'string') {
            throw new Error('Invalid activity in server backup.');
        }
        return {...record, blob: new Blob([Uint8Array.from(atob(record.blob), c => c.charCodeAt(0))],
            {type: 'application/octet-stream'})};
    });
    const database = await openDatabase();
    try {
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(['workouts', 'activity'], 'readwrite');
            transaction.oncomplete = resolve;
            transaction.onabort = () => reject(transaction.error || new Error('Restore failed.'));
            try {
                for(const workout of backup.workouts) transaction.objectStore('workouts').put(workout);
                for(const activity of activities) transaction.objectStore('activity').put(activity);
            } catch(error) {
                transaction.abort();
                reject(error);
            }
        });
        for(const [key, value] of Object.entries(backup.settings)) {
            if(value === null) window.localStorage.removeItem(key);
            else window.localStorage.setItem(key, value);
        }
        window.localStorage.setItem('training-calendar', JSON.stringify(backup.calendar));
    } finally { database.close(); }
}
