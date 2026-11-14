/*
 * backup.js: browser-local backup and restore.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
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

import { CoachingService } from '../coaching/service.js';
import { openCoachingStorage } from '../coaching/storage.js';

const SETTINGS = ['ftp', 'weight', 'theme', 'dockMode', 'measurement', 'volume', 'dataTileSwitch'];

async function openDatabase() {
    return new Promise((resolve, reject) => {
        const request = window.indexedDB.open(accountDatabase(), 3);
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
        const calendar = JSON.parse(accountStorage.getItem('training-calendar') || '[]');
        const planned = JSON.parse(accountStorage.getItem('planned') || '{"workouts":[],"modified":{}}');
        if(!Array.isArray(calendar)) throw new Error('Stored training calendar must be an array.');
        // Built-in workout IDs are generated per browser load; retain scheduled copies.
        for(const entry of calendar) {
            const workout = library.find(w => String(w.id) === entry.workoutId);
            if(workout && !workouts.some(w => w.id === workout.id)) workouts.push(workout);
        }
        const storage = await openCoachingStorage(window.indexedDB);
        let coaching;
        try { coaching = new CoachingService(storage).data; }
        finally { storage.close(); }
        return {version: 2, savedAt: new Date().toISOString(), workouts, activities, coaching,
            settings: Object.fromEntries(SETTINGS.map(key => [key, accountStorage.getItem(key)])),
            calendar, planned};
    } finally { database.close(); }
}

export async function restoreBackup(backup) {
    if(![1, 2].includes(backup?.version) || !Array.isArray(backup.workouts) || !Array.isArray(backup.activities) ||
       !Array.isArray(backup.calendar) || !backup.settings || typeof backup.settings !== 'object' ||
       Object.entries(backup.settings).some(([key, value]) => !SETTINGS.includes(key) ||
           (value !== null && typeof value !== 'string')) ||
       backup.workouts.some(w => !w?.id || !w.meta || !Array.isArray(w.intervals)) ||
       backup.calendar.some(e => !e?.id || !e.workoutId || !/^\d{4}-\d{2}-\d{2}$/.test(e.date))) {
        throw new Error('Invalid local backup. No data was restored.');
    }
    if(backup.version === 2) {
        if(!backup.coaching || typeof backup.coaching !== 'object') throw new Error('Invalid coaching backup.');
        new CoachingService({getItem: () => JSON.stringify(backup.coaching)});
        if(backup.planned && (!Array.isArray(backup.planned.workouts) ||
            backup.planned.workouts.some(workout => !workout?.id || !workout.meta || !Array.isArray(workout.intervals)))) {
            throw new Error('Invalid planned workout backup.');
        }
    }
    const activities = backup.activities.map(record => {
        if(!record?.id || record.summary?.id !== record.id || typeof record.blob !== 'string') {
            throw new Error('Invalid activity in local backup.');
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
            if(value === null) accountStorage.removeItem(key);
            else accountStorage.setItem(key, value);
        }
        accountStorage.setItem('training-calendar', JSON.stringify(backup.calendar));
        if(backup.planned) accountStorage.setItem('planned', JSON.stringify(backup.planned));
        if(backup.version === 2) {
            const storage = await openCoachingStorage(window.indexedDB);
            try { await storage.setItem('athlima-coaching-v1', JSON.stringify(backup.coaching)); }
            catch(error) {
                throw new Error(`Files and settings were restored, but coaching could not be restored. Retry: ${error.message}`);
            } finally { storage.close(); }
        }
    } finally { database.close(); }
}
import { accountDatabase, accountStorage } from '../storage/account.js';
