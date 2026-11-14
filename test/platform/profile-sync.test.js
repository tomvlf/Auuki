/** @jest-environment jsdom */
jest.mock('../../src/index.js', () => {
    queueMicrotask(() => globalThis.window.dispatchEvent(new CustomEvent('app:ready')));
    return {};
});
jest.mock('../../src/models/intervals.js', () => {
    const actual = jest.requireActual('../../src/models/intervals.js');
    return {__esModule: true, default: {...actual.default, sync: jest.fn().mockResolvedValue()}};
});
jest.mock('../../src/coaching/service.js', () => {
    const service = {data: {activities: []}, advance: jest.fn().mockResolvedValue()};
    return {coachingData: () => ({activities: [], profile: null, plan: null}),
        coachingService: () => service, initializeCoaching: jest.fn()};
});

afterEach(() => { jest.useRealTimers(); });

test('startup waits for provider profile, locks all controls and rejects local events until disconnect', async () => {
    jest.useFakeTimers({doNotFake: ['queueMicrotask']});
    const {launchPlatform} = require('../../src/platform/ui.js');
    const {db} = require('../../src/db.js');
    const {xf} = require('../../src/functions.js');
    const intervals = require('../../src/models/intervals.js').default;
    localStorage.setItem('athlima-intervals-v1', JSON.stringify({
        apiKey: 'test-key', athleteId: '123', oldest: '2026-01-01',
    }));
    window.history.replaceState({}, '', '/#/settings');
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden><input effect="ftp-set"><button effect="ftp-set">Set</button><input effect="weight-set"><button effect="weight-set">Set</button></div>';
    const root = document.querySelector('#platform');
    let finishProfile;
    global.fetch = jest.fn(() => new Promise(resolve => { finishProfile = resolve; }));
    const launched = launchPlatform(root);
    for(let i = 0; i < 20; i++) await Promise.resolve();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('#profile-form')).toBeNull();
    expect(intervals.sync).not.toHaveBeenCalled();
    finishProfile({ok: true, json: async () => ({weight: 73.5, sportSettings: [{types: ['VirtualRide'], indoor_ftp: 600}]})});
    await launched;
    for(let i = 0; i < 20; i++) await Promise.resolve();
    expect(db.ftp).toBe(600);
    expect(db.weight).toBe(73.5);
    expect(localStorage.getItem('ftp')).toBe('600');
    expect(localStorage.getItem('weight')).toBe('73.5');
    expect(root.querySelector('[name="ftp"]').disabled).toBe(true);
    expect(root.querySelector('[name="weight"]').disabled).toBe(true);
    expect(root.querySelector('[name="ftp"]').value).toBe('600');
    expect(root.querySelector('[name="weight"]').value).toBe('73.5');
    for(const control of root.querySelectorAll('[effect="ftp-set"], [effect="weight-set"]')) {
        expect(control.disabled).toBe(true);
    }
    xf.dispatch('ui:ftp-set', 250);
    xf.dispatch('ui:weight-set', 80);
    expect(db.ftp).toBe(600);
    expect(db.weight).toBe(73.5);
    fetch.mockResolvedValueOnce({ok: true, json: async () => ({weight: 0, sportSettings: [{types: ['Ride'], ftp: 300}]})});
    await expect(intervals.syncProfile()).rejects.toThrow('valid cycling FTP and body mass');
    expect(db.ftp).toBe(600);
    expect(db.weight).toBe(73.5);
    expect(root.querySelector('[name="ftp"]').disabled).toBe(true);
    expect(root.querySelector('[name="weight"]').disabled).toBe(true);
    intervals.disconnect();
    xf.dispatch('ui:ftp-set', 250);
    xf.dispatch('ui:weight-set', 80);
    expect(db.ftp).toBe(250);
    expect(db.weight).toBe(80);
    for(const control of root.querySelectorAll('[effect="ftp-set"], [effect="weight-set"]')) {
        expect(control.disabled).toBe(false);
    }
});
