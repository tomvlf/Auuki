/*
 * mode.test.js: test coverage module.
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

/** @jest-environment jsdom */
import { IDBFactory } from 'fake-indexeddb';
import { serialize, deserialize } from 'node:v8';
import { profile, goal } from '../coaching/fixtures.js';

const response = data => ({ok: true, headers: {get: () => 'application/json'}, json: async () => data});

beforeEach(() => {
    jest.resetModules();
    window.localStorage.clear();
    Object.defineProperty(window, 'indexedDB', {value: new IDBFactory(), configurable: true});
    globalThis.structuredClone = value => deserialize(serialize(value));
    global.fetch = jest.fn();
});

test('switching to server coaching does not upload or replace local history', async () => {
    const service = require('../../src/coaching/service.js');
    const local = await service.initializeCoaching();
    await local.configure(profile, goal);
    expect(fetch).not.toHaveBeenCalled();
    const remoteData = {profile: null, plan: null, activities: []};
    fetch.mockResolvedValueOnce(response({email: 'server@example.com'}))
        .mockResolvedValueOnce(response({data: remoteData, revision: 0}))
        .mockResolvedValueOnce(response({data: remoteData, revision: 0, result: null}));
    const remote = await service.useServerCoaching();
    expect(service.coachingService()).toBe(remote);
    expect(service.coachingData().profile).toBeNull();
    expect(local.data.profile).toEqual(profile);
    expect(window.localStorage.getItem('athlima-server-mode')).toBe('1');
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({method: 'advance', args: [], revision: 0});
    expect(await service.useLocalCoaching()).toBe(local);
    expect(service.coachingData().profile).toEqual(profile);
    expect(window.localStorage.getItem('athlima-server-mode')).toBeNull();
});

test('startup in server mode never silently falls back to local coaching on failure', async () => {
    window.localStorage.setItem('athlima-server-mode', '1');
    fetch.mockRejectedValue(new Error('Server unreachable'));
    const service = require('../../src/coaching/service.js');
    await expect(service.initializeCoaching()).rejects.toThrow('Cannot reach the Athlima server');
    expect(service.coachingData()).toBeNull();
    expect(() => service.coachingService()).toThrow('not loaded');
    expect(window.localStorage.getItem('athlima-server-mode')).toBe('1');
    await service.useLocalCoaching();
    expect(service.coachingData().profile).toBeNull();
    expect(window.localStorage.getItem('athlima-server-mode')).toBeNull();
});

test('a delayed server startup cannot override an explicit local-only switch', async () => {
    window.localStorage.setItem('athlima-server-mode', '1');
    let finish;
    fetch.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }))
        .mockResolvedValueOnce(response({data: {profile: {id: 'server'}}, revision: 1}));
    const service = require('../../src/coaching/service.js');
    const pending = service.initializeCoaching();
    const local = await service.useLocalCoaching();
    finish(response({email: 'server@example.com'}));
    expect(await pending).toBe(local);
    expect(service.coachingService()).toBe(local);
    expect(service.coachingData().profile).toBeNull();
    expect(window.localStorage.getItem('athlima-server-mode')).toBeNull();
    expect(require('../../src/server/client.js').serverAccount.email).toBeNull();
});
