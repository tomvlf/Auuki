/*
 * fitjs.test.js: test coverage module.
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

import { data } from './min-data.js';
import { FITjs } from '../../src/fit/fitjs.js';
import { dataviewToArray } from '../../src/functions.js';

describe('minimal', () => {
    const array = data.minimal;
    const typedArray = new Uint8Array(array);
    const dataview = new DataView(typedArray.buffer);
    const minimalFITjs = data.minimalFITjs;

    test('decode', () => {
        expect(FITjs.decode(dataview)).toEqual(minimalFITjs);
        // getUint16(new Uint8Array([123, 197]))
    });

    test('encode', () => {
        expect(dataviewToArray(FITjs.encode(minimalFITjs))).toEqual(array);
    });
});
