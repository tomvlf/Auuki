import { IDBFactory } from 'fake-indexeddb';
import { profile, goal } from '../coaching/fixtures.js';

beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    Object.defineProperty(window, 'indexedDB', {value: new IDBFactory(), configurable: true});
    global.fetch = jest.fn(() => Promise.reject(new Error('No server')));
});

test('coaching always persists locally regardless of obsolete account settings', async () => {
    localStorage.setItem('athlima-server-mode', '1');
    let service = require('../../src/coaching/service.js');
    const [first, second] = await Promise.all([service.initializeCoaching(), service.initializeCoaching()]);
    expect(first).toBe(second);
    await first.configure(profile, goal);
    jest.resetModules();
    service = require('../../src/coaching/service.js');
    await service.initializeCoaching();
    expect(service.coachingData().profile).toEqual(profile);
    expect(service.coachingService().data.goal).toEqual(goal);
    expect(fetch).not.toHaveBeenCalled();
});
