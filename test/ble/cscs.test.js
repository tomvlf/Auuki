import { CSCMeasurement } from '../../src/ble/cscs/cycling-speed-cadence-measurement.js';
import { RevsOverTime, RateAdjuster } from '../../src/ble/cscs/revs-over-time.js';

function view(bytes) {
    return new DataView(Uint8Array.from(bytes).buffer);
}

describe('Cycling Speed and Cadence Measurement', () => {
    test.each([
        [[1, 12, 0, 0, 0, 68, 26], {
            flags: 1, cumulativeWheelRevolutions: 12, lastWheelEventTime: 6724 / 1024,
        }],
        [[2, 2, 0, 153, 29], {
            flags: 2, cumulativeCrankRevolutions: 2, lastCrankEventTime: 7577 / 1024,
            cadence: 0,
        }],
        [[3, 12, 0, 0, 0, 68, 26, 2, 0, 153, 29], {
            flags: 3, cumulativeWheelRevolutions: 12, lastWheelEventTime: 6724 / 1024,
            cumulativeCrankRevolutions: 2, lastCrankEventTime: 7577 / 1024, cadence: 0,
        }],
    ])('decodes present fields in %j', (bytes, expected) => {
        expect(CSCMeasurement().decode(view(bytes))).toEqual(expected);
    });

    test('calculates cadence between notifications', () => {
        const measurement = CSCMeasurement();
        expect(measurement.decode(view([2, 1, 0, 0, 4])).cadence).toBe(0);
        expect(measurement.decode(view([2, 2, 0, 0, 8])).cadence).toBe(60);
    });
});

describe('RevsOverTime', () => {
    let cadence;

    beforeEach(() => {
        cadence = RevsOverTime({
            resolution: 1, maxRevs: 2 ** 16, maxTime: 64,
            format: value => Math.round(value * 60),
        });
    });

    test('initializes, calculates and resets cadence', () => {
        expect(cadence.calculate(1, 1)).toBe(0);
        expect(cadence.calculate(2, 2)).toBe(60);
        expect(cadence.reset()).toEqual({revs: -1, time: -1});
        expect(cadence.calculate(10, 10)).toBe(0);
    });

    test('coasting with an advancing clock yields zero', () => {
        cadence.calculate(1, 1);
        expect(cadence.calculate(2, 2)).toBe(60);
        expect(cadence.calculate(2, 3)).toBe(0);
        expect(cadence.calculate(3, 4)).toBe(60);
    });

    test('repeated notifications retain cadence until the configured limit', () => {
        cadence.setMaxRateCount(3);
        cadence.calculate(1, 1);
        cadence.calculate(2, 2);
        for(let i = 0; i < 3; i++) expect(cadence.calculate(2, 2)).toBe(60);
        expect(cadence.calculate(2, 2)).toBe(0);
        expect(cadence.calculate(3, 3)).toBe(60);
    });

    test('handles event-time rollover on the first new notification', () => {
        cadence.calculate(1, 63);
        expect(cadence.calculate(2, 0)).toBe(60);
    });

    test('handles revolution rollover', () => {
        cadence.calculate(65535, 1);
        expect(cadence.calculate(0, 2)).toBe(60);
    });
});

describe('RateAdjuster', () => {
    test('estimates notification rate once the sample is complete', () => {
        const onDone = jest.fn();
        const adjuster = RateAdjuster({onDone});
        for(let i = 0; i < 20; i++) adjuster.update({ts: i * 1000});
        expect(adjuster.isDone()).toBe(true);
        expect(onDone).toHaveBeenCalledWith(2);
        adjuster.update({ts: 20000});
        expect(onDone).toHaveBeenCalledTimes(1);
        adjuster.reset();
        expect(adjuster.isDone()).toBe(false);
    });
});
