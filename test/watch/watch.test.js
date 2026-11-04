/*
 * watch.test.js: test coverage module.
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

/**
 * @jest-environment jsdom
 */

import { JSDOM } from 'jsdom';

import { first, last, xf } from '../../src/functions.js';
// import { watch } from '../../src/watch.js';


describe('Watch', () => {

    global.console = {
        log: jest.fn(),
        error: console.error,
        warn: console.warn,
    };

    jest.useFakeTimers();

    describe.skip('auto start', () => {
        // first tick
        xf.dispatch('power', 0);
        jest.advanceTimersByTime(1000);

        test('0s', () => {
            expect(watch.elapsed).toBe(0);
            expect(watch.state).toBe('stopped');
            expect(watch.stateWorkout).toBe('stopped');
            expect(watch.autoStartCounter).toBe(3);
            expect(watch.autoPauseCounter).toBe(0);
            expect(watch.hasBeenAutoPaused).toBe(false);
            expect(watch.autoPause).toBe(true);
            expect(watch.autoStart).toBe(true);
        });
    });
});

