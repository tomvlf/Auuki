/*
 * service.test.js: test coverage module.
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

import { CoachingService } from '../../src/coaching/service.js';
import { addDays, sum } from '../../src/coaching/domain.js';
import { validatePlan } from '../../src/coaching/planner.js';
import { profile, goal, start, timestamp, history, memoryStorage } from './fixtures.js';

async function setup() {
    const storage = memoryStorage();
    let now = timestamp;
    const clock = () => now;
    const service = new CoachingService(storage, clock);
    await service.configure(profile, goal);
    await service.importActivities(history().map(a => a.original));
    await service.generate(start);
    return {service, storage, clock, setDate: day => { now = `${day}T20:00:00Z`; }};
}

describe('persistent coaching loop', () => {
    test('ride history is persisted before opting into Coach and provider refreshes retain rider feedback', async () => {
        const service = new CoachingService(memoryStorage(), () => timestamp);
        const raw = {id: 'intervals:one', source: 'intervals', externalId: 'one',
            start: timestamp, duration: 1800, averagePower: 150};
        await service.importActivities([raw]);
        expect(service.data.profile).toBeNull();
        await service.updateFeedback(raw.id, {rpe: 5});
        await service.importActivities([{...raw, duration: 1900, averagePower: 155}]);
        expect(service.data.activities).toHaveLength(1);
        expect(service.data.activities[0].duration).toBe(1900);
        expect(service.data.activities[0].rpe).toBe(5);
        await service.configure(profile, goal);
        expect(service.data.activities).toHaveLength(1);
    });
    test('uploaded app recordings and later provider imports share one identity without losing streams', async () => {
        const service = new CoachingService(memoryStorage(), () => timestamp);
        await service.recordRide({id: 'app-ride', source: 'athlima', start: timestamp,
            duration: 60, streams: {power: Array(60).fill(150)}});
        await service.importActivities([{id: 'app-ride', source: 'intervals', externalId: 'provider-id',
            providerIds: {intervals: 'provider-id'}, start: timestamp, duration: 60}]);
        expect(service.data.activities).toHaveLength(1);
        expect(service.data.activities[0].streams.power).toHaveLength(60);
        expect(service.data.activities[0].source).toBe('athlima');
        expect(service.data.activities[0].providerIds.intervals).toBe('provider-id');
    });
    test('first profile recalculates imported history using declared timezone and FTP without losing provenance or feedback', async () => {
        const service = new CoachingService(memoryStorage(), () => timestamp);
        await service.importActivities([{id: 'intervals:midnight', source: 'intervals',
            start: '2026-01-01T23:30:00Z', duration: 3600, normalizedPower: 200,
            providerIds: {intervals: 'midnight'}, syncedAt: timestamp}]);
        await service.updateFeedback('intervals:midnight', {rpe: 6, sleepQuality: 3});
        expect(service.data.activities[0].day).toBe('2026-01-01');
        expect(service.data.activities[0].loadMetrics.power.value).toBeNull();
        await service.configure(profile, goal);
        const activity = service.data.activities[0];
        expect(activity.day).toBe('2026-01-02');
        expect(activity.loadMetrics.power.value).toBeCloseTo(64);
        expect(activity.providerIds).toEqual({intervals: 'midnight'});
        expect(activity.syncedAt).toBe(timestamp);
        expect(activity.rpe).toBe(6);
        expect(activity.feedback.sleepQuality).toBe(3);
    });
    test('history -> snapshot -> plan is persistent and repeatable with an injected clock', async () => {
        const {service, storage, clock} = await setup();
        const restored = new CoachingService(storage, clock);
        expect(restored.data).toEqual(service.data);
        expect(service.data.snapshots).toHaveLength(1);
        expect(service.data.plan.sourceSnapshot).toBe(service.data.snapshots[0].id);
        expect(service.data.revisions).toHaveLength(1);
        expect(service.data.plan).toEqual((await setup()).service.data.plan);
    });
    test('completion, feedback and missed-session review create immutable revisions', async () => {
        const {service, setDate} = await setup();
        const original = JSON.parse(JSON.stringify(service.data.plan));
        const workout = service.data.plan.workouts[0];
        setDate(workout.date);
        await service.recordRide({id: 'done', start: `${workout.date}T10:00:00Z`,
            duration: workout.duration, normalizedPower: workout.targetIntensity * profile.ftp,
            averageHeartRate: 130, rpe: 4}, workout.id);
        expect(service.data.plan.revision).toBe(2);
        expect(service.data.plan.workouts.find(w => w.id === workout.id).status).toBe('completed');
        expect(service.data.snapshots.at(-1).completionRate.value).toBe(1);
        expect(service.data.revisions[0]).toEqual(original);
        await service.updateFeedback('done', {sleepQuality: 1, muscleSoreness: 5}, workout.date);
        expect(service.data.plan.revision).toBe(3);
        expect(service.data.snapshots.at(-1).readiness.status).toBe('caution');
        expect(service.data.plan.adaptations.at(-1).loadChange).toBeLessThan(0);
        const next = service.data.plan.workouts.find(w => w.status === 'scheduled');
        setDate(addDays(next.date, 1));
        await service.advance();
        expect(service.data.plan.workouts.find(w => w.id === next.id).status).toBe('missed');
        expect(() => validatePlan(service.data.plan, profile)).not.toThrow();
        expect(new Set(service.data.snapshots.map(s => s.id)).size).toBe(service.data.snapshots.length);
    });
    test('identical feedback is idempotent and invalid feedback is rejected explicitly', async () => {
        const {service, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(workout.date);
        await service.recordRide({id: 'feedback', start: `${workout.date}T10:00:00Z`, duration: workout.duration}, workout.id);
        await service.updateFeedback('feedback', {sleepQuality: 1});
        const revision = service.data.plan.revision;
        await service.updateFeedback('feedback', {sleepQuality: 1});
        expect(service.data.plan.revision).toBe(revision);
        await expect(service.updateFeedback('feedback', {rpe: 99})).rejects.toThrow(/RPE/);
    });
    test('duplicate entries within a new import batch cause only one adaptation', async () => {
        const {service, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(workout.date);
        const raw = {id: 'batch', start: `${workout.date}T10:00:00Z`, duration: workout.duration};
        await service.importActivities([raw, raw]);
        expect(service.data.plan.revision).toBe(2);
    });
    test('provider corrections refresh coaching state without resolving a completed workout again', async () => {
        const {service, storage, clock, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(addDays(workout.date, 1));
        const raw = {id: 'intervals:corrected', externalId: 'corrected', source: 'intervals',
            start: `${workout.date}T10:00:00Z`, duration: workout.duration,
            normalizedPower: workout.targetIntensity * profile.ftp, ftp: profile.ftp,
            syncedAt: clock()};
        await service.importActivities([raw]);
        const completed = JSON.parse(JSON.stringify(service.data.plan.workouts.find(w => w.id === workout.id)));
        expect(completed.status).toBe('completed');
        await service.updateFeedback(raw.id, {rpe: 5, sleepQuality: 3});
        const revision = service.data.plan.revision;
        const previousLoad = service.data.snapshots.at(-1).acuteLoad;
        await service.importActivities([{...raw, normalizedPower: 300, syncedAt: `${workout.date}T15:00:00Z`}]);
        expect(service.data.plan.revision).toBe(revision + 1);
        expect(service.data.snapshots.at(-1).acuteLoad).not.toEqual(previousLoad);
        expect(service.data.plan.workouts.find(w => w.id === workout.id)).toEqual(completed);
        expect(service.data.activities.find(a => a.id === raw.id)).toMatchObject({rpe: 5, feedback: {sleepQuality: 3}});
        const updatedRevision = service.data.plan.revision;
        await service.importActivities([{...raw, normalizedPower: 300, syncedAt: `${workout.date}T16:00:00Z`}]);
        expect(service.data.plan.revision).toBe(updatedRevision);
        expect(new CoachingService(storage, clock).data).toEqual(service.data);
    });
    test('returning after the plan ends still matches imported rides before finishing the plan', async () => {
        const {service, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(addDays(service.data.plan.endDate, 1));
        await service.importActivities([{id: 'offline', start: `${workout.date}T10:00:00Z`,
            duration: workout.duration, normalizedPower: workout.targetIntensity * profile.ftp}]);
        expect(service.data.plan.workouts.find(w => w.id === workout.id).status).toBe('completed');
        await service.advance();
        expect(service.data.plan.status).toBe('finished');
        expect(service.data.plan.workouts.find(w => w.id === workout.id).status).toBe('completed');
    });
    test('feedback on an old history ride does not consume the current load budget', async () => {
        const {service} = await setup();
        const before = service.data.plan.workouts.map(w => ({id: w.id, duration: w.duration, steps: w.steps}));
        await service.updateFeedback('ride-28', {rpe: 3});
        expect(service.data.plan.workouts.map(w => ({id: w.id, duration: w.duration, steps: w.steps}))).toEqual(before);
    });
    test('unmatched duration-only ride can be explicitly substituted, not double counted', async () => {
        const {service, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(workout.date);
        await service.recordRide({id: 'outdoor', start: `${workout.date}T10:00:00Z`, duration: workout.duration});
        expect(service.data.plan.workouts.find(w => w.id === workout.id).status).toBe('scheduled');
        await service.resolve({workoutId: workout.id, trigger: 'substituted', activityId: 'outdoor'});
        const matched = service.data.plan.workouts.find(w => w.id === workout.id);
        expect(matched.status).toBe('substituted');
        expect(matched.matchedActivity).toBe('outdoor');
        await expect(service.resolve({workoutId: workout.id, trigger: 'substituted', activityId: 'outdoor'})).rejects.toThrow(/already matched/);
    });
    test('repeated ride imports and records are idempotent', async () => {
        const {service, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(workout.date);
        const raw = {id: 'same', start: `${workout.date}T10:00:00Z`, duration: workout.duration};
        await service.recordRide(raw, workout.id);
        const revision = service.data.plan.revision;
        await service.recordRide(raw, workout.id);
        await service.importActivities([raw, raw]);
        expect(service.data.activities.filter(a => a.id === 'same')).toHaveLength(1);
        expect(service.data.plan.revision).toBe(revision);
    });
    test('batch imports are atomic and storage failures are explicit', async () => {
        const {service, storage, clock} = await setup();
        const before = JSON.parse(JSON.stringify(service.data));
        await expect(service.importActivities([{id: 'invalid'}])).rejects.toThrow();
        expect(service.data).toEqual(before);
        storage.setItem = () => { throw new Error('Quota exceeded'); };
        await expect(service.archive()).rejects.toThrow('Quota exceeded');
        expect(service.data).toEqual(before);
        expect(new CoachingService(storage, clock).data).toEqual(before);
    });
    test('refuses unsupported storage and overwriting active plans', async () => {
        const {service, storage} = await setup();
        await expect(service.generate(start)).rejects.toThrow(/Archive/);
        await expect(service.configure(profile, goal)).rejects.toThrow(/archive/);
        storage.setItem('athlima-coaching-v1', '{"version":"unknown"}');
        expect(() => new CoachingService(storage)).toThrow(/Unsupported/);
    });
    test('missed workouts are reviewed only once and dates after the event finish the plan', async () => {
        const {service, setDate} = await setup();
        const workout = service.data.plan.workouts[0];
        setDate(addDays(workout.date, 1));
        await service.advance();
        const revision = service.data.plan.revision;
        await service.advance();
        expect(service.data.plan.revision).toBe(revision);
        setDate(addDays(goal.date, 1));
        await service.advance();
        expect(service.data.plan.status).toBe('finished');
        expect(service.data.plan.workouts.every(w => w.status !== 'scheduled')).toBe(true);
    });
});
