/*
 * ui.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
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
import { xf } from '../../src/functions.js';
import { db } from '../../src/db.js';
import { serverRequest } from '../../src/server/client.js';
import { coachingData } from '../../src/coaching/service.js';
import { normalizeActivity } from '../../src/coaching/normalizer.js';
import { models } from '../../src/models/models.js';
import { profile as coachingProfile } from '../coaching/fixtures.js';

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
    activity: {},
    api: {intervals: {getAthlete: jest.fn()}},
    workout: {readFromFile: jest.fn(), parse: jest.fn()},
    workouts: {save: jest.fn()},
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
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden><training-calendar></training-calendar><connection-switch></connection-switch></div>';
    const calendar = document.querySelector('training-calendar');
    calendar.entriesForDate = () => [];
    calendar.plannedWorkouts = [];
    calendar.loadPlannedMonth = jest.fn().mockResolvedValue();
    const root = document.querySelector('#platform');
    coachingData.mockReturnValue({activities: [], plan: null, profile: null});
    serverRequest.mockImplementation(path => Promise.resolve(path === 'health'
        ? {available: true, version: 'build-42.1', revision: '0123456789abcdef'}
        : {configured: true, connected: false, status: 'disconnected'}));
    await launchPlatform(root, {email: 'rider@example.com'});
    await settle();
    expect(root.querySelector('[data-frontend-version]').textContent).toBe('development');
    expect(root.querySelector('[data-backend-version]').textContent).toBe('build-42.1 (0123456789ab)');
    expect(root.textContent).toContain('Your next ride starts here.');
    expect(root.querySelector('[aria-current="page"]').textContent).toBe('Overview');
    expect(root.querySelector('.skip-link')).not.toBeNull();
    root.querySelector('.skip-link').click();
    expect(document.activeElement.id).toBe('main-content');
    const connection = document.querySelector('connection-switch');
    const activate = jest.fn();
    connection.addEventListener('pointerup', activate);
    connection.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
    expect(connection.getAttribute('role')).toBe('button');
    expect(connection.tabIndex).toBe(0);
    expect(activate).toHaveBeenCalledTimes(1);

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
    expect(root.querySelector('.library-layout').firstElementChild.matches('aside.library-filters')).toBe(true);
    expect(root.querySelector('#workout-search').closest('aside')).not.toBeNull();
    expect(root.querySelector('.workout-card a').getAttribute('href')).toBe('#/workout/ride');
    const search = root.querySelector('#workout-search');
    search.value = 'unmatched';
    search.dispatchEvent(new Event('input', {bubbles: true}));
    expect(root.textContent).toContain('No workouts match your search.');
    expect(document.activeElement.id).toBe('workout-search');
    search.value = '';
    root.querySelector('#workout-search').value = '';
    root.querySelector('#workout-search').dispatchEvent(new Event('input', {bubbles: true}));

    db.workouts.push(
        {id: 'long', meta: {name: 'Long ride', category: 'Endurance', duration: 4000},
            intervals: [{steps: [{duration: 4000, power: .6}]}]},
        {id: 'course', meta: {name: 'Hill course', category: 'Course', distance: 12000},
            points: [{x: 0, y: 10}, {x: 12000, y: 300}]},
    );
    xf.dispatch('db:workouts', db);
    const change = (id, value) => {
        const field = root.querySelector(`#${id}`);
        field.value = value;
        field.dispatchEvent(new Event('change', {bubbles: true}));
        expect(document.activeElement.id).toBe(id);
    };
    change('workout-category', 'Endurance');
    change('workout-duration', 'long');
    expect([...root.querySelectorAll('.workout-card h2')].map(element => element.textContent)).toEqual(['Long ride']);
    change('workout-type', 'course');
    expect(root.textContent).toContain('No workouts match your search.');
    root.querySelector('[data-library-reset]').click();
    expect(document.activeElement.id).toBe('workout-search');
    expect(root.querySelectorAll('.workout-card')).toHaveLength(3);
    change('workout-sort', 'name');
    expect([...root.querySelectorAll('.workout-card h2')].map(element => element.textContent))
        .toEqual(['Hill course', 'Long ride', 'Session']);
    change('workout-type', 'course');
    expect(root.querySelector('[aria-label="Course elevation profile"]')).not.toBeNull();
    await go('dashboard');
    await go('library');
    expect(root.querySelector('#workout-type').value).toBe('course');
    expect(root.querySelectorAll('.workout-card')).toHaveLength(1);
    root.querySelector('[data-library-reset]').click();

    const files = [new File(['first'], 'first.zwo'), new File(['second'], 'second.zwo')];
    models.workout.readFromFile.mockImplementation(async file => ({result: file.name, name: file.name}));
    models.workout.parse.mockImplementation((result, name) => ({
        id: name, meta: {name, category: 'Imported', duration: 600},
        intervals: [{steps: [{duration: 600, power: .5}]}],
    }));
    models.workouts.save.mockResolvedValueOnce().mockRejectedValueOnce(new Error('Device storage is full.'));
    const upload = root.querySelector('#platform-upload');
    Object.defineProperty(upload, 'files', {value: files});
    xf.dispatch.mockClear();
    upload.dispatchEvent(new Event('change', {bubbles: true}));
    await settle();
    expect(models.workouts.save).toHaveBeenCalledTimes(2);
    expect(xf.dispatch).toHaveBeenCalledWith('db:workouts', db);
    expect(root.textContent).toContain('first.zwo');
    expect(root.textContent).not.toContain('second.zwo');
    expect(root.querySelector('#platform-message').getAttribute('role')).toBe('alert');
    expect(root.querySelector('#platform-message').textContent).toBe('Device storage is full.');
    db.workouts = db.workouts.filter(workout => workout.id === 'ride');
    xf.dispatch('db:workouts', db);
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
    db.connectedDevices = {};
    db.sources = {power: 'ble:controllable'};
    xf.dispatch('db:power1s', db);
    expect(root.querySelector('#ride-power').textContent).toBe('--');
    db.connectedDevices['ble:controllable'] = true;
    xf.dispatch('db:power1s', db);
    expect(root.querySelector('#ride-power').textContent).toBe('180');
    delete db.connectedDevices;
    delete db.sources;
    expect(root.querySelector('#ride-next').textContent).toContain('275 W');
    expect(root.querySelector('#ride-progress').value).toBe(0);
    root.querySelector('[data-action="ride-toggle"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:watchStart');
    expect(dispatch).toHaveBeenCalledWith('ui:workoutStart');
    db.watchStatus = 'started';
    db.workoutStatus = 'started';
    db.elapsed = 30;
    db.lapTime = 30;
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
    db.intervalIndex = 1;
    db.lapTime = 60;
    xf.dispatch('db:intervalIndex', db);
    expect(root.querySelector('#ride-progress').value).toBe(.5);
    expect(root.querySelector('#ride-remaining').textContent).toBe('1:00 remaining');
    root.querySelector('[data-action="target-up"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:power-target-inc');
    db.mode = 'resistance';
    root.querySelector('[data-action="target-down"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:resistance-target-dec');
    root.querySelector('[data-device="controllable"]').click();
    expect(dispatch).toHaveBeenCalledWith('ui:ble:controllable:switch');
    xf.dispatch('ble:controllable:connected');
    expect(dispatch).toHaveBeenCalledWith('sources', {
        control: 'ble:controllable', power: 'ble:controllable',
        cadence: 'ble:controllable', speed: 'ble:controllable',
    });
    dispatch.mockClear();
    xf.dispatch('ble:controllable:connected');
    expect(dispatch).not.toHaveBeenCalledWith('sources', expect.anything());
    db.watchStatus = 'started';
    xf.dispatch('ble:controllable:disconnected');
    expect(root.querySelector('#platform-message').textContent).toContain('disconnected');
    expect(root.querySelector('[data-sensor="controllable"]').textContent).toBe('Disconnected');
    root.querySelector('[data-action="logout"]').click();
    await settle();
    expect(root.querySelector('#platform-message').textContent).toContain('Finish your current ride');
    models.activity.pendingRecording = {id: 'failed'};
    xf.dispatch('activity:save:fail');
    expect(root.querySelector('#ride-unsaved').hidden).toBe(false);
    expect(root.querySelector('#ride-toggle').disabled).toBe(true);
    root.querySelector('[data-action="recover-save"]').click();
    await settle();
    expect(dispatch).toHaveBeenCalledWith('ui:activity:retry-save');
    models.activity.pendingRecording = null;

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
    db.activity = [{id: 'pending', name: 'Local recording', duration: 60, pendingSync: true}];
    await go('activities');
    expect(root.textContent).toContain('Awaiting server synchronization');
    expect(root.querySelector('[data-action="retry-rides"]')).not.toBeNull();
    expect(root.querySelector('[data-download="pending"]')).not.toBeNull();

    const profileData = {...coachingProfile, timeZone: 'UTC'};
    const synced = normalizeActivity({
        id: 'synced', name: 'Synchronized ride', start: new Date().toISOString(), duration: 1800,
        distance: 12000, normalizedPower: 210, averagePower: 190, averageHeartRate: 140, rpe: 6,
    }, profileData);
    db.activity = [
        {id: 'synced', name: 'Synchronized ride', duration: 1800, timestamp: Date.now(),
            powerProfile: [120, 200, 240], ftp: 250, pendingSync: true},
        {id: 'pending', name: 'Pending ride', duration: 600, timestamp: Date.now(),
            powerProfile: [100, 150, 200], pendingSync: true},
    ];
    coachingData.mockReturnValue({activities: [synced], plan: null, profile: profileData});
    xf.dispatch('coaching:changed');
    await settle();
    const week = root.querySelector('[aria-label="This week activity totals"]');
    const rideCount = [...week.querySelectorAll('dt')].find(item => item.textContent === 'Rides').nextElementSibling;
    expect(rideCount.textContent).toBe('2');
    expect(root.querySelectorAll('.power-profile--recorded')).toHaveLength(2);
    expect(root.querySelector('.activity-history').textContent).toContain('RPE 6');
    expect(root.querySelector('[aria-label="Current training load"]')).not.toBeNull();
    expect(root.querySelectorAll('[data-download="synced"]')).toHaveLength(1);
    expect(root.querySelector('[data-download="pending"]')).not.toBeNull();
    models.activity.download = jest.fn().mockResolvedValue();
    root.querySelector('[data-download="synced"]').click();
    await settle();
    expect(models.activity.download).toHaveBeenCalledWith('synced');

    coachingData.mockReturnValue({activities: [], plan: null, profile: null});
    xf.dispatch('coaching:changed');
    expect(root.querySelector('[aria-label="Current training load"]')).toBeNull();
    coachingData.mockReturnValue({activities: [synced], plan: null, profile: profileData});
    xf.dispatch('coaching:changed');
    coachingData.mockReturnValue({activities: [], plan: null, profile: null});
    xf.dispatch('coaching:changed');
    await settle();
    expect(root.querySelector('[aria-label="Current training load"]')).toBeNull();
});
