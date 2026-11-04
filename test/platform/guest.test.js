/*
 * guest.test.js: test coverage module.
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
import { launchPlatform } from '../../src/platform/ui.js';
import { serverRequest } from '../../src/server/client.js';
import { coachingService } from '../../src/coaching/service.js';
import { xf } from '../../src/functions.js';

jest.mock('../../src/index.js', () => {
    queueMicrotask(() => globalThis.window.dispatchEvent(new CustomEvent('app:ready')));
    return {};
});
jest.mock('../../src/db.js', () => ({db: {
    ftp: 250, weight: 75, elapsed: 0, lapTime: 0, intervalIndex: 0, stepIndex: 0,
    power1s: 0, powerTarget: 200, heartRate: 0, cadence: 0, mode: 'erg',
    watchStatus: 'stopped', activity: [{id: 'original-ride', name: 'Original FIT ride', duration: 600}],
    workout: {meta: {name: 'Free ride'}, intervals: []},
    workouts: [{id: 'local', meta: {name: 'Local workout', duration: 600}, intervals: []}],
}}));
jest.mock('../../src/server/client.js', () => ({serverAccount: {}, serverRequest: jest.fn()}));
jest.mock('../../src/coaching/service.js', () => ({
    coachingData: () => ({activities: [], profile: null, plan: null}),
    coachingService: jest.fn(() => ({advance: jest.fn().mockResolvedValue()})),
}));
jest.mock('../../src/models/models.js', () => ({models: {ftp: {toAbsolute: (v, ftp) => v * ftp}}}));
jest.mock('../../src/functions.js', () => {
    const actual = jest.requireActual('../../src/functions.js');
    return {...actual, xf: {...actual.xf, dispatch: jest.fn(actual.xf.dispatch)}};
});

const settle = async () => { for(let i = 0; i < 15; i++) await Promise.resolve(); };
const go = async route => {
    window.history.replaceState({}, '', `/mobile#/${route}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
};

test('mobile guests can ride, browse workouts, configure devices and use local coaching without server calls', async () => {
    window.history.replaceState({}, '', '/mobile');
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden><training-calendar></training-calendar></div>';
    const calendar = document.querySelector('training-calendar');
    calendar.entriesForDate = () => [];
    calendar.plannedWorkouts = [];
    calendar.loadPlannedMonth = jest.fn();
    const root = document.querySelector('#platform');
    await launchPlatform(root, null);
    await settle();
    expect(root.textContent).toContain('Guest / on-device only');
    expect(root.querySelector('[data-action="signin"]')).not.toBeNull();
    expect(root.querySelector('#platform-content a[href="#/library"]')).not.toBeNull();
    await go('library');
    expect(root.textContent).toContain('Local workout');
    expect(root.querySelector('#platform-upload')).not.toBeNull();
    await go('calendar');
    expect(document.querySelector('.wrapper').hidden).toBe(false);
    await go('coach');
    expect(root.textContent).toContain('on-device Coach');
    await go('devices');
    expect(root.textContent).toContain('BLE / ANT+');
    await go('settings');
    expect(root.textContent).toContain('stored only on this device');
    expect(root.textContent).toContain('Guest data is kept separately');
    expect(root.querySelector('#profile-form')).not.toBeNull();
    expect(root.querySelector('#intervals-connect')).toBeNull();
    expect(root.querySelector('[data-action="backup"]')).toBeNull();
    expect(root.querySelector('#delete-account')).toBeNull();
    await go('player');
    root.querySelector('[data-action="ride-toggle"]').click();
    await settle();
    expect(xf.dispatch).toHaveBeenCalledWith('ui:watchStart');
    expect(xf.dispatch).toHaveBeenCalledWith('ui:workoutStart');
    xf.dispatch('activity:save:success', {id: 'local-ride', duration: 60});
    await go('activities');
    expect(root.textContent).toContain('No account or upload is required');
    expect(root.textContent).toContain('Original FIT ride');
    expect(root.querySelector('[data-download="original-ride"]')).not.toBeNull();
    await go('dashboard');
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(coachingService).toHaveBeenCalled();
    expect(serverRequest).not.toHaveBeenCalled();
});
