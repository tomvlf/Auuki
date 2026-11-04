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
