/*
 * training-calendar.test.js: test coverage module.
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

import { localDate, TrainingCalendar } from '../../src/views/training-calendar.js';
import { xf } from '../../src/functions.js';
import { setAccountScope } from '../../src/storage/account.js';
import { coachingData, coachingService } from '../../src/coaching/service.js';
import { normalizeActivity } from '../../src/coaching/normalizer.js';
import { estimateState } from '../../src/coaching/state.js';
import { profile } from '../coaching/fixtures.js';

jest.mock('../../src/coaching/service.js', () => ({
    coachingData: jest.fn(),
    coachingService: jest.fn(),
}));
jest.mock('../../src/coaching/state.js', () => ({
    estimateState: jest.fn(),
}));

describe('training calendar', () => {
    function createCalendar(workouts = []) {
        const calendar = new TrainingCalendar();
        calendar.displayMonth = new Date(2026, 10, 1);
        calendar.selectedDate = '2026-11-03';
        calendar.entries = [];
        calendar.workouts = workouts;
        calendar.plannedWorkouts = [];
        calendar.watchStatus = 'stopped';
        calendar.storageError = '';
        calendar.actionMessage = '';
        calendar.render();
        return calendar;
    }

    function schedule(calendar, workoutId) {
        const form = calendar.querySelector('.training-calendar--form');
        form.elements.workout.value = workoutId;
        calendar.onSubmit({
            target: form,
            preventDefault: jest.fn(),
        });
    }

    beforeEach(() => {
        window.localStorage.clear();
        setAccountScope(null);
        coachingData.mockReset().mockReturnValue(null);
        coachingService.mockReset();
        estimateState.mockReset();
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    test('formats local dates without shifting to the previous day', () => {
        expect(localDate(2024, 1, 29)).toBe('2024-02-29');
    });

    test('defaults to a multi-week calendar with Monday-to-Sunday rows and weekly totals', () => {
        const calendar = createCalendar();
        calendar.plannedWorkouts = [{
            id: 'threshold-1',
            meta: {name: 'Threshold', startDateLocal: '2026-11-03', duration: 900},
            intervals: [{steps: [{duration: 900, power: 0.9}]}],
        }];

        calendar.render();

        expect(calendar.view).toBe('month');
        expect([...calendar.querySelectorAll('thead th')].map(cell => cell.textContent.trim()))
            .toEqual(['Week', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
        const rows = [...calendar.querySelectorAll('tbody tr')];
        expect(rows).toHaveLength(6);
        expect(rows.map(row => row.dataset.weekStart)).toEqual([
            '2026-11-30', '2026-11-23', '2026-11-16',
            '2026-11-09', '2026-11-02', '2026-10-26',
        ]);
        expect(rows.every(row => row.querySelectorAll('td').length === 7)).toBe(true);
        expect(rows.every(row => row.querySelector('.training-calendar--week-summary'))).toBe(true);
        const day = calendar.querySelector('.calendar-day--select[data-date="2026-11-03"]').closest('td');
        expect(day.textContent).toContain('Threshold');
        expect(day.textContent).toContain('15 min');
        expect(day.querySelector('.power-profile--target')).not.toBeNull();
        expect(calendar.querySelector('button figure, button button')).toBeNull();
        expect(calendar.querySelector('[data-action="week"]')).not.toBeNull();
    });

    test('calculates week dates across a year boundary', () => {
        const calendar = createCalendar();
        calendar.selectedDate = '2027-01-01';

        expect(calendar.weekDates()).toEqual([
            '2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31',
            '2027-01-01', '2027-01-02', '2027-01-03',
        ]);
    });

    test('shows a locally recorded ride and actual power profile in its calendar day', () => {
        const calendar = createCalendar();
        calendar.localActivities = [{
            id: 'ride-local',
            start: new Date(2026, 10, 3, 23, 30).toISOString(),
            timestamp: new Date(2026, 10, 4, 0, 30).getTime(),
            name: 'Evening ride',
            duration: 3600,
            distance: 30000,
            averagePower: 175,
            powerProfile: [100, 150, 200],
        }];

        calendar.render();

        const day = calendar.querySelector('.calendar-day--select[data-date="2026-11-03"]').closest('td');
        expect(day.textContent).toContain('Evening ride');
        expect(day.textContent).toContain('60 min');
        expect(day.textContent).toContain('30.0 km');
        expect(day.textContent).toContain('175 W');
        expect(day.querySelector('.power-profile--recorded')).not.toBeNull();
        const nextDay = calendar.querySelector('.calendar-day--select[data-date="2026-11-04"]').closest('td');
        expect(nextDay.textContent).not.toContain('Evening ride');
        const summary = day.closest('tr').querySelector('.training-calendar--week-summary');
        expect(summary.textContent).toMatch(/Activities\s*1/);
        expect(summary.textContent).toMatch(/Time\s*1h 0m/);
        expect(summary.textContent).toMatch(/Distance\s*30.0 km/);
    });

    test('renders leap-year dates and adjacent-month dates in complete weeks', () => {
        const calendar = new TrainingCalendar();
        calendar.displayMonth = new Date(2024, 1, 1);
        calendar.selectedDate = '2024-02-29';
        calendar.entries = [];

        const container = document.createElement('div');
        container.innerHTML = calendar.renderMonth();

        const dates = [...container.querySelectorAll('.calendar-day--select')]
            .map((day) => day.dataset.date);
        expect(dates).toHaveLength(35);
        expect(calendar.monthDates()[0]).toBe('2024-01-29');
        expect(calendar.monthDates().at(-1)).toBe('2024-03-03');
        expect(container.querySelector('.calendar-day--select[data-date="2024-02-29"]')).not.toBeNull();
        expect(container.querySelector('.calendar-day--select[data-date="2024-03-03"]')
            .closest('td').classList.contains('outside-month')).toBe(true);
        expect(container.querySelector('[aria-pressed="true"]').dataset.date)
            .toBe('2024-02-29');
    });

    test('counts duplicate local and imported rides once and labels incomplete load totals', () => {
        coachingData.mockReturnValue({
            profile: null,
            activities: [{
                id: 'ride-1', day: '2026-11-03', name: 'Imported',
                duration: 3600, distance: 30000, loadMetrics: {power: {value: 42}},
            }],
            plan: null,
        });
        const calendar = createCalendar();
        calendar.localActivities = [
            {id: 'ride-1', timestamp: new Date(2026, 10, 3, 12).getTime(), duration: 3600},
            {id: 'ride-2', timestamp: new Date(2026, 10, 4, 12).getTime(), duration: 1800, distance: 10000},
        ];

        calendar.render();

        const summary = calendar.querySelector('[data-week-start="2026-11-02"] .training-calendar--week-summary');
        expect(summary.textContent).toMatch(/Activities\s*2/);
        expect(summary.textContent).toMatch(/Time\s*1h 30m/);
        expect(summary.textContent).toMatch(/Distance\s*40.0 km/);
        expect(summary.textContent).toMatch(/Known load\s*42/);
    });

    test('calculates historical models at each week end and never forecasts future weeks', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00Z'));
        const data = {
            profile: {timeZone: 'UTC'},
            activities: [{id: 'ride-1', day: '2026-11-03', sport: 'cycling', duration: 3600}],
            plan: null,
        };
        coachingData.mockReturnValue(data);
        estimateState.mockImplementation((history, profile, asOf) => ({
            chronicLoad: Number(asOf.slice(-2)),
            acuteLoad: 5,
            formBalance: 2,
            loadSource: 'power',
        }));
        const calendar = createCalendar();

        expect(estimateState.mock.calls.map(call => call[2])).toEqual([
            '2026-11-18', '2026-11-15', '2026-11-08',
        ]);
        const historical = calendar.querySelector('[data-week-start="2026-11-09"] .training-calendar--week-summary');
        expect(historical.textContent).toMatch(/Fitness\s*15/);
        expect(historical.textContent).toContain('Model: power');
        const future = calendar.querySelector('[data-week-start="2026-11-23"] .training-calendar--week-summary');
        expect(future.textContent).not.toContain('Fitness');
        calendar.render();
        expect(estimateState).toHaveBeenCalledTimes(3);

        coachingData.mockReturnValue({...data, activities: [...data.activities]});
        calendar.render();
        expect(estimateState).toHaveBeenCalledTimes(6);
    });

    test('renders historical weekly metrics from the real coaching model', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00Z'));
        const activity = normalizeActivity({
            id: 'ride-1',
            start: '2026-11-03T09:00:00Z',
            duration: 3600,
            distance: 30000,
            normalizedPower: profile.ftp,
        }, profile);
        coachingData.mockReturnValue({profile, activities: [activity], plan: null});
        estimateState.mockImplementation(jest.requireActual('../../src/coaching/state.js').estimateState);

        const calendar = createCalendar();
        const summary = calendar.querySelector('[data-week-start="2026-11-02"] .training-calendar--week-summary');

        expect(summary.textContent).toMatch(/Activities\s*1/);
        expect(summary.textContent).toMatch(/Load\s*100/);
        expect(summary.textContent).toMatch(/Fitness\s*2/);
        expect(summary.textContent).toMatch(/Fatigue\s*7/);
        expect(summary.textContent).toMatch(/Form\s*-4/);
        expect(summary.textContent).toContain('Model: power');
        expect(calendar.querySelector('[role="alert"]')).toBeNull();
    });

    test('reports a training-state calculation error instead of silently hiding it', () => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-18T12:00:00Z'));
        jest.spyOn(console, 'error').mockImplementation(() => {});
        coachingData.mockReturnValue({
            profile: {timeZone: 'UTC'},
            activities: [{id: 'ride-1', day: '2026-11-03', sport: 'cycling', duration: 3600}],
            plan: null,
        });
        estimateState.mockImplementation(() => { throw new Error('Invalid profile'); });

        const calendar = createCalendar();

        expect(calendar.querySelector('[role="alert"]').textContent)
            .toContain('Weekly training metrics could not be calculated');
        expect(console.error).toHaveBeenCalled();
    });

    test('escapes workout names displayed in calendar cells', () => {
        const calendar = new TrainingCalendar();
        calendar.displayMonth = new Date(2026, 10, 1);
        calendar.selectedDate = '2026-11-03';
        calendar.entries = [{
            date: '2026-11-03',
            name: '<img src=x onerror=alert(1)>',
            workout: {},
        }];

        const container = document.createElement('div');
        container.innerHTML = calendar.renderMonth();

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('.calendar-event--select[data-date="2026-11-03"]').textContent)
            .toContain('<img src=x onerror=alert(1)>');
    });

    test('shows planned workout duration, distance, category, and coaching targets', () => {
        const calendar = new TrainingCalendar();
        const metrics = calendar.workoutMetrics({
            source: 'coaching',
            workout: {meta: {duration: 3600, distance: 42000, category: 'Endurance'}},
            coaching: {targetLoad: 75.4, expectedRpe: 6},
        });

        expect(metrics).toEqual(['60 min', '42.0 km', 'Endurance', 'Load 75', 'RPE 6']);
        expect(calendar.workoutMetrics({
            source: 'coaching',
            workout: {meta: {}},
            coaching: {targetLoad: null, expectedRpe: null},
        })).toEqual(['Workout']);
    });

    test.each(['future', 'today', 'archived'])('keeps %s coaching details separate from action controls', (scenario) => {
        jest.useFakeTimers().setSystemTime(new Date('2026-11-03T12:00:00Z'));
        const calendar = new TrainingCalendar();
        const date = scenario === 'future' ? '2026-11-17' : '2026-11-03';
        const data = {
            profile: {timeZone: 'UTC'},
            plan: {status: scenario === 'archived' ? 'archived' : 'active', workouts: []},
            activities: [{id: 'ride-1', day: date, duration: 1800}],
        };
        coachingData.mockReturnValue(data);
        coachingService.mockReturnValue({data});
        const description = 'Endurance supports base objectives. '.repeat(20) + '<img src=x onerror=alert(1)>';
        calendar.innerHTML = calendar.renderEntry({
            id: 'coach-1',
            name: 'Salmon',
            date,
            source: 'coaching',
            workout: {
                id: 'salmon',
                meta: {duration: 1620, category: 'Endurance'},
                intervals: [{steps: [{duration: 1620, power: 0.6}]}],
            },
            coaching: {date, status: 'scheduled', targetLoad: 15, expectedRpe: 3, description},
        });

        const entry = calendar.querySelector('.training-calendar--entry.is-coaching');
        const copy = entry.querySelector('.training-calendar--copy');
        const explanation = copy.querySelector('.training-calendar--description');
        const actions = entry.querySelector('.training-calendar--entry-actions');
        expect(explanation.textContent).toContain('15 planned power-load points');
        expect(explanation.textContent).toContain('RPE 3.');
        expect(explanation.textContent).toContain(description);
        expect(explanation.previousElementSibling.className).toBe('training-calendar--meta');
        expect(explanation.nextElementSibling.classList.contains('power-profile')).toBe(true);
        expect(actions.textContent).not.toContain(description);
        expect(actions.querySelector('[data-action="coach-export"]')).not.toBeNull();
        expect(actions.querySelector('[data-action="start"]') !== null).toBe(scenario === 'today');
        expect(actions.querySelector('[data-action="coach-missed"]') !== null).toBe(scenario === 'today');
        expect(actions.querySelector('[data-action="coach-failed"]') !== null).toBe(scenario === 'today');
        expect(actions.querySelector('[data-action="coach-substitute"]') !== null).toBe(scenario === 'today');
        expect(calendar.querySelector('img')).toBeNull();
    });

    test('stores a library reference instead of copying a large course', () => {
        const course = {
            id: 'course-1',
            meta: {name: 'Long course'},
            points: Array.from({length: 100}, (_, index) => ({x: index, y: index})),
        };
        const calendar = createCalendar([course]);

        schedule(calendar, course.id);

        const [entry] = JSON.parse(window.localStorage.getItem('training-calendar'));
        expect(entry).toEqual({
            id: expect.any(String),
            date: '2026-11-03',
            name: 'Long course',
            workoutId: 'course-1',
        });
        expect(JSON.stringify(entry)).not.toContain('points');
    });

    test('preserves entries when separate calendar instances save', () => {
        const workout = {id: 'workout-1', meta: {name: 'Workout'}};
        const firstCalendar = createCalendar([workout]);
        const secondCalendar = createCalendar([workout]);

        schedule(firstCalendar, workout.id);
        schedule(secondCalendar, workout.id);

        expect(JSON.parse(window.localStorage.getItem('training-calendar')))
            .toHaveLength(2);
    });

    test('removes only the requested entry using the latest stored data', () => {
        const workout = {id: 'workout-1', meta: {name: 'Workout'}};
        const firstCalendar = createCalendar([workout]);
        const secondCalendar = createCalendar([workout]);
        schedule(firstCalendar, workout.id);
        schedule(secondCalendar, workout.id);

        const [firstEntry, secondEntry] = JSON.parse(window.localStorage.getItem('training-calendar'));
        firstCalendar.onStorage({
            key: 'training-calendar',
            newValue: JSON.stringify([firstEntry, secondEntry]),
            storageArea: window.localStorage,
        });
        const removeButton = firstCalendar.querySelector(`[data-entry="${firstEntry.id}"]`);
        firstCalendar.onClick({target: removeButton});

        expect(JSON.parse(window.localStorage.getItem('training-calendar')))
            .toEqual([secondEntry]);
    });

    test('starts the selected workout and returns to the home page', () => {
        const workout = {id: 'workout-1', meta: {name: 'Workout'}};
        const calendar = createCalendar([workout]);
        schedule(calendar, workout.id);
        const dispatched = [];
        const listener = (event) => dispatched.push([event.type, event.detail.data]);
        for(const type of ['workout', 'ui:page-set', 'ui:watchStart', 'ui:workoutStart']) {
            window.addEventListener(type, listener);
        }

        calendar.onClick({target: calendar.querySelector('[data-action="start"]')});

        for(const type of ['workout', 'ui:page-set', 'ui:watchStart', 'ui:workoutStart']) {
            window.removeEventListener(type, listener);
        }
        expect(dispatched).toEqual([
            ['workout', workout],
            ['ui:page-set', 'home'],
            ['ui:watchStart', undefined],
            ['ui:workoutStart', undefined],
        ]);
    });

    test.each(['started', 'paused'])(
        'does not replace a workout while a ride is %s',
        (status) => {
            const workout = {id: 'workout-1', meta: {name: 'Workout'}};
            const calendar = createCalendar([workout]);
            schedule(calendar, workout.id);
            calendar.watchStatus = status;
            const dispatched = jest.fn();
            const listener = (event) => dispatched(event.type);
            window.addEventListener('workout', listener);

            calendar.onClick({target: calendar.querySelector('[data-action="start"]')});

            window.removeEventListener('workout', listener);
            expect(dispatched).not.toHaveBeenCalled();
            expect(calendar.textContent).toContain('Stop the current ride');
        },
    );

    test.each([
        ['month', '2026-11-30', ['2026-11-30', '2027-01-03']],
        ['week', '2026-12-15', ['2026-12-14', '2026-12-20']],
    ])('loads connected Intervals.icu plans for the entire visible %s', async (view, futureDate, range) => {
        const originalFetch = global.fetch;
        const workoutFile = Buffer.from(
            '<workout_file><name>Intervals workout</name><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>',
        ).toString('base64');
        const requests = [];
        global.fetch = jest.fn(async (url, options) => {
            if(url.endsWith('/integrations/intervals')) {
                return {
                    ok: true,
                    status: 200,
                    headers: {get: () => 'application/json'},
                    json: async () => ({connected: true}),
                };
            }

            const query = new URL(url, 'http://localhost').searchParams;
            requests.push([query.get('oldest'), query.get('newest')]);
            return {
                ok: true,
                status: 200,
                headers: {get: () => 'application/json'},
                json: async () => [{
                    id: 123,
                    start_date_local: `${futureDate}T09:00:00`,
                    workout_file_base64: workoutFile,
                }],
            };
        });

        try {
            localStorage.setItem('athlima-intervals-v1', JSON.stringify({
                apiKey: 'test-key', athleteId: '123', oldest: '2026-01-01',
            }));
            const calendar = createCalendar();
            calendar.displayMonth = new Date(2026, 11, 1);
            calendar.selectedDate = futureDate;
            calendar.view = view;
            calendar.signal = {signal: new AbortController().signal};
            await calendar.loadPlannedMonth();
            calendar.render();

            expect(requests).toEqual([range]);
            const day = calendar.querySelector(`.calendar-day--select[data-date="${futureDate}"]`).closest('td');
            expect(day.textContent).toContain('Intervals workout');
            expect(day.querySelector('.power-profile--target')).not.toBeNull();
            expect(calendar.querySelector('[data-action="start"]')).not.toBeNull();

            const startedWorkouts = [];
            const listener = (event) => startedWorkouts.push(event.detail.data);
            window.addEventListener('workout', listener);
            calendar.onClick({target: calendar.querySelector('[data-action="start"]')});
            window.removeEventListener('workout', listener);
            expect(startedWorkouts).toHaveLength(1);
            expect(startedWorkouts[0].intervals).toHaveLength(1);
            const storedPlans = JSON.parse(localStorage.getItem('planned'));
            expect(storedPlans.workouts.some(workout => workout.intervals_id === 123)).toBe(true);
        } finally {
            setAccountScope(null);
            global.fetch = originalFetch;
        }
    });

    test('switches between month and week grids and navigates over a year boundary', () => {
        const calendar = createCalendar();
        calendar.intervalsConnected = false;
        calendar.displayMonth = new Date(2026, 11, 1);
        calendar.selectedDate = '2026-12-31';
        calendar.render();

        calendar.onClick({target: calendar.querySelector('[data-action="week"]')});
        expect(calendar.querySelectorAll('tbody tr')).toHaveLength(1);
        expect(calendar.querySelector('tbody tr').dataset.weekStart).toBe('2026-12-28');
        expect(calendar.plannedRange()).toEqual({oldest: '2026-12-28', newest: '2027-01-03'});

        calendar.onClick({target: calendar.querySelector('[data-action="week-next"]')});
        expect(calendar.selectedDate).toBe('2027-01-07');
        expect(calendar.querySelector('tbody tr').dataset.weekStart).toBe('2027-01-04');
        calendar.onClick({target: calendar.querySelector('[data-action="week-previous"]')});
        expect(calendar.selectedDate).toBe('2026-12-31');

        calendar.onClick({target: calendar.querySelector('[data-action="month"]')});
        expect(calendar.displayMonth.getMonth()).toBe(11);
        expect(calendar.querySelectorAll('tbody tr').length).toBeGreaterThan(1);
        calendar.onClick({target: calendar.querySelector('[data-action="next"]')});
        expect(calendar.selectedDate).toBe('2027-01-01');
        expect(calendar.plannedRange()).toEqual({oldest: '2026-12-28', newest: '2027-01-31'});
    });

    test('selects a day from a workout preview and schedules to the selected date', () => {
        const workout = {
            id: 'workout-1',
            meta: {name: 'Intervals'},
            intervals: [{steps: [{duration: 120, power: 0.8}]}],
        };
        const calendar = createCalendar([workout]);
        calendar.entries = [{id: 'existing', date: '2026-11-05', name: 'Intervals', workoutId: workout.id}];
        calendar.render();

        calendar.onClick({target: calendar.querySelector('.calendar-event--select[data-date="2026-11-05"]')});
        expect(calendar.selectedDate).toBe('2026-11-05');
        expect(calendar.querySelector('.calendar-day--select[data-date="2026-11-05"]').getAttribute('aria-pressed'))
            .toBe('true');
        schedule(calendar, workout.id);

        expect(JSON.parse(window.localStorage.getItem('training-calendar'))[0].date).toBe('2026-11-05');
    });

    test('preserves scroll position and preview focus during a calendar rerender', () => {
        const calendar = createCalendar();
        document.body.append(calendar);
        try {
            calendar.displayMonth = new Date(2026, 10, 1);
            calendar.selectedDate = '2026-11-03';
            calendar.plannedWorkouts = [{
                id: 'workout-1',
                meta: {name: 'Intervals', startDateLocal: '2026-11-05'},
            }];
            calendar.render();
            const grid = calendar.querySelector('.training-calendar--grid-wrap');
            grid.scrollLeft = 240;
            const preview = calendar.querySelector('.calendar-event--select[data-date="2026-11-05"]');
            preview.focus();

            calendar.onClick({target: preview});

            expect(calendar.selectedDate).toBe('2026-11-05');
            expect(calendar.querySelector('.training-calendar--grid-wrap').scrollLeft).toBe(240);
            expect(document.activeElement)
                .toBe(calendar.querySelector('.calendar-event--select[data-date="2026-11-05"]'));

            const updatedGrid = calendar.querySelector('.training-calendar--grid-wrap');
            updatedGrid.focus();
            calendar.render();
            expect(document.activeElement).toBe(calendar.querySelector('.training-calendar--grid-wrap'));
        } finally {
            calendar.remove();
        }
    });

    test('keeps the workout selection across a calendar rerender', () => {
        const calendar = createCalendar([
            {id: 'workout-1', meta: {name: 'Workout'}},
            {id: 'workout-2', meta: {name: 'Another workout'}},
        ]);
        const select = calendar.querySelector('[name="workout"]');
        select.value = 'workout-2';

        calendar.render();

        expect(calendar.querySelector('[name="workout"]').value).toBe('workout-2');
    });

    test('restores keyboard focus after a planned-workout refresh', async () => {
        const originalFetch = global.fetch;
        global.fetch = jest.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => ({}),
        }));
        const calendar = new TrainingCalendar();

        try {
            document.body.append(calendar);
            xf.dispatch('db:workouts', {
                workouts: [
                    {id: 'workout-1', meta: {name: 'Workout'}},
                    {id: 'workout-2', meta: {name: 'Another workout'}},
                ],
            });
            await Promise.resolve();

            const select = calendar.querySelector('[name="workout"]');
            select.value = 'workout-2';
            select.focus();
            xf.dispatch('action:planned', ':data');

            expect(calendar.querySelector('[name="workout"]').value).toBe('workout-2');
            expect(document.activeElement).toBe(calendar.querySelector('[name="workout"]'));
        } finally {
            calendar.remove();
            global.fetch = originalFetch;
        }
    });
});
