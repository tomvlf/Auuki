/*
 * utils.test.js: test coverage module.
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

/**
 * @jest-environment jsdom
 */

import { isoDate, } from '../src/utils.js';

// nyc        utc        hel
//
// 24 16:00   24 21:00   24 23:00
// 24 17:00   24 22:00   25 00:00
//
// 24 18:00   25 23:00   25 01:00
// 24 19:00   25 00:00   25 02:00
// 24 20:00   25 01:00   25 03:00
//
// 24 23:00   25 04:00   25 06:00
// 25 00:00   25 05:00   25 07:00
// 25 01:00   25 06:00   25 08:00

describe('isoDate', () => {
    describe('hel', () => {
        describe('local = true', () => {
            test('utc 24 21:00 - hel 24 23:00 -> 24', () => {
                const localDate = new Date('2025-02-24T23:00:00');
                expect(isoDate(localDate)).toBe('2025-02-24');
            });

            test('utc 24 22:00 - hel 25 00:00 -> 25', () => {
                const localDate = new Date('2025-02-25T00:00:00');
                expect(isoDate(localDate)).toBe('2025-02-25');
            });

            test('utc 24 23:00 - hel 25 01:00 -> 25', () => {
                const localDate = new Date('2025-02-25T00:00:00');
                expect(isoDate(localDate)).toBe('2025-02-25');
            });

            test('utc 25 00:00 - hel 25 02:00 -> 25', () => {
                const localDate = new Date('2025-02-25T02:00:00');
                expect(isoDate(localDate)).toBe('2025-02-25');
            });

            test('utc 25 01:00 - hel 25 03:00 -> 25', () => {
                const localDate = new Date('2025-02-25T02:00:00');
                expect(isoDate(localDate)).toBe('2025-02-25');
            });
        });

        describe('local = false', () => {
            test('utc 24 21:00 - hel 24 23:00 -> 24', () => {
                const localDate = new Date('2025-02-24T23:00:00+02:00');
                expect(isoDate(localDate, false)).toBe('2025-02-24');
            });

            test('utc 24 22:00 - hel 25 00:00 -> 24', () => {
                const localDate = new Date('2025-02-25T00:00:00+02:00');
                expect(isoDate(localDate, false)).toBe('2025-02-24');
            });

            test('utc 25 00:00 - hel 25 02:00 -> 25', () => {
                const localDate = new Date('2025-02-25T02:00:00+02:00');
                expect(isoDate(localDate, false)).toBe('2025-02-25');
            });

            test('utc 25 01:00 - hel 25 03:00 -> 25', () => {
                const localDate = new Date('2025-02-25T03:00:00+02:00');
                expect(isoDate(localDate, false)).toBe('2025-02-25');
            });
        });
    });
});
