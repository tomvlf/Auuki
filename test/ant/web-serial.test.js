/*
 * web-serial.test.js: test coverage module.
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

import { MessageTransformer } from '../../src/ant/web-serial.js';

function frame(payload = [0]) {
    return Uint8Array.from([0xA4, payload.length + 1, 0x4E, 0, ...payload, 0]);
}

function transform(chunks) {
    const parser = new MessageTransformer();
    const messages = [];
    const controller = {enqueue: message => messages.push(Array.from(message))};
    chunks.forEach(chunk => parser.transform(Uint8Array.from(chunk), controller));
    return messages;
}

describe('ANT+ serial framing', () => {
    test('retains partial frames and emits them when completed', () => {
        const bytes = frame([1, 2, 3]);
        expect(transform([bytes.slice(0, 3), bytes.slice(3)])).toEqual([Array.from(bytes)]);
    });

    test('emits all complete frames and skips bytes before sync', () => {
        const first = frame([1]);
        const second = frame([2, 3]);
        expect(transform([[0, 1, ...first, ...second]])).toEqual([
            Array.from(first),
            Array.from(second),
        ]);
    });

});
