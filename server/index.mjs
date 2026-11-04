/*
 * index.mjs: backend service module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * initialises the application entry point and wires the app together for startup.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app.mjs';

const database = process.env.AUUKI_DATABASE || './data/auuki.sqlite';
mkdirSync(dirname(database), {recursive: true, mode: 0o700});
const origin = process.env.AUUKI_ORIGIN || 'http://localhost:1234';
const additionalOrigins = process.env.AUUKI_ADDITIONAL_ORIGINS
    ? process.env.AUUKI_ADDITIONAL_ORIGINS.split(',').map(value => value.trim()).filter(Boolean)
    : process.env.AUUKI_ORIGIN ? [] : ['http://127.0.0.1:1234'];
const app = createApp({database, origin, additionalOrigins, secureCookies: process.env.AUUKI_INSECURE_COOKIES !== '1',
    encryptionKey: process.env.AUUKI_INTEGRATION_KEY});
const port = Number(process.env.PORT || 3000);
app.server.listen(port, '0.0.0.0', () => console.log(`Auuki backend listening on ${port}; trusted browser origins ${[origin, ...additionalOrigins].join(', ')}`));
for(const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => app.server.close(() => { app.close(); process.exit(0); }));
}
