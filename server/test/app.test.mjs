/*
 * app.test.mjs: backend service module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../app.mjs';
import { CoachingService } from '../../src/coaching/service.js';
import { profile, goal, start, timestamp, memoryStorage } from '../../test/coaching/fixtures.js';

const origin = 'http://localhost:1234';
const credentials = {email: 'rider@example.com', password: 'a long test password'};
const backup = {version: 1, savedAt: timestamp, settings: {ftp: '250'},
    calendar: [], workouts: [], activities: []};

async function fixture(t, options = {}) {
    let app = createApp({database: ':memory:', origin, clock: () => Date.parse(timestamp), ...options});
    async function listen() {
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    }
    await listen();
    const request = async (path, {method = 'GET', body, cookie, headers = {}} = {}) => {
        const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/server/${path}`, {
            method, headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Auuki-Client': '1',
                ...(cookie ? {Cookie: cookie} : {}), ...headers},
            ...(body === undefined ? {} : {body: typeof body === 'string' ? body : JSON.stringify(body)}),
        });
        return {status: response.status, headers: response.headers, data: await response.json()};
    };
    const close = async () => {
        await new Promise(resolve => app.server.close(resolve));
        app.close();
    };
    t.after(close);
    return {request, restart: async () => {
        await close();
        app = createApp({database: ':memory:', origin, clock: () => Date.parse(timestamp), ...options});
        await listen();
    }};
}

async function register(request, data = credentials) {
    const result = await request('register', {method: 'POST', body: data});
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
}

test('accounts use protected cookies, validate credentials, and revoke sessions', async t => {
    const {request} = await fixture(t);
    assert.equal((await request('session')).status, 401);
    assert.equal((await request('health')).data.available, true);
    const registered = await request('register', {method: 'POST', body: credentials});
    assert.equal(registered.status, 200);
    assert.match(registered.headers.get('set-cookie'), /HttpOnly; SameSite=Strict; Max-Age=604800; Secure/);
    assert.equal(registered.headers.get('cache-control'), 'no-store');
    const cookie = registered.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await request('session', {cookie})).data, {email: credentials.email});
    assert.equal((await request('register', {method: 'POST', body: credentials})).status, 409);
    assert.equal((await request('login', {method: 'POST',
        body: {...credentials, password: 'wrong password here'}})).status, 401);
    assert.equal((await request('login', {method: 'POST', body: {
        ...credentials, email: 'unknown@example.com'}})).status, 401);
    const login = await request('login', {method: 'POST', body: {...credentials, email: ' RIDER@EXAMPLE.COM '}, cookie});
    assert.equal(login.status, 200);
    assert.equal((await request('session', {cookie})).status, 401);
    const newCookie = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await request('logout', {method: 'POST', body: {}, cookie: newCookie})).status, 200);
    assert.equal((await request('session', {cookie: newCookie})).status, 401);
});

test('rejects invalid requests and cross-origin writes without altering data', async t => {
    const {request} = await fixture(t);
    const cookie = await register(request);
    for(const badOrigin of ['https://untrusted.example', 'null', '']) {
        assert.equal((await request('backup', {method: 'PUT', cookie,
            body: {data: backup, revision: 0}, headers: {Origin: badOrigin}})).status, 403);
    }
    assert.equal((await request('backup', {method: 'PUT', cookie, body: {},
        headers: {'Content-Type': 'text/plain'}})).status, 415);
    assert.equal((await request('backup', {method: 'PUT', cookie, body: {},
        headers: {'X-Auuki-Client': ''}})).status, 415);
    assert.equal((await request('backup', {method: 'PUT', cookie, body: '{invalid'})).status, 400);
    assert.equal((await request('backup', {method: 'PUT', cookie, body: []})).status, 400);
    assert.equal((await request('register', {method: 'POST', body: {...credentials, password: 'short'}})).status, 400);
    assert.deepEqual((await request('backup', {cookie})).data, {data: null, revision: 0});
});

test('explicit public and local aliases work behind a proxy without trusting forwarded headers', async t => {
    const {request} = await fixture(t, {origin: 'https://cycling.example.com/',
        additionalOrigins: ['https://mobile.example.com', 'http://127.0.0.1:1234']});
    for(const allowed of ['https://cycling.example.com', 'https://mobile.example.com', 'http://127.0.0.1:1234']) {
        const registered = await request('register', {method: 'POST',
            headers: {Origin: allowed, Host: 'backend:3000'},
            body: {...credentials, email: `rider${allowed.length}@example.com`}});
        assert.equal(registered.status, 200);
        const cookie = registered.headers.get('set-cookie').split(';')[0];
        assert.equal((await request('session', {cookie})).status, 200);
        assert.equal((await request('login', {method: 'POST', headers: {Origin: allowed},
            body: {...credentials, email: `rider${allowed.length}@example.com`}})).status, 200);
    }
    for(const rejected of ['https://evil.example', 'https://cycling.example.com.evil.example',
        'http://cycling.example.com', 'https://cycling.example.com:8443', 'null', '']) {
        const result = await request('register', {method: 'POST', body: credentials, headers: {
            Origin: rejected, 'X-Forwarded-Host': 'cycling.example.com', 'X-Forwarded-Proto': 'https',
        }});
        assert.equal(result.status, 403);
        assert.match(result.data.error, /AUUKI_ORIGIN/);
    }
    assert.equal((await request('coaching')).status, 401);
    assert.equal((await request('backup')).status, 401);
    assert.equal((await request('integrations/intervals')).status, 401);
});

test('invalid origin configuration and non-local insecure cookies fail at startup', () => {
    for(const origin of ['https://example.com/path', 'https://user:pass@example.com',
        'https://example.com?query=1', 'https://example.com#fragment', 'file:///']) {
        assert.throws(() => createApp({database: ':memory:', origin}), /origins must be/);
    }
    assert.throws(() => createApp({database: ':memory:', origin,
        additionalOrigins: ['https://example.com'], secureCookies: false}), /only allowed for localhost/);
});

test('private backups are isolated, revisioned, persistent, and deleted with the account', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'auuki-test-'));
    const {request, restart} = await fixture(t, {database: join(directory, 'accounts.sqlite')});
    t.after(() => rm(directory, {recursive: true, force: true}));
    const alice = await register(request);
    const bob = await register(request, {...credentials, email: 'bob@example.com'});
    const saved = await request('backup', {method: 'PUT', cookie: alice, body: {data: backup, revision: 0}});
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.data, {data: backup, revision: 1});
    assert.deepEqual((await request('backup', {cookie: bob})).data, {data: null, revision: 0});
    assert.equal((await request('backup', {method: 'PUT', cookie: bob, headers: {'X-Auuki-Account': credentials.email},
        body: {data: backup, revision: 0}})).status, 409);
    assert.equal((await request('backup', {method: 'PUT', cookie: alice, body: {data: backup, revision: 0}})).status, 409);
    assert.equal((await request('backup', {method: 'PUT', cookie: alice, body: {data: backup}})).status, 400);
    assert.equal((await request('backup', {method: 'PUT', cookie: alice, body: {data: {version: 2}, revision: 1}})).status, 400);
    await restart();
    assert.equal((await request('login', {method: 'POST', body: credentials})).status, 200);
    assert.deepEqual((await request('backup', {cookie: alice})).data, saved.data);
    assert.equal((await request('account', {method: 'DELETE', cookie: alice, body: {confirm: 'wrong@example.com'}})).status, 400);
    assert.equal((await request('account', {method: 'DELETE', cookie: alice, body: {confirm: credentials.email}})).status, 200);
    assert.equal((await request('backup', {cookie: alice})).status, 401);
    const newAlice = await register(request);
    assert.deepEqual((await request('backup', {cookie: newAlice})).data, {data: null, revision: 0});
    assert.equal((await request('session', {cookie: bob})).status, 200);
});

test('server executes the shared coach, saves adaptations, and rejects stale or invalid operations', async t => {
    const {request} = await fixture(t);
    const cookie = await register(request);
    const otherCookie = await register(request, {...credentials, email: 'other@example.com'});
    let current = (await request('coaching', {cookie})).data;
    const call = async (method, args) => {
        const result = await request('coaching', {method: 'POST', cookie,
            body: {method, args, revision: current.revision}});
        if(result.status === 200) current = result.data;
        return result;
    };
    assert.equal(current.data.profile, null);
    assert.equal((await call('constructor', [])).status, 400);
    assert.equal((await call('generate', [start])).status, 400);
    assert.equal((await call('configure', [profile, goal])).status, 200);
    assert.equal((await call('generate', [start])).status, 200);
    const local = new CoachingService(memoryStorage(), () => new Date(timestamp).toISOString());
    await local.configure(profile, goal);
    assert.deepEqual(current.data.plan, await local.generate(start));
    assert.ok(current.data.plan.workouts.length > 0);
    const staleRevision = current.revision;
    assert.equal((await call('recordRide', [{
        id: 'server-ride', start: timestamp, duration: 1800, averagePower: 150, rpe: 4,
    }])).status, 200);
    assert.equal(current.data.activities.length, 1);
    assert.equal((await call('updateFeedback', ['server-ride', {rpe: 8}])).status, 200);
    assert.equal(current.data.activities[0].rpe, 8);
    assert.equal((await call('updateFeedback', ['server-ride', {rpe: 99}])).status, 400);
    assert.equal((await request('coaching', {method: 'POST', cookie,
        body: {method: 'archive', args: [], revision: staleRevision}})).status, 409);
    assert.equal((await call('advance', [])).status, 200);
    assert.equal((await call('archive', [])).status, 200);
    assert.equal((await request('coaching', {cookie})).data.data.plan.status, 'archived');
    assert.equal((await request('coaching', {cookie: otherCookie})).data.data.plan, null);
});

test('session expiry and authentication throttling', async t => {
    let now = Date.parse(timestamp);
    const {request} = await fixture(t, {clock: () => now, secureCookies: false});
    const cookie = await register(request);
    now += 7 * 86400000 + 1;
    assert.equal((await request('session', {cookie})).status, 401);
    for(let i = 0; i < 20; i++) {
        assert.equal((await request('login', {method: 'POST', body: {email: 'bad', password: 'bad'}})).status, 400);
    }
    assert.equal((await request('login', {method: 'POST', body: credentials})).status, 429);
    now += 15 * 60000 + 1;
    assert.equal((await request('login', {method: 'POST', body: credentials})).status, 200);
});

test('oversized requests return an explicit 413 response', async t => {
    const {request} = await fixture(t);
    const result = await request('login', {method: 'POST', body: 'x'.repeat(32 * 1024 * 1024 + 1)});
    assert.equal(result.status, 413);
    assert.match(result.data.error, /32 MiB/);
});

test('concurrent clients cannot silently overwrite a coaching revision', async t => {
    const {request} = await fixture(t);
    const cookie = await register(request);
    const responses = await Promise.all([1, 2].map(() => request('coaching', {
        method: 'POST', cookie, body: {method: 'configure', args: [profile, goal], revision: 0},
    })));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
    assert.equal((await request('coaching', {cookie})).data.revision, 1);
});
