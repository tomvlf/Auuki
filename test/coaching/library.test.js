import { sum } from '../../src/coaching/domain.js';
import { generatePlan, validatePlan } from '../../src/coaching/planner.js';
import { coachCatalogue, fitWorkout, prescribeWorkout, zwoSteps } from '../../src/coaching/library.js';
import { FAMILIES, stepLoad, toAppWorkout } from '../../src/coaching/workouts.js';
import { profile, goal, start, timestamp, state } from './fixtures.js';

const slot = (family, minutes, level = 1) => ({id: 'w', date: start, minutes, family, level,
    phaseId: 'p', weekId: 'wk', phaseType: 'build', profile});

describe('coach workout library', () => {
    test('parses ZWO elements into constant-power steps and rejects unusable workouts', () => {
        const zwo = body => `<workout_file><workout>${body}</workout></workout_file>`;
        expect(zwoSteps(zwo('<Warmup Duration="240" PowerLow="0.4" PowerHigh="0.6"/><IntervalsT Repeat="2" OnDuration="60" OffDuration="30" OnPower="1.1" OffPower="0.5"/>')))
            .toEqual([{duration: 120, power: 0.45}, {duration: 120, power: 0.55},
                {duration: 60, power: 1.1}, {duration: 30, power: 0.5}, {duration: 60, power: 1.1}, {duration: 30, power: 0.5}]);
        expect(zwoSteps(zwo('<FreeRide Duration="60"/>'))).toBeNull();
        expect(zwoSteps(zwo('<SteadyState Duration="60" Power="1.7"/>'))).toBeNull();
    });
    test('catalogue covers every coached family except sprints and never puts intensity in easy slots', () => {
        const catalogue = coachCatalogue();
        for(const family of ['endurance', 'durability', 'recovery', 'threshold', 'aerobic']) {
            expect(catalogue.some(e => e.families.includes(family))).toBe(true);
        }
        for(const entry of catalogue.filter(e => e.families.includes('endurance'))) {
            expect(Math.max(...entry.steps.map(s => s.power))).toBeLessThanOrEqual(0.8);
        }
    });
    test('fitting removes whole repetitions and preserves template-protected warm-up, recovery and cool-down', () => {
        const template = `<workout_file><name>Protected intervals</name><category>Threshold</category>
            <description>Structured session</description><workout>
            <Warmup Duration="180" PowerLow="0.4" PowerHigh="0.6"/>
            <IntervalsT Repeat="4" OnDuration="30" OffDuration="90" OnPower="1.0" OffPower="0.5"/>
            <Cooldown Duration="180" PowerLow="0.6" PowerHigh="0.4"/>
            </workout></workout_file>`;
        const entry = coachCatalogue([template], undefined, {
            'Protected intervals': {minimumEfforts: 2, minimumWarmupSeconds: 180, minimumCooldownSeconds: 180},
        })[0];
        const fit = fitWorkout(entry, {seconds: 600, family: 'threshold', level: 1});
        expect(sum(fit.steps.filter(s => s.role === 'warmup').map(s => s.duration))).toBe(180);
        expect(sum(fit.steps.filter(s => s.role === 'cooldown').map(s => s.duration))).toBe(180);
        expect(fit.steps.filter(s => s.role === 'effort')).toHaveLength(2);
        expect(new Set(fit.steps.filter(s => s.repetitionId).map(s => s.repetitionId)).size).toBe(2);
        expect(sum(fit.steps.map(s => s.duration))).toBe(600);
        const rejected = {...entry, minimumWarmupSeconds: 240};
        expect(fitWorkout(rejected, {seconds: 600, family: 'threshold', level: 1})).toBeNull();
    });
    test.each([['threshold', 45], ['threshold', 90], ['aerobic', 40], ['aerobic', 75], ['endurance', 30],
        ['durability', 200], ['recovery', 35]])('fits %s into %i minutes exactly and safely', (family, minutes) => {
        for(const level of [1, 3, 5]) {
            for(const entry of coachCatalogue()) {
                const fit = fitWorkout(entry, {seconds: minutes * 60, family, level});
                if(!fit) continue;
                expect(sum(fit.steps.map(s => s.duration))).toBe(minutes * 60);
                expect(fit.steps.every(s => Number.isInteger(s.duration) && s.duration > 0 && s.power <= 1.5)).toBe(true);
                expect(sum(fit.steps.filter(s => s.power > 0.9).map(s => s.duration))).toBeLessThanOrEqual(minutes * 60 * 0.18);
            }
        }
    });
    test('prescribes named library workouts with the coach explanation and adjustments', () => {
        const w = prescribeWorkout(slot('threshold', 50));
        expect(w.libraryWorkoutId).toMatch(/^builtin-/);
        expect(w.title).toBe(w.libraryName);
        expect(w.description).toMatch(/supports/);
        expect(w.duration).toBe(3000);
        expect(w.targetLoad).toBe(Math.round(stepLoad(w.steps) * 100) / 100);
        expect(toAppWorkout(w).meta.author).toMatch(/library/);
        expect(prescribeWorkout(slot('threshold', 20)).family).toBe('endurance');
        expect(prescribeWorkout(slot('sprint', 45)).libraryWorkoutId).toBeNull();
    });
    test('adjusting a session keeps the planned library workout when it still fits', () => {
        const planned = prescribeWorkout(slot('aerobic', 75, 3));
        const shorter = prescribeWorkout(slot('aerobic', 45, 3), {prefer: planned.libraryWorkoutId});
        expect(shorter.libraryWorkoutId).toBe(planned.libraryWorkoutId);
        expect(shorter.duration).toBe(2700);
    });
    test('generated plans use the best-fitting library dose before applying variety and remain valid', () => {
        const p = generatePlan({profile, goal, state: state(), startDate: start, generatedAt: timestamp});
        expect(() => validatePlan(p, profile)).not.toThrow();
        const library = p.workouts.filter(w => w.libraryWorkoutId);
        expect(library.length).toBeGreaterThan(p.workouts.length / 2);
        const hard = library.filter(w => FAMILIES[w.family].hard);
        expect(hard.length).toBeGreaterThan(0);
        for(const workout of hard) {
            const scores = coachCatalogue().filter(e => e.families.includes(workout.family))
                .map(e => fitWorkout(e, {seconds: workout.duration, family: workout.family,
                    level: workout.progressionLevel})?.score).filter(score => score != null);
            expect(fitWorkout(coachCatalogue().find(e => e.id === workout.libraryWorkoutId), {
                seconds: workout.duration, family: workout.family, level: workout.progressionLevel,
            }).score).toBeLessThanOrEqual(Math.min(...scores) + 0.05);
        }
    });
});
