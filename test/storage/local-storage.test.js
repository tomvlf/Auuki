/*
 * local-storage.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * documents the expected behavior of the application and prevents regressions during development.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

/**
 * @jest-environment jsdom
 */

import { LocalStorageItem } from '../../src/storage/local-storage.js';

class LocalStorageMock {
    constructor() {
        this.store = {};
    }

    clear() {
        this.store = {};
    }

    getItem(key) {
        return this.store[key] || null;
    }

    setItem(key, value) {
        this.store[key] = String(value);
    }

    removeItem(key) {
        delete this.store[key];
    }
}

describe('LocalStorageItem', () => {

    // global.localStorage = new LocalStorageMock();

    global.console = {
        log: jest.fn(),
        error: console.error,
        warn: jest.fn(),
    };

    const ftp = LocalStorageItem({
        key: 'ftp',
        fallback: 200,
        parse: parseInt,
        isValid: (x => x > 20 && x <= 600)
    });

    test('set', async () => {
        let resSet = await ftp.set(250);

        expect(resSet).toStrictEqual(250);
        // expect(resSet).toStrictEqual({key: 'ftp', value: 250});
    });

    test('get', async () => {
        let resGet = await ftp.get();

        expect(resGet).toBe(250);
    });

    test('restore', async () => {
        let resRestore = await ftp.restore();

        expect(resRestore).toStrictEqual(250);
    });

    test('remove', async () => {
        let resRemove = await ftp.remove();

        expect(resRemove).toBe(undefined);

        let resGet = await ftp.get();

        expect(resGet).toBe(200);
    });

    test('get unset value returns fallback', async () => {
        let resGet = await ftp.get();

        expect(resGet).toBe(200);
    });

    test('restore unset value returns fallback', async () => {
        let resRestore = await ftp.restore();

        expect(resRestore).toStrictEqual(200);
    });

    test('set invalid value sets fallback', async () => {
        let resSet = await ftp.set(0);

        expect(resSet).toStrictEqual(200);
        // expect(resSet).toStrictEqual({key: 'ftp', value: 200});
    });
});



// describe('', () => {
//     test('', () => {
//         expect().toBe();
//     });
// });
