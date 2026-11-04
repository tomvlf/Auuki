/*
 * account.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * persists user and application data in the browser so settings and workouts survive reloads.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

let scope = '';

export function setAccountScope(email) {
    scope = email ? `athlima:${encodeURIComponent(email)}:` : '';
}

export const accountKey = key => `${scope}${key}`;
export const accountDatabase = () => scope ? `${scope}store` : 'store';
export const hasAccountScope = () => Boolean(scope);
export const accountStorage = {
    getItem: key => window.localStorage.getItem(accountKey(key)),
    setItem: (key, value) => window.localStorage.setItem(accountKey(key), value),
    removeItem: key => window.localStorage.removeItem(accountKey(key)),
};
