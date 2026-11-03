/** @jest-environment jsdom */

import { localDate, TrainingCalendar } from '../../src/views/training-calendar.js';
import { xf } from '../../src/functions.js';

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
    });

    test('formats local dates without shifting to the previous day', () => {
        expect(localDate(2024, 1, 29)).toBe('2024-02-29');
    });

    test('renders every day in a leap-year month', () => {
        const calendar = new TrainingCalendar();
        calendar.displayMonth = new Date(2024, 1, 1);
        calendar.selectedDate = '2024-02-29';
        calendar.entries = [];

        const container = document.createElement('div');
        container.innerHTML = calendar.renderMonth();

        const dates = [...container.querySelectorAll('[data-date]')]
            .map((day) => day.dataset.date);
        expect(dates).toHaveLength(29);
        expect(dates[0]).toBe('2024-02-01');
        expect(dates.at(-1)).toBe('2024-02-29');
        expect(container.querySelector('[aria-pressed="true"]').dataset.date)
            .toBe('2024-02-29');
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
        expect(container.querySelector('[data-date="2026-11-03"]').textContent)
            .toContain('<img src=x onerror=alert(1)>');
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

    test('uses the displayed month to fetch connected Intervals.icu plans', async () => {
        const originalFetch = global.fetch;
        const futureDate = '2026-12-15';
        const workoutFile = Buffer.from(
            '<workout_file><name>Intervals workout</name><workout><SteadyState Duration="60" Power="0.5"/></workout></workout_file>',
        ).toString('base64');
        const requests = [];
        global.fetch = jest.fn(async (url, options) => {
            if(options.body && JSON.parse(options.body).method === 'status_handler') {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({result: {services: {intervals: true}}}),
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
            const calendar = createCalendar();
            calendar.displayMonth = new Date(2026, 11, 1);
            calendar.signal = {signal: new AbortController().signal};
            await calendar.loadPlannedMonth();
            calendar.selectedDate = futureDate;
            calendar.render();

            expect(requests).toEqual([['2026-12-01', '2026-12-31']]);
            expect(calendar.querySelector(`[data-date="${futureDate}"]`)
                .classList.contains('has-events')).toBe(true);
            expect(calendar.textContent).toContain('Intervals workout');
            expect(calendar.querySelector('[data-action="start"]')).not.toBeNull();

            const startedWorkouts = [];
            const listener = (event) => startedWorkouts.push(event.detail.data);
            window.addEventListener('workout', listener);
            calendar.onClick({target: calendar.querySelector('[data-action="start"]')});
            window.removeEventListener('workout', listener);
            expect(startedWorkouts).toHaveLength(1);
            expect(startedWorkouts[0].intervals).toHaveLength(1);
        } finally {
            global.fetch = originalFetch;
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
