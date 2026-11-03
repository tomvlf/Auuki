import { normalizeActivity, fromRecordedRide } from '../../src/coaching/normalizer.js';
import { estimateCriticalPower, estimateState, powerDuration, estimateDurability,
    intensityDistribution } from '../../src/coaching/state.js';
import { DEFAULTS, addDays, metric, localDay } from '../../src/coaching/domain.js';
import { profile, start, history } from './fixtures.js';

const ride = overrides => normalizeActivity({id: 'ride', start: `${start}T09:00:00Z`, duration: 3600, ...overrides}, profile);

describe('activity normalization', () => {
    test('calculates independent loads, preserves originals and documents inputs', () => {
        const a = ride({normalizedPower: 200, averageHeartRate: 120, rpe: 6, source: 'manual'});
        expect(a.intensityFactor).toBe(0.8);
        expect(a.loadMetrics.power.value).toBeCloseTo(64);
        expect(a.loadMetrics.sessionRpe.value).toBe(360);
        expect(a.loadMetrics.heartRate.value).toBeCloseTo(15);
        expect(a.loadMetrics.power.inputs.ftp).toBe(250);
        expect(a.original.normalizedPower).toBe(200);
        expect(a.dataLevel).toBe('B');
    });
    test('does not silently substitute average power for normalized power', () => {
        const a = ride({averagePower: 200});
        expect(a.loadMetrics.power.value).toBeNull();
        expect(a.warnings.join(' ')).toMatch(/average power is not used/);
        expect(a.streamAveragePower.value).toBeNull();
    });
    test('derives normalized power only from sufficiently complete one-second streams', () => {
        const a = ride({duration: 60, streams: {power: Array(60).fill(200), heartRate: Array(60).fill(140)}, rpe: 4});
        expect(a.normalizedPower).toBe(200);
        expect(a.normalizedPowerCalculation.source).toMatch(/^derived/);
        expect(a.dataLevel).toBe('A');
        expect(a.averageHeartRate).toBe(140);
        expect(a.averageHeartRateCalculation.source).toBe('derived-stream-mean');
        expect(a.loadMetrics.heartRate.value).not.toBeNull();
        expect(a.maximumPower).toBe(200);
        expect(a.maximumPowerCalculation.source).toMatch(/^derived/);
        expect(ride({streams: {power: Array(60).fill(200)}}).normalizedPower).toBeNull();
    });
    test.each([
        [{averageHeartRate: 120, rpe: 5}, 'C'], [{rpe: 5}, 'D'], [{}, 'E'],
    ])('supports weaker data levels %s', (input, level) => expect(ride(input).dataLevel).toBe(level));
    test('invalid input is rejected or flagged and never converted to valid evidence', () => {
        expect(() => ride({duration: -1})).toThrow();
        expect(() => ride({start: '2026-02-30T10:00:00Z'})).toThrow();
        const a = ride({rpe: 15, streams: {power: [NaN]}, feedback: {sleepQuality: 9}});
        expect(a.rpe).toBeNull();
        expect(a.feedback.sleepQuality).toBeNull();
        expect(a.hasPower).toBe(false);
        expect(a.warnings.length).toBeGreaterThan(2);
    });
    test('does not treat interrupted recording as contiguous power samples', () => {
        const raw = fromRecordedRide({elapsed: 60, records: [{timestamp: 1000, power: 100},
            {timestamp: 5000, power: 200}]}, 'ride', Date.parse('2026-01-01T09:00:00Z'));
        expect(raw.streams.power).toBeUndefined();
    });
    test('uses the athlete time zone at midnight and DST boundaries', () => {
        expect(localDay('2026-01-01T23:30:00Z', 'Europe/Paris')).toBe('2026-01-02');
        expect(localDay('2026-03-29T22:30:00Z', 'Europe/Paris')).toBe('2026-03-30');
    });
});

describe('versioned rider-state estimation', () => {
    test('recovers synthetic CP and W-prime without equating CP and FTP', () => {
        const fit = estimateCriticalPower([120, 360, 720].map(seconds =>
            ({seconds, watts: 250 + 18000 / seconds, maximal: true})));
        expect(fit.cp).toBe(250);
        expect(fit.wPrime).toBe(18000);
        expect(fit.fitQuality).toBeCloseTo(1);
        expect(fit.version).toBeDefined();
    });
    test.each([
        [], [{seconds: 300, watts: 300, maximal: true}],
        [120, 130, 140].map(seconds => ({seconds, watts: 400, maximal: true})),
        [120, 360, 720].map(seconds => ({seconds, watts: 250 + 18000 / seconds})),
        [120, 360, 720].map(seconds => ({seconds, watts: 900 + 18000 / seconds, maximal: true})),
    ].map(efforts => [efforts]))('rejects insufficient, unconfirmed, narrow or implausible fits', efforts => {
        expect(estimateCriticalPower(efforts).cp).toBeNull();
    });
    test('rolling best powers are exact and missing efforts never prove decline', () => {
        const a = ride({duration: 60, streams: {power: [...Array(30).fill(100), ...Array(30).fill(300)]}});
        const curve = powerDuration([a], 75);
        expect(curve.find(p => p.seconds === 30).watts).toBe(300);
        expect(curve.find(p => p.seconds === 60).watts).toBe(200);
        expect(curve.find(p => p.seconds === 180).watts).toBeNull();
        expect(estimateState([a], profile, start).performanceComparison).toMatch(/not evidence/);
    });
    test('EW load handles days without rides, uses exact exponential coefficients and never mixes units', () => {
        const a = ride({normalizedPower: 250, rpe: 4});
        const s = estimateState([a], profile, start);
        expect(s.chronicLoad).toBeCloseTo(100 * (1 - Math.exp(-1 / 42)));
        expect(s.acuteLoad).toBeCloseTo(100 * (1 - Math.exp(-1 / 7)));
        expect(s.formBalance).toBeCloseTo(s.chronicLoad - s.acuteLoad);
        const mixed = estimateState([a, ride({id: 'other', start: `${addDays(start, -1)}T09:00:00Z`})], profile, start);
        expect(mixed.loadSource).toBe('duration');
        expect(mixed.weeklyLoad).toBe(120);
        expect(mixed.loadExplanation).toMatch(/not direct biological/);
    });
    test('state uses rolling windows, ignores future/noncycling rides, and explains missing metrics', () => {
        const a = ride({start: `${addDays(start, 1)}T09:00:00Z`});
        const s = estimateState([a, ride({id: 'run', sport: 'running'})], profile, start);
        expect(s.activityCount).toBe(0);
        expect(s.chronicLoad).toBeNull();
        expect(s.weeklyLoad).toBeNull();
        expect(s.criticalPower.cp).toBeNull();
        expect(s.maximumAerobicPower.reason).toBeTruthy();
        expect(s.readiness.status).toBe('unknown');
        expect(s.sufficiency).toBe('insufficient');
    });
    test('configurable windows and explicit feedback change readiness', () => {
        const a = ride({feedback: {sleepQuality: 1, muscleSoreness: 5}});
        const s = estimateState([a], profile, start, {longDays: 30, chronicDays: 20});
        expect(s.dailyLoad).toHaveLength(30);
        expect(s.readiness.status).toBe('caution');
        expect(s.readiness.concerns).toHaveLength(2);
        expect(() => estimateState([], profile, start, {chronicDays: 0})).toThrow();
    });
    test('power and HR distributions retain separate references and thresholds', () => {
        const a = ride({duration: 3, streams: {power: [100, 250, 300], heartRate: [100, 150, 185]}});
        const zones = intensityDistribution([a], profile);
        expect(zones.power.threeZoneSeconds).toEqual([1, 1, 1]);
        expect(zones.heartRate.threeZoneSeconds).toEqual([1, 1, 1]);
        expect(zones.power.reference).toBe(250);
        expect(zones.heartRate.reference).toBe(190);
    });
    test('durability requires paired steady endurance data and rejects unsuitable rides', () => {
        expect(estimateDurability(history()).value).toBeNull();
        const a = ride({streams: {power: Array(3600).fill(150),
            heartRate: [...Array(2100).fill(120), ...Array(1500).fill(132)]}});
        const observations = estimateDurability([a]).value;
        expect(observations).toHaveLength(1);
        expect(observations[0].decoupling).toBeCloseTo(1 - 120 / 132);
        expect(estimateDurability([ride({streams: {power: Array(3600).fill(300),
            heartRate: Array(3600).fill(120)}})]).value).toBeNull();
    });
});
