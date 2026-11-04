/*
 * cps.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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

import { CyclingPowerMeasurement } from '../../src/ble/cps/cycling-power-measurement.js';

function view(bytes) {
    return new DataView(Uint8Array.from(bytes).buffer);
}

describe('Cycling Power Measurement', () => {
    test('decodes instantaneous power without optional fields', () => {
        expect(CyclingPowerMeasurement().decode(view([0, 0, 44, 1]))).toEqual({
            flags: 0,
            power: 300,
        });
    });

    test('decodes signed power', () => {
        expect(CyclingPowerMeasurement().decode(view([0, 0, 156, 255])).power).toBe(-100);
    });

    test('decodes wheel and crank fields at their wire offsets', () => {
        const measurement = CyclingPowerMeasurement();
        expect(measurement.decode(view([
            48, 0, 33, 0, 42, 0, 0, 0, 196, 96, 18, 0, 247, 4,
        ]))).toEqual({
            flags: 48,
            power: 33,
            cumulativeWheelRevolutions: 42,
            lastWheelEventTime: 24772 / 2048,
            cumulativeCrankRevolutions: 18,
            lastCrankEventTime: 1271 / 1024,
            cadence: 0,
        });
    });

    test('advances optional-field offsets before calculating cadence', () => {
        const measurement = CyclingPowerMeasurement();
        const first = [37, 0, 200, 0, 100, 64, 0, 1, 0, 0, 4];
        const second = [37, 0, 210, 0, 90, 96, 0, 2, 0, 0, 8];
        expect(measurement.decode(view(first))).toEqual({
            flags: 37, power: 200, pedalPowerBalance: 50, accumulatedTorque: 2,
            cumulativeCrankRevolutions: 1, lastCrankEventTime: 1, cadence: 0,
        });
        expect(measurement.decode(view(second))).toEqual({
            flags: 37, power: 210, pedalPowerBalance: 45, accumulatedTorque: 3,
            cumulativeCrankRevolutions: 2, lastCrankEventTime: 2, cadence: 60,
        });
    });
});
