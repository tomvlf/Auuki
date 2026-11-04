/*
 * ct.test.js: test coverage module.
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

import { coreBodyTemperature } from '../../src/ble/ct/core-body-temperature.js';
import { dataviewToArray } from '../../src/functions.js';

describe('Core Body Temperature', () => {

    test('coreBody temperature', () => {
        const dataview = coreBodyTemperature.encode({
            coreBodyTemperature: 38.12,
        });

        const expected = {
            coreBodyTemperature: 38.12,
        };

        const res = coreBodyTemperature.decode(dataview);
        expect(res).toEqual(expected);
    });

    test('coreBody + skin temperature', () => {
        const dataview = coreBodyTemperature.encode({
            coreBodyTemperature: 38.12,
            skinTemperature: 38.47,
        });

        const expected = {
            coreBodyTemperature: 38.12,
            skinTemperature: 38.47,
        };

        const res = coreBodyTemperature.decode(dataview);
        expect(res).toEqual(expected);
    });

    test('temperature in Fahrenheit', () => {
        const dataview = coreBodyTemperature.encode({
            temperatureUnit: 'F',
            coreBodyTemperature: coreBodyTemperature.celsiusToFahrenheit(38.12),
            skinTemperature: coreBodyTemperature.celsiusToFahrenheit(38.47),
        });

        const expected = {
            coreBodyTemperature: 38.12,
            skinTemperature: 38.47,
        };

        const res = coreBodyTemperature.decode(dataview);
        expect(res).toEqual(expected);
    });

    test('all', () => {

        const payload = [0b00010111, 228, 14, 7, 15, 0, 0, 0b00010011, 130];
        const dataview = new DataView(new Uint8Array(payload).buffer);

        console.log(dataview.buffer);
        console.log(dataviewToArray(dataview));

        const expected = {
            coreBodyTemperature: 38.12,
            skinTemperature: 38.47,
            coreReserved: 0,
            qualityAndState: 19,
            heartRate: 130,
        };

        const res = coreBodyTemperature.decode(dataview);
        expect(res).toEqual(expected);
    });
});

