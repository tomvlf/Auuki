/*
 * account.test.js: test coverage module.
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

/** @jest-environment jsdom */
import { accountDatabase, accountKey, accountStorage, setAccountScope } from '../../src/storage/account.js';
import { LocalStorageItem } from '../../src/storage/local-storage.js';

test('account-scoped settings and databases cannot bleed between signed-in accounts or legacy local mode', () => {
    localStorage.clear();
    localStorage.setItem('ftp', '999');
    const ftp = LocalStorageItem({key: 'ftp', fallback: '200'});
    setAccountScope('alice@example.com');
    expect(ftp.get()).toBe('200');
    ftp.set('250');
    accountStorage.setItem('training-calendar', '[1]');
    const aliceDatabase = accountDatabase();
    expect(accountKey('ftp')).toContain('alice%40example.com');
    setAccountScope('bob@example.com');
    expect(ftp.get()).toBe('200');
    expect(accountStorage.getItem('training-calendar')).toBeNull();
    expect(accountDatabase()).not.toBe(aliceDatabase);
    ftp.set('300');
    setAccountScope('alice@example.com');
    expect(ftp.get()).toBe('250');
    expect(accountStorage.getItem('training-calendar')).toBe('[1]');
    expect(localStorage.getItem('ftp')).toBe('999');
    accountStorage.removeItem('ftp');
    expect(ftp.get()).toBe('200');
    setAccountScope(null);
    expect(accountDatabase()).toBe('store');
    expect(ftp.get()).toBe('999');
});
