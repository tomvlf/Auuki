/*
 * origins.mjs: backend service module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * provides the server-side API and integration logic that authenticates users and syncs external training data.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

export function trustedOrigins(origin, additionalOrigins = []) {
    return new Set([origin, ...additionalOrigins].map(value => {
        const url = new URL(value);
        if(!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
           url.search || url.hash || url.pathname !== '/') {
            throw new Error('Athlima origins must be HTTP(S) scheme/host/port values without paths, credentials, queries or fragments.');
        }
        return url.origin;
    }));
}
