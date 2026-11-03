import { GOALS, addDays, sum, daysBetween } from '../../src/coaching/domain.js';
import { generatePlan, validatePlan } from '../../src/coaching/planner.js';
import { modelGoalDemand, analyzeGaps } from '../../src/coaching/demands.js';
import { progressWorkout, exportZwo, toAppWorkout, FAMILIES, stepLoad } from '../../src/coaching/workouts.js';
import { adaptPlan, matchWorkout } from '../../src/coaching/adaptation.js';
import { normalizeActivity } from '../../src/coaching/normalizer.js';
import { profile, goal, start, timestamp, state } from './fixtures.js';

const plan = overrides => generatePlan({profile, goal, state: state(), startDate: start,
    generatedAt: timestamp, ...overrides});

describe('goal-specific deterministic planning', () => {
    test.each(Object.keys(GOALS))('builds safe dated %s plans for realistic availability', type => {
        const p = plan({goal: {...goal, type}});
        expect(p).toEqual(plan({goal: {...goal, type}}));
        expect(p.workouts.length).toBeGreaterThan(0);
        expect(p.phases.some(p => p.type === 'base')).toBe(true);
        expect(p.phases.some(p => p.type === 'build')).toBe(true);
        expect(p.phases.some(p => p.type === 'recovery')).toBe(true);
        expect(p.phases.at(-1).type).toBe('event');
        expect(p.phases.at(-2).type).toBe('taper');
        expect(() => validatePlan(p, profile)).not.toThrow();
        for(const workout of p.workouts) {
            expect(workout.duration / 60).toBeLessThanOrEqual(profile.maxSessionMinutes[
                new Date(workout.date).getUTCDay()]);
            expect(workout.description).toMatch(/supports/);
            expect(workout.date < goal.date).toBe(true);
        }
    });
    test('demands differ by goal and known gaps affect priority without fabricating unknowns', () => {
        expect(modelGoalDemand({...goal, type: 'sprint'}).capabilities.sprint)
            .toBeGreaterThan(modelGoalDemand(goal).capabilities.sprint);
        const gaps = analyzeGaps(state(), modelGoalDemand({...goal, targetFTP: 300}), {...goal, targetFTP: 300});
        expect(gaps.gaps.threshold.value).toBeCloseTo(1 - 250 / 300);
        expect(gaps.gaps.sprint.value).toBeNull();
    });
    test('goal registry is extensible', () => {
        const p = plan({goal: {...goal, type: 'custom'}, registry: {...GOALS, custom: [1, 2, 3, 4, 5]}});
        expect(p.demand.capabilities.durability).toBeCloseTo(7 / 19);
    });
    test('short lead time does not compress demanding build work', () => {
        const p = plan({goal: {...goal, date: addDays(start, 10)}});
        expect(p.phases.every(p => ['preparation', 'taper', 'event'].includes(p.type))).toBe(true);
        expect(p.workouts.every(w => !FAMILIES[w.family].hard)).toBe(true);
        expect(p.validationWarnings.join(' ')).toMatch(/Short lead/);
    });
    test('duration-only and absent history remain useful but more conservative', () => {
        const p = plan({state: state(profile, [])});
        expect(p.weeks[0].targetMinutes).toBeLessThanOrEqual(90);
        expect(p.workouts.every(w => !FAMILIES[w.family].hard)).toBe(true);
        expect(p.weeks.every(w => w.rampLimit === 0.025)).toBe(true);
        expect(p.phases[0].type).toBe('assessment');
    });
    test('initial power load is bounded by the actual recent and baseline power load', () => {
        const rides = Array.from({length: 14}, (_, i) => normalizeActivity({
            id: `easy-${i}`, start: `${addDays(start, -i * 2)}T09:00:00Z`, duration: 3600,
            normalizedPower: 75, averageHeartRate: 100, rpe: 2,
        }, profile));
        const s = state(profile, rides);
        const p = plan({state: s});
        expect(p.weeks[0].scheduledLoad).toBeLessThanOrEqual(s.weeklyLoad);
        expect(p.weeks[0].scheduledLoad).toBeLessThanOrEqual(14 * 9 / 4);
    });
    test('planned recovery returns to a bounded prior envelope rather than shrinking indefinitely', () => {
        const p = plan({goal: {...goal, date: addDays(start, 366)}});
        const beforeTaper = p.weeks.filter(w => w.phaseType !== 'taper').at(-1);
        expect(beforeTaper.scheduledMinutes).toBeGreaterThanOrEqual(p.weeks[0].scheduledMinutes);
    });
    test('no session fits: explain rather than silently overbook', () => {
        const p = plan({profile: {...profile, availableDays: [2], maxSessionMinutes: {2: 5}, longRideDay: 2}});
        expect(p.workouts).toHaveLength(0);
        expect(p.validationWarnings.join(' ')).toMatch(/No safe session/);
    });
    test('rejects invalid dates, impossible profiles and unsafe modifications', () => {
        expect(() => plan({goal: {...goal, date: start}})).toThrow();
        expect(() => plan({goal: {...goal, date: '2026-02-30'}})).toThrow();
        expect(() => plan({profile: {...profile, maxWeeklyHours: 1}})).toThrow();
        const p = plan();
        p.workouts[0].duration = 99999;
        expect(() => validatePlan(p, profile)).toThrow(/Unsafe/);
    });
    test('structured steps and exports preserve exact duration and relative FTP targets', () => {
        const w = progressWorkout({id: 'w', date: start, minutes: 45, family: 'threshold',
            level: 4, phaseId: 'p', weekId: 'w', phaseType: 'build', profile});
        expect(sum(w.steps.map(s => s.duration))).toBe(2700);
        expect(toAppWorkout(w).coachingWorkoutId).toBe(w.id);
        expect(exportZwo({...w, title: '<x>'})).toContain('&lt;x&gt;');
        expect(toAppWorkout(w).intervals).toHaveLength(w.steps.length);
        expect(toAppWorkout(w).meta.duration).toBe(w.duration);
        expect(toAppWorkout(w).intervals.every(i => i.duration === i.steps[0].duration)).toBe(true);
    });
    test('interval load forecasts equal normalized-power load from ideal execution, not a lower squared-power proxy', () => {
        const steps = [{duration: 300, power: 0.5}, {duration: 300, power: 1.2}, {duration: 300, power: 0.5}];
        const actual = normalizeActivity({id: 'ideal', start: `${start}T10:00:00Z`, duration: 900,
            streams: {power: steps.flatMap(s => Array(s.duration).fill(s.power * profile.ftp))}}, profile);
        const squaredPowerProxy = sum(steps.map(s => s.duration / 3600 * s.power ** 2 * 100));
        expect(stepLoad(steps)).toBeCloseTo(actual.loadMetrics.power.value, 8);
        expect(stepLoad(steps)).toBeGreaterThan(squaredPowerProxy);
    });
    test('availability/lead-time matrix preserves volume and load ramp bounds', () => {
        for(const days of [[1], [1, 2], [0, 1, 2, 3, 4, 5, 6]]) {
            for(const lead of [1, 8, 20, 28, 60, 180, 366]) {
                const athlete = {...profile, availableDays: days,
                    longRideDay: days.at(-1), maxSessionMinutes: Object.fromEntries(days.map(d => [d, 45]))};
                const p = plan({profile: athlete, state: state(athlete), goal: {...goal, date: addDays(start, lead)}});
                expect(() => validatePlan(p, athlete)).not.toThrow();
                for(let i = 1; i < p.weeks.length; i++) {
                    const recent = p.weeks.slice(Math.max(0, i - 4), i);
                    expect(p.weeks[i].scheduledMinutes).toBeLessThanOrEqual(Math.max(...recent.map(w => w.scheduledMinutes)) * 1.05 + 0.01);
                    expect(p.weeks[i].scheduledLoad).toBeLessThanOrEqual(Math.max(...recent.map(w => w.scheduledLoad)) * 1.05 + 0.06);
                }
            }
        }
    });
});

describe('matching and future-only adaptation', () => {
    test('duration alone does not auto-match; explicit identity is deterministic', () => {
        const p = plan(), w = p.workouts[0];
        const a = normalizeActivity({id: 'a', start: `${w.date}T10:00:00Z`, duration: w.duration}, profile);
        expect(matchWorkout(a, p.workouts).workoutId).toBeNull();
        expect(matchWorkout(a, p.workouts, w.id).workoutId).toBe(w.id);
        expect(matchWorkout({...a, sport: 'running'}, p.workouts, w.id).workoutId).toBeNull();
        expect(matchWorkout({...a, intensityFactor: 1.5}, p.workouts).workoutId).toBeNull();
    });
    test.each(['missed', 'failed', 'recovery'])('%s reduces future training and preserves frozen dates', trigger => {
        const p = plan();
        const workout = p.workouts[0];
        const adapted = adaptPlan({plan: p, profile, state: state(), trigger, date: workout.date,
            timestamp, workoutId: trigger === 'recovery' ? null : workout.id});
        expect(adapted.revision).toBe(2);
        expect(p.revision).toBe(1);
        expect(adapted.adaptations[0].loadChange).toBeLessThan(0);
        expect(adapted.workouts.filter(w => w.date <= workout.date).map(w => w.steps))
            .toEqual(p.workouts.filter(w => w.date <= workout.date).map(w => w.steps));
        expect(adapted.workouts.every(w => p.workouts.some(old => old.id === w.id && old.date === w.date))).toBe(true);
        expect(() => validatePlan(adapted, profile)).not.toThrow();
    });
    test('long unplanned activity reduces the remaining budget without adding catch-up sessions', () => {
        const p = plan(), workout = p.workouts[0];
        const activity = normalizeActivity({id: 'long', start: `${workout.date}T10:00:00Z`,
            duration: 18000, normalizedPower: 230, rpe: 9}, profile);
        const adapted = adaptPlan({plan: p, profile, state: state(), trigger: 'unplanned',
            date: workout.date, activity, timestamp});
        expect(adapted.adaptations[0].loadChange).toBeLessThan(0);
        expect(adapted.workouts.length).toBeLessThanOrEqual(p.workouts.length);
    });
    test('rejects future or already resolved workouts and completion without evidence', () => {
        const p = plan();
        expect(() => adaptPlan({plan: p, profile, state: state(), trigger: 'completed',
            date: p.workouts[0].date, workoutId: p.workouts[0].id, timestamp})).toThrow();
        expect(() => adaptPlan({plan: p, profile, state: state(), trigger: 'missed',
            date: start, workoutId: p.workouts.at(-1).id, timestamp})).toThrow();
    });
});
