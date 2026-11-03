/** @jest-environment jsdom */

import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'node:v8';
import { CoachingPanel } from '../../src/views/coaching-panel.js';
import { TrainingCalendar } from '../../src/views/training-calendar.js';
import { initializeCoaching } from '../../src/coaching/service.js';
import { addDays, localDay } from '../../src/coaching/domain.js';
import { progressWorkout, exportZwo, toAppWorkout } from '../../src/coaching/workouts.js';
import { zwo } from '../../src/workouts/zwo.js';
import { profile } from './fixtures.js';
import { xf } from '../../src/functions.js';
import { db } from '../../src/db.js';

beforeAll(() => {
    if(!globalThis.structuredClone) globalThis.structuredClone = value => deserialize(serialize(value));
});

test('generated ZWO and app workouts expose the durations required by the existing player', () => {
    const workout = progressWorkout({id: 'structured', date: '2026-01-01', minutes: 45, family: 'threshold',
        phaseId: 'p', weekId: 'w', phaseType: 'build', level: 2, profile});
    const parsed = zwo.readToInterval(exportZwo(workout));
    const app = toAppWorkout(workout);
    expect(parsed.meta.duration).toBe(workout.duration);
    expect(app.meta.duration).toBe(parsed.meta.duration);
    expect(app.intervals).toEqual(parsed.intervals);
});

test('coaching forms create a persistent plan that appears and adapts in the existing calendar', async () => {
    const service = await initializeCoaching(new IDBFactory());
    const panel = new CoachingPanel(), calendar = new TrainingCalendar();
    document.body.append(panel, calendar);
    try {
        const form = panel.querySelector('[data-coach-form=setup]');
        const start = localDay(new Date().toISOString(), form.elements.timeZone.value);
        form.elements.start.value = start;
        form.elements.date.value = addDays(start, 60);
        form.elements.limits.value = JSON.stringify(Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map(d => [d, 60])));
        await panel.submit({target: form, preventDefault() {}, submitter: {value: 'configure'}});
        expect(panel.querySelector('[role=alert]')).toBeNull();
        const imports = panel.querySelector('[data-coach-form=import]');
        imports.elements.rides.value = JSON.stringify(Array.from({length: 14}, (_, i) => ({
            id: `ui-history-${i}`, start: `${addDays(start, -i * 2 - 1)}T10:00:00Z`,
            duration: 3600, normalizedPower: 130, averageHeartRate: 130, rpe: 4,
        })));
        await panel.submit({target: imports, preventDefault() {}});
        const generate = panel.querySelector('[data-coach-form=setup]');
        await panel.submit({target: generate, preventDefault() {}, submitter: {value: 'generate'}});
        expect(panel.querySelector('[role=alert]')).toBeNull();
        expect(service.data.plan.revision).toBe(1);
        expect(calendar.coachingEntries()).toHaveLength(service.data.plan.workouts.length);
        const workout = service.data.plan.workouts[0];
        expect(calendar.entriesForDate(workout.date).some(e => e.id === workout.id)).toBe(true);
        expect(calendar.canStartCoaching(workout)).toBe(true);
        expect(calendar.canStartCoaching(service.data.plan.workouts.at(-1))).toBe(false);
        xf.dispatch('ui:coaching:select', toAppWorkout(workout));
        expect(db.workout.coachingWorkoutId).toBe(workout.id);
        expect(db.workout.meta.duration).toBe(workout.duration);
        const selected = db.workout;
        const ftp = db.ftp;
        const errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
        try {
            xf.dispatch('ui:ftp-set', ftp + 20);
            xf.dispatch('ui:coaching:select', toAppWorkout(workout));
            expect(db.workout).toBe(selected);
            expect(panel.textContent).toContain('FTP has changed');
        } finally {
            xf.dispatch('ui:ftp-set', ftp);
            errorLog.mockRestore();
        }
        await panel.click({target: panel.querySelector('[data-coach=recovery]')});
        expect(service.data.plan.revision).toBe(2);
        expect(panel.textContent).toContain('Revision 2');
        expect(panel.querySelector('[role=alert]')).toBeNull();
    } finally {
        panel.remove();
        calendar.remove();
    }
});
