/**
 * @jest-environment jsdom
 */

import { idb } from '../../src/storage/idb.js';
import indexedDB from 'fake-indexeddb';
import { serialize, deserialize } from 'node:v8';

window.indexedDB = indexedDB;
if(!globalThis.structuredClone) {
    globalThis.structuredClone = value => deserialize(serialize(value));
}

describe('IDB', () => {

    global.console = {
        log: jest.fn(),
        error: console.error,
        warn: console.warn,
    };

    const values = [
        {id: '{1ec38b5c-9a08-48e0-c000-09de191988b5}', one: 1},
        {id: '{1ec38b5c-9a08-48e0-c000-09de191988b4}', two: 2}
    ];

    const valuesUpdated = [
        {id: '{1ec38b5c-9a08-48e0-c000-09de191988b5}', zero: 0},
        {id: '{1ec38b5c-9a08-48e0-c000-09de191988b4}', two: 2}
    ];

    test('open', async () => {
        let resOpen = await idb.open('store', 1, ['numbers']);

        expect(resOpen.constructor.name).toBe('FDBDatabase'); // 'IDBDatabase'
        expect(resOpen.name).toBe('store');
        expect(Array.from(resOpen.objectStoreNames)).toStrictEqual(['numbers']);
    });

    test('add', async () => {
        let resAdd0 = await idb.add('numbers', idb.setId(values[0]));
        let resAdd1 = await idb.add('numbers', idb.setId(values[1]));

        expect(resAdd0).toBe('{1ec38b5c-9a08-48e0-c000-09de191988b5}');
        expect(resAdd1).toBe( '{1ec38b5c-9a08-48e0-c000-09de191988b4}');
    });

    test('get', async () => {
        let resGet = await idb.get('numbers', '{1ec38b5c-9a08-48e0-c000-09de191988b5}');

        expect(resGet).toStrictEqual(values[0]);
    });

    test('getAll', async () => {
        const value = {
            id: '{1ec38b5c-9a08-48e0-c000-09de191988b5}',
            one: 1
        };
        let resGetAll = await idb.getAll('numbers');

        expect(resGetAll.reverse()).toEqual(values);
    });

    test('put', async () => {
        let resPut0 = await idb.put('numbers', idb.setId(valuesUpdated[0]));

        expect(resPut0).toBe('{1ec38b5c-9a08-48e0-c000-09de191988b5}');

        let resGetAll = await idb.getAll('numbers');

        expect(resGetAll.reverse()).toEqual(valuesUpdated);
    });

    test('remove', async () => {
        let resRemove = await idb.remove('numbers', valuesUpdated[0].id);

        expect(resRemove).toBe(undefined);

        let resGetAll = await idb.getAll('numbers');

        expect(resGetAll.reverse()).toEqual([valuesUpdated[1]]);
    });

    test('clear', async () => {
        let resClear = await idb.clear('numbers');

        expect(resClear).toBe(undefined);

        let resGetAll = await idb.getAll('numbers');

        expect(resGetAll).toEqual([]);
    });

    test('checked writes commit recording and cleared checkpoint atomically', async () => {
        await idb.open('recording-atomic', 1, ['activity', 'session']);
        await idb.putChecked('session', {id: 0, elapsed: 60});
        await idb.putManyChecked([
            ['activity', {id: 'ride', pendingSync: true}],
            ['session', {id: 0, elapsed: 0}],
        ]);
        expect(await idb.get('activity', 'ride')).toEqual({id: 'ride', pendingSync: true});
        expect(await idb.get('session', 0)).toEqual({id: 0, elapsed: 0});
    });

    test('a failed checkpoint write rolls back the recording instead of leaving duplicate recovery state', async () => {
        await idb.putChecked('session', {id: 0, elapsed: 90});
        await expect(idb.putManyChecked([
            ['activity', {id: 'not-committed'}],
            ['session', {id: 0, unsupported: () => {}}],
        ])).rejects.toThrow();
        expect(await idb.get('activity', 'not-committed')).toBeUndefined();
        expect(await idb.get('session', 0)).toEqual({id: 0, elapsed: 90});
    });
});



// describe('', () => {
//     test('', () => {
//         expect().toBe();
//     });
// });
