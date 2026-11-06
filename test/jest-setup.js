/*
 * jest-setup.js: test coverage module.
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

// Jest's pretend browser window does not include Node's text encoder.
// The jsdom package asks for it the moment a test imports it.
import { TextDecoder, TextEncoder } from 'node:util';
import { serialize, deserialize } from 'node:v8';

// jsdom does not expose structuredClone; fake-indexeddb needs it to store values.
if (typeof globalThis.structuredClone === 'undefined') {
    globalThis.structuredClone = value => {
        try {
            return deserialize(serialize(value));
        } catch (error) {
            throw new DOMException(error.message, 'DataCloneError');
        }
    };
}

if (typeof globalThis.TextEncoder === 'undefined') {
    globalThis.TextEncoder = TextEncoder;
}

if (typeof globalThis.TextDecoder === 'undefined') {
    globalThis.TextDecoder = TextDecoder;
}
