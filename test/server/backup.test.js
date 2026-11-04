/*
 * backup.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * provides the server-side API and integration logic that authenticates users and syncs external training data.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

/** @jest-environment node */
import { indexedDB } from 'fake-indexeddb';
import { Blob as NodeBlob } from 'node:buffer';
import { createBackup, restoreBackup } from '../../src/server/backup.js';

const workout = {id: 'custom-workout', meta: {name: 'My workout'}, intervals: []};
const calendar = [{id: 'entry', date: '2026-01-01', workoutId: workout.id, name: 'My workout'}];
let database;
const transaction = (callback, mode = 'readwrite') => new Promise((resolve, reject) => {
    const tx = database.transaction(['workouts', 'activity'], mode);
    callback(tx);
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error);
});

beforeAll(async () => {
    const values = new Map();
    global.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: key => values.delete(key),
        clear: () => values.clear(),
    };
    global.window = {indexedDB, localStorage: global.localStorage};
    global.Blob = NodeBlob;
    database = await new Promise((resolve, reject) => {
        const request = indexedDB.open('store', 3);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('workouts', {keyPath: 'id'});
            request.result.createObjectStore('activity', {keyPath: 'id'});
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
});
afterAll(() => {
    database.close();
    delete global.window;
    delete global.localStorage;
});
beforeEach(async () => {
    localStorage.clear();
    await transaction(tx => {
        tx.objectStore('workouts').clear();
        tx.objectStore('activity').clear();
    });
});

test('backups round-trip workouts, raw settings, calendar and exact FIT bytes without credentials', async () => {
    const bytes = Uint8Array.of(0, 1, 128, 255);
    await transaction(tx => {
        tx.objectStore('workouts').put(workout);
        tx.objectStore('activity').put({id: 'ride', summary: {id: 'ride'}, blob: new Blob([bytes])});
    });
    localStorage.setItem('ftp', '250');
    localStorage.setItem('training-calendar', JSON.stringify(calendar));
    localStorage.setItem('integration-token', 'not-uploaded');
    const backup = await createBackup();
    expect(backup.activities[0].blob).toBe(btoa(String.fromCharCode(...bytes)));
    expect(backup.workouts).toEqual([workout]);
    expect(backup.settings.ftp).toBe('250');
    expect(backup.settings['integration-token']).toBeUndefined();
    expect(backup.calendar).toEqual(calendar);
    await transaction(tx => tx.objectStore('workouts').clear());
    await restoreBackup(backup);
    expect(localStorage.getItem('ftp')).toBe('250');
    expect(JSON.parse(localStorage.getItem('training-calendar'))).toEqual(calendar);
    let restored;
    await transaction(tx => {
        const request = tx.objectStore('activity').get('ride');
        request.onsuccess = () => { restored = request.result; };
    }, 'readonly');
    expect(restored.id).toBe('ride');
    expect(restored.summary.id).toBe('ride');
    expect(new Uint8Array(await restored.blob.arrayBuffer())).toEqual(bytes);
    expect((await createBackup()).workouts).toEqual([workout]);
});

test('invalid backups fail before changing stored data', async () => {
    await transaction(tx => tx.objectStore('workouts').put(workout));
    const backup = await createBackup();
    await expect(restoreBackup({...backup, settings: {arbitrary: 'value'}})).rejects.toThrow('Invalid server backup');
    await expect(restoreBackup({...backup, activities: [{id: 'broken', blob: '!'}]})).rejects.toThrow('Invalid activity');
    expect((await createBackup()).workouts).toEqual([workout]);
});

test('calendar backups retain referenced built-in workout IDs across devices', async () => {
    localStorage.setItem('training-calendar', JSON.stringify(calendar));
    const backup = await createBackup([workout, {...workout, id: 'unused-built-in'}]);
    expect(backup.workouts).toEqual([workout]);
    await restoreBackup(backup);
    expect((await createBackup()).workouts).toEqual([workout]);
});

test('a failed restore transaction does not partially merge workouts', async () => {
    const backup = await createBackup();
    backup.workouts = [workout, {...workout, id: {invalid: 'indexedDB key'}}];
    await expect(restoreBackup(backup)).rejects.toThrow();
    expect((await createBackup()).workouts).toEqual([]);
});
