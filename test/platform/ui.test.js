/** @jest-environment jsdom */
import { launchPlatform } from '../../src/platform/ui.js';
import { xf } from '../../src/functions.js';
import { db } from '../../src/db.js';
import { serverRequest } from '../../src/server/client.js';
import { coachingData } from '../../src/coaching/service.js';
import { models } from '../../src/models/models.js';

jest.mock('../../src/index.js', () => {
    queueMicrotask(() => globalThis.window.dispatchEvent(new CustomEvent('app:ready')));
    return {};
});
jest.mock('../../src/db.js', () => ({db: {
    ftp: 250, weight: 75, elapsed: 0, lapTime: 60, power1s: 180, powerTarget: 200,
    cadence: 90, heartRate: 140, mode: 'erg', watchStatus: 'stopped', workoutStatus: 'stopped',
    intervalIndex: 0, stepIndex: 0, activity: [],
    workout: {id: 'ride', meta: {name: 'Session', duration: 120},
        intervals: [{duration: 60, steps: [{duration: 60, power: .8}]},
            {duration: 60, steps: [{duration: 60, power: 1.1}]}]},
    workouts: [{id: 'ride', meta: {name: 'Session', duration: 120, category: 'Endurance',
        description: '<script>not executable</script>'}, intervals: [{duration: 120, steps: [{duration: 120, power: .8}]}]}],
}}));
jest.mock('../../src/server/client.js', () => ({serverAccount: {}, serverRequest: jest.fn()}));
jest.mock('../../src/coaching/service.js', () => ({
    coachingData: jest.fn(), coachingService: () => ({data: {}, revision: 1}),
}));
jest.mock('../../src/models/models.js', () => ({models: {
    ftp: {toAbsolute: (value, ftp) => value < 9 ? Math.round(value * ftp) : value},
    api: {intervals: {getAthlete: jest.fn()}},
}}));
jest.mock('../../src/functions.js', () => {
    const actual = jest.requireActual('../../src/functions.js');
    return {...actual, xf: {...actual.xf, dispatch: jest.fn(actual.xf.dispatch)}};
});

const settle = async () => { for(let i = 0; i < 10; i++) await Promise.resolve(); };
const go = async route => {
    window.history.replaceState({}, '', `/#/${route}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    await settle();
};

test('desktop shell wires every screen to real data, workout commands, accessible controls and integration settings', async () => {
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden><training-calendar></training-calendar></div>';
    const calendar = document.querySelector('training-calendar');
    calendar.entriesForDate = () => [];
    calendar.plannedWorkouts = [];
    calendar.loadPlannedMonth = jest.fn().mockResolvedValue();
    const root = document.querySelector('#platform');
    coachingData.mockReturnValue({activities: [], plan: null, profile: null});
    serverRequest.mockResolvedValue({configured: true, connected: false, status: 'disconnected'});
    await launchPlatform(root, {email: 'rider@example.com'});
    await settle();
    expect(root.textContent).toContain('Your next ride starts here.');
    expect(root.querySelector('[aria-current="page"]').textContent).toBe('Overview');
    expect(root.querySelector('.skip-link')).not.toBeNull();

    await go('plan');
    expect(root.textContent).toContain('Create your training plan');
    await go('activities');
    expect(root.textContent).toContain('Your rides will appear here');
    await go('progress');
    expect(root.textContent).toContain('No inferred fitness score');
    await go('calendar');
    expect(document.querySelector('.wrapper').hidden).toBe(false);
    expect(calendar.loadPlannedMonth).toHaveBeenCalled();
    await go('coach');
    expect(root.textContent).toContain('normalized activity history');
    await go('devices');
    expect(root.textContent).toContain('BLE / ANT+ engine');
    await go('editor');
    expect(document.body.dataset.route).toBe('editor');

    await go('library');
    expect(root.querySelector('.workout-card h2').textContent).toBe('Session');
    const search = root.querySelector('#workout-search');
    search.value = 'unmatched';
    search.dispatchEvent(new Event('input', {bubbles: true}));
    expect(root.textContent).toContain('No workouts match your search.');
    search.value = '';
    root.querySelector('#workout-search').value = '';
    root.querySelector('#workout-search').dispatchEvent(new Event('input', {bubbles: true}));
    await go('workout/ride');
    expect(root.textContent).toContain('<script>not executable</script>');
    expect(root.querySelector('script')).toBeNull();
    expect(root.textContent).toContain('200 W');
    const dispatch = xf.dispatch;
    dispatch.mockClear();
    root.querySelector('[data-action="prepare"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('workout', expect.objectContaining({id: 'ride'}));

    await go('player');
    expect(root.querySelector('#ride-power').textContent).toBe('180');
    expect(root.querySelector('#ride-next').textContent).toContain('275 W');
    expect(root.querySelector('#ride-progress').value).toBe(0);
    root.querySelector('[data-action="ride-toggle"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:watchStart');
    expect(dispatch).toHaveBeenCalledWith('ui:workoutStart');
    db.watchStatus = 'started';
    db.elapsed = 30;
    xf.dispatch('db:elapsed', db);
    expect(root.querySelector('#ride-progress').value).toBe(.25);
    expect(root.querySelector('#ride-toggle').textContent).toBe('Pause');
    root.querySelector('[data-action="ride-toggle"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:watchPause');
    db.watchStatus = 'paused';
    root.querySelector('[data-action="ride-toggle"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:watchResume');
    root.querySelector('[data-action="ride-skip"]').disabled = false;
    root.querySelector('[data-action="ride-skip"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:watchLap');
    root.querySelector('[data-action="target-up"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:power-target-inc');
    db.mode = 'resistance';
    root.querySelector('[data-action="target-down"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:resistance-target-dec');
    root.querySelector('[data-device="controllable"]').click();
    expect(dispatch).toHaveBeenCalledWith('ui:ble:controllable:switch');
    db.watchStatus = 'started';
    xf.dispatch('ble:controllable:disconnected');
    expect(root.querySelector('#platform-message').textContent).toContain('disconnected');
    expect(root.querySelector('[data-sensor="controllable"]').textContent).toBe('Disconnected');
    root.querySelector('[data-action="logout"]').click();
    await settle();
    expect(root.querySelector('#platform-message').textContent).toContain('Finish your current ride');

    await go('settings');
    await settle();
    const form = root.querySelector('#intervals-connect');
    form.elements.apiKey.value = 'server-only-key';
    form.elements.oldest.value = '2026-01-01';
    serverRequest.mockResolvedValueOnce({configured: true, connected: true, status: 'connected', lastSuccess: null});
    form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    await settle();
    expect(serverRequest).toHaveBeenCalledWith('integrations/intervals', {method: 'PUT',
        body: {apiKey: 'server-only-key', oldest: '2026-01-01'}});
    expect(root.innerHTML).not.toContain('server-only-key');
    expect(root.textContent).toContain('Import history');
    const profile = root.querySelector('#profile-form');
    profile.elements.ftp.value = '270';
    profile.elements.weight.value = '74';
    profile.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:ftp-set', 270);
    expect(dispatch).toHaveBeenCalledWith('ui:weight-set', 74);
    db.watchStatus = 'stopped';
    models.api.intervals.getAthlete.mockResolvedValueOnce({ftp: 280, weight: 73});
    root.querySelector('[data-action="import-profile"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:ftp-set', 280);
    expect(dispatch).toHaveBeenCalledWith('ui:weight-set', 73);
});
