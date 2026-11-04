/*
 * jest.config.js: project utility module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

export default {
    testEnvironment: 'jsdom',
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/server/'],
    setupFiles: ['<rootDir>/test/jest-setup.js'],
    transform: {
        '^.+\\.js$': 'babel-jest',
    },
};
