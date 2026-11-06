/** @jest-environment jsdom */

import {
    activityLists, historyActivityRow, localActivityRow, renderActivityOverview,
    renderActivityStreamData, summarizeActivityPeriods,
} from '../../src/platform/activities.js';

const ride = (id, day, overrides = {}) => ({
    id, day, start: `${day}T12:00:00Z`, name: id, sport: 'cycling', source: 'manual',
    duration: 3600, distance: 10000, loadMetrics: {power: {value: 50}}, streams: {},
    ...overrides,
});
const data = activities => ({activities, profile: {timeZone: 'UTC'}});
const date = Date.parse('2026-03-01T18:00:00Z');
const metric = (section, label) => {
    const term = [...section.querySelectorAll('dt')].find(item => item.textContent === label);
    return term?.nextElementSibling.textContent;
};

test('summarizes Monday-start weeks and calendar months without double-counting local rides', () => {
    const history = [
        ride('previous', '2026-02-25'),
        ride('synced', '2026-03-01', {duration: 1800, distance: 5000, loadMetrics: {power: {value: 25}}}),
        ride('older', '2026-02-22'),
        ride('future', '2026-03-02'),
    ];
    const local = [
        {id: 'synced', pendingSync: true, powerProfile: [100, 200]},
        {id: 'pending', pendingSync: true, timestamp: Date.parse('2026-03-01T10:00:00Z'),
            duration: 600, distance: null, powerProfile: [120, 180]},
        {id: 'cached', timestamp: Date.parse('2026-02-28T10:00:00Z'), duration: 300, distance: 2000},
        {id: 'undated', pendingSync: true, duration: 200},
    ];
    const lists = activityLists(data(history), local, false);
    expect(lists.history).toHaveLength(4);
    expect(lists.pending.map(item => item.id)).toEqual(['pending', 'undated']);
    expect(lists.cached.map(item => item.id)).toEqual(['cached']);
    expect(lists.localById.get('synced').powerProfile).toEqual([100, 200]);
    expect(activityLists(data(history), local, true).cached).toHaveLength(0);

    const totals = summarizeActivityPeriods(lists, {day: '2026-03-01', timeZone: 'UTC'});
    expect(totals.week).toEqual({
        count: 4, duration: {value: 6300, complete: true},
        distance: {value: 17000, complete: false}, load: {value: 75, complete: false},
    });
    expect(totals.month).toEqual({
        count: 2, duration: {value: 2400, complete: true},
        distance: {value: 5000, complete: false}, load: {value: 25, complete: false},
    });
    expect(totals.undated).toBe(1);

    const root = document.createElement('div');
    root.innerHTML = renderActivityOverview(data(history), lists, {
        date: '2026-03-01', loadSource: 'power', chronicLoad: 26, acuteLoad: 7, formBalance: 19, rampRate: -3.6,
    }, date);
    const week = root.querySelector('[aria-label="This week activity totals"]');
    const month = root.querySelector('[aria-label="This month activity totals"]');
    expect(metric(week, 'Activities')).toBe('4');
    expect(metric(week, 'Time')).toBe('1h 45m');
    expect(metric(week, 'Known distance')).toBe('17 km');
    expect(metric(week, 'Known power load')).toBe('75');
    expect(metric(month, 'Activities')).toBe('2');
    expect(metric(month, 'Time')).toBe('40m');
    expect(root.textContent).toContain('1 undated activity is excluded');
    expect(root.textContent).toContain('Device-only rides are not included in the model');
    expect(root.querySelector('[aria-label="Current training load"]').textContent).toContain('Fitness 26');
});

test('uses available local measurements to fill missing values in the matching history ride', () => {
    const activity = ride('saved', '2026-03-01', {
        distance: null, averagePower: null, averageHeartRate: null, ftp: null,
    });
    const lists = activityLists(data([activity]), [{
        id: 'saved', distance: 12500, averagePower: 190, averageHeartRate: 140, ftp: 250,
    }], true);
    expect(lists.history[0]).toMatchObject({distance: 12500, averagePower: 190, averageHeartRate: 140, ftp: 250});
    expect(activity.distance).toBeNull();
    expect(lists.cached).toHaveLength(0);
});

test('uses the rider timezone for device recordings at a month boundary', () => {
    const local = [{id: 'local', timestamp: Date.parse('2026-03-01T00:30:00Z'), duration: 600}];
    const lists = activityLists(data([]), local, false);
    const totals = summarizeActivityPeriods(lists, {day: '2026-03-01', timeZone: 'America/Los_Angeles'});
    expect(totals.week.count).toBe(1);
    expect(totals.month.count).toBe(0);
});

test('uses the recorded start rather than the save time for a ride crossing midnight', () => {
    const local = [{id: 'local', start: '2026-02-28T23:30:00Z',
        timestamp: Date.parse('2026-03-01T00:30:00Z'), duration: 3600}];
    const totals = summarizeActivityPeriods(activityLists(data([]), local, false),
        {day: '2026-03-01', timeZone: 'UTC'});
    expect(totals.week.count).toBe(1);
    expect(totals.month.count).toBe(0);
});

test('uses one load scale, identifies missing values, and does not invent totals when history is unavailable', () => {
    const activities = [
        ride('rpe', '2026-03-01', {distance: null, loadMetrics: {
            power: {value: 80}, sessionRpe: {value: 120},
        }}),
        ride('power-only', '2026-03-01', {distance: null, loadMetrics: {power: {value: 80}}}),
    ];
    const lists = activityLists(data(activities), [], true);
    const root = document.createElement('div');
    root.innerHTML = renderActivityOverview(data(activities), lists, {
        date: '2026-03-01', loadSource: 'sessionRpe',
        chronicLoad: 2, acuteLoad: 4, formBalance: -2, rampRate: 1,
    }, date);
    const week = root.querySelector('[aria-label="This week activity totals"]');
    expect(metric(week, 'Known distance')).toBe('--');
    expect(metric(week, 'Known session RPE load')).toBe('120');
    expect(root.textContent).not.toContain('240');

    const rpeOnly = [ride('rpe-only', '2026-03-01', {loadMetrics: {sessionRpe: {value: 120}}})];
    root.innerHTML = renderActivityOverview(data(rpeOnly), activityLists(data(rpeOnly), [], true), null, date);
    expect(metric(root.querySelector('[aria-label="This week activity totals"]'), 'Session RPE load')).toBe('120');

    root.innerHTML = renderActivityOverview(null, activityLists(null, [], true), null, date);
    expect(root.textContent).toContain('history is unavailable');
    expect(root.querySelector('.activity-period')).toBeNull();
    root.innerHTML = renderActivityOverview(data([]), activityLists(data([]), [], true), null, date);
    expect(metric(root.querySelector('[aria-label="This week activity totals"]'), 'Activities')).toBe('0');
    expect(root.querySelector('[aria-label="Current training load"]')).toBeNull();
});

test('renders real profiles, safe labels, feedback, and retained FIT actions in list rows', () => {
    const activity = ride('ride" onmouseover="bad', '2026-03-01', {
        name: '<img src=x onerror=bad>', source: '<script>bad</script>',
        duration: 600, averagePower: 200, averageHeartRate: 140,
        loadMetrics: {power: {value: 33.25}}, rpe: 6,
    });
    const local = {powerProfile: [100, 180, 230], ftp: 250};
    const root = document.createElement('div');
    root.innerHTML = `<table><tbody>${historyActivityRow(activity, local, true)}</tbody></table>
        <ul>${localActivityRow({...local, id: 'pending', name: 'Pending ride', duration: 600,
        timestamp: date, pendingSync: true}, 'UTC')}</ul>`;
    expect(root.querySelectorAll('.power-profile--recorded')).toHaveLength(2);
    expect(root.querySelector('.activity-title strong').textContent).toBe(activity.name);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(root.querySelector('[data-download]').dataset.download).toBe(activity.id);
    expect(root.querySelector('[data-upload-ride]').dataset.uploadRide).toBe(activity.id);
    expect(root.textContent).toContain(`Power load ${(33.25).toLocaleString(undefined, {maximumFractionDigits: 1})} / RPE 6`);
    expect(root.querySelector('[data-download="pending"]')).not.toBeNull();
    expect(root.querySelector('[data-delete-ride="pending"]')).not.toBeNull();
    expect(root.querySelector('tr [data-delete-ride]')).toBeNull();

    root.innerHTML = `<table><tbody>${historyActivityRow({...activity, streams: {power: [100]}}, null, false)}</tbody></table>`;
    expect(root.querySelector('.power-profile--recorded')).toBeNull();
    expect(root.textContent).toContain('No recorded power profile');
    expect(root.querySelector('[data-upload-ride]')).toBeNull();
    root.innerHTML = `<table><tbody>${historyActivityRow({...activity, source: 'athlima'}, null, false)}</tbody></table>`;
    expect(root.querySelector('[data-delete-ride]').dataset.deleteRide).toBe(activity.id);
});

test('does not display training-state values from another day', () => {
    const activities = [ride('today', '2026-03-01')];
    const root = document.createElement('div');
    root.innerHTML = renderActivityOverview(data(activities), activityLists(data(activities), [], true), {
        date: '2026-02-28', loadSource: 'power',
        chronicLoad: 99, acuteLoad: 99, formBalance: 0, rampRate: 0,
    }, date);
    expect(root.querySelector('[aria-label="Current training load"]')).toBeNull();
});

test('includes every sport in totals and shows type icons and all imported metrics', () => {
    const activities = [
        ride('ride', '2026-03-01', {activityType: 'GravelRide', powerProfile: [150, 220, 180]}),
        ride('run', '2026-03-01', {sport: 'running', activityType: 'TrailRun', distance: 8000,
            movingTime: 2400, maximumHeartRate: 181, loadMetrics: {},
            details: {trainingLoad: 61, calories: 640, description: '<b>Hills</b>',
                heartRateZoneTimes: [600, 1200], gear: 'Trail shoes'}}),
    ];
    const lists = activityLists(data(activities), [], true);
    expect(summarizeActivityPeriods(lists, {day: '2026-03-01', timeZone: 'UTC'}).week.count).toBe(2);

    const root = document.createElement('div');
    root.innerHTML = `<table><tbody>${lists.history.map(item => historyActivityRow(item, null, false)).join('')}</tbody></table>`;
    const [gravel, run] = root.querySelectorAll('tr');
    expect(gravel.querySelector('.activity-icon--cycling')).not.toBeNull();
    expect(gravel.querySelector('.activity-type').getAttribute('aria-label')).toBe('Gravel ride');
    expect(gravel.querySelector('.power-profile--recorded')).not.toBeNull();
    expect(run.querySelector('.activity-icon--running')).not.toBeNull();
    expect(run.textContent).toContain('Trail run');
    const details = run.querySelector('details.activity-details');
    expect(details.querySelector('b')).toBeNull();
    expect(details.textContent).toContain('<b>Hills</b>');
    const value = label => [...details.querySelectorAll('dt')].find(term => term.textContent === label)?.nextElementSibling.textContent;
    expect(value('Training load (Intervals)')).toBe('61');
    expect(value('Max heart rate')).toBe('181 bpm');
    expect(value('Pace')).toBe('5:00 /km');
    expect(value('Heart-rate zones')).toBe('Z1 10:00 · Z2 20:00');
    expect(value('Gear')).toBe('Trail shoes');
});

test('offers on-demand route and renders full-resolution stream previews', () => {
    const activity = ride('intervals:i123', '2026-03-01', {
        source: 'intervals', externalId: 'i123',
    });
    const row = document.createElement('table');
    row.innerHTML = `<tbody>${historyActivityRow(activity, null, true)}</tbody>`;
    expect(row.querySelector('[data-load-activity]').dataset.loadActivity).toBe('i123');
    expect(row.querySelector('.activity-stream-panel').hidden).toBe(true);

    const root = document.createElement('div');
    root.innerHTML = renderActivityStreamData({
        streams: {watts: [100, 200, null, 300], heartrate: [120, 130, 140, 150],
            cadence: [80, 82, 84, 86]},
        map: {latlngs: [[52.1, 5.1], [52.2, 5.2], [52.15, 5.3]]},
    });
    expect(root.querySelector('.activity-route path').getAttribute('d')).toMatch(/^M /);
    expect(root.querySelectorAll('.activity-stream-chart')).toHaveLength(3);
    expect(root.textContent).toContain('4 samples');
    expect(root.querySelector('[data-download-activity-csv]')).not.toBeNull();
    expect(renderActivityStreamData({streams: {}, map: null})).toContain('No route is available');
});
