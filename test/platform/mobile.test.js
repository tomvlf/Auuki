/** @jest-environment jsdom */
import { launchPlatform } from '../../src/platform/ui.js';
import { xf } from '../../src/functions.js';
import { db } from '../../src/db.js';

jest.mock('../../src/index.js', () => {
    queueMicrotask(() => globalThis.window.dispatchEvent(new CustomEvent('app:ready')));
    return {};
});
jest.mock('../../src/db.js', () => ({db: {
    ftp: 250, weight: 75, elapsed: 90, lapTime: 30, intervalIndex: 0, stepIndex: 0,
    power1s: 200, powerTarget: 200, heartRate: 145, cadence: 85,
    mode: 'erg', watchStatus: 'paused', activity: [], workouts: [],
    workout: {meta: {name: 'Recovered ride', duration: 600}, intervals: [{steps: [{duration: 600, power: .8}]}]},
}}));
jest.mock('../../src/server/client.js', () => ({
    serverAccount: {}, serverRequest: jest.fn().mockResolvedValue({configured: false, connected: false}),
}));
jest.mock('../../src/coaching/service.js', () => ({
    coachingData: () => ({activities: [], profile: null, plan: null}), coachingService: () => ({data: {}, revision: 0}),
}));
jest.mock('../../src/models/models.js', () => ({models: {ftp: {toAbsolute: (v, ftp) => v * ftp}}}));
jest.mock('../../src/functions.js', () => {
    const actual = jest.requireActual('../../src/functions.js');
    return {...actual, xf: {...actual.xf, dispatch: jest.fn(actual.xf.dispatch)}};
});

test('mobile has a dedicated ride-first navigation, recovered ride controls, glanceable metrics and finish summary', async () => {
    window.history.replaceState({}, '', '/mobile');
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden><training-calendar></training-calendar></div>';
    const calendar = document.querySelector('training-calendar');
    calendar.entriesForDate = () => [];
    calendar.loadPlannedMonth = jest.fn();
    const root = document.querySelector('#platform');
    await launchPlatform(root, {email: 'rider@example.com'});
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(document.body.classList.contains('mobile-app')).toBe(true);
    expect(root.querySelector('nav').textContent).not.toContain('Progress');
    expect(root.querySelector('nav').textContent).not.toContain('Training calendar');
    expect(document.body.dataset.route).toBe('player');
    expect(root.textContent).toContain('Ride recovered on this device');
    for(const id of ['power', 'target', 'cadence', 'hr', 'elapsed', 'countdown', 'next', 'remaining']) {
        expect(root.querySelector(`#ride-${id}`)).not.toBeNull();
    }
    expect(root.querySelector('#ride-toggle').textContent).toBe('Resume');
    const dispatch = xf.dispatch;
    dispatch.mockClear();
    root.querySelector('[data-action="ride-finish"]').click();
    await Promise.resolve();
    expect(dispatch).toHaveBeenCalledWith('ui:watchStop');
    xf.dispatch('activity:save:success', {id: 'saved', duration: 90, averagePower: 200, averageHeartRate: 145});
    await new Promise(resolve => setTimeout(resolve, 5));
    expect(document.body.dataset.route).toBe('activities');
    expect(root.textContent).toContain('Ride saved');
    expect(root.textContent).toContain('1:30');
    expect(root.textContent).toContain('200W');
    db.elapsed = 0;
});
