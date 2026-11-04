/*
 * client.test.js: test coverage module.
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

/** @jest-environment jsdom */
import { authenticate, ServerCoachingService, serverRequest, serverEnabled, SERVER_MODE_KEY, serverAccount } from '../../src/server/client.js';

const response = (data, ok = true) => ({ok, status: ok ? 200 : 409,
    headers: {get: () => 'application/json'}, json: async () => data});

beforeEach(() => {
    window.localStorage.clear();
    global.fetch = jest.fn();
    serverAccount.email = null;
});

test('server mode is opt-in and does not probe the server by default', () => {
    expect(serverEnabled()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    window.localStorage.setItem(SERVER_MODE_KEY, '1');
    expect(serverEnabled()).toBe(true);
});

test('remote coach uses server state and revisions for all mutations', async () => {
    fetch.mockResolvedValueOnce(response({email: 'rider@example.com'}))
        .mockResolvedValueOnce(response({data: {profile: null}, revision: 2}))
        .mockResolvedValueOnce(response({data: {profile: {id: 'server'}}, revision: 3, result: 'configured'}));
    const coach = await ServerCoachingService.open();
    expect(await coach.configure({id: 'server'}, {id: 'goal'})).toBe('configured');
    expect(coach.data.profile.id).toBe('server');
    expect(coach.revision).toBe(3);
    const [url, options] = fetch.mock.calls[2];
    expect(url).toBe('/api/server/coaching');
    expect(options.credentials).toBe('same-origin');
    expect(options.headers['X-Auuki-Client']).toBe('1');
    expect(options.headers['X-Auuki-Account']).toBe('rider@example.com');
    expect(JSON.parse(options.body)).toEqual({
        method: 'configure', args: [{id: 'server'}, {id: 'goal'}], revision: 2,
    });
});

test('failed remote changes do not mutate the last known state or silently fall back', async () => {
    const coach = new ServerCoachingService({data: {plan: 'old'}, revision: 5});
    fetch.mockResolvedValueOnce(response({error: 'Conflict: reload'}, false));
    await expect(coach.generate('2026-01-01')).rejects.toThrow('Conflict: reload');
    expect(coach.data).toEqual({plan: 'old'});
    expect(coach.revision).toBe(5);
    expect(coach.saving).toBe(false);
});

test('overlapping remote writes are rejected', async () => {
    let finish;
    fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const coach = new ServerCoachingService({data: {}, revision: 0});
    const first = coach.advance();
    await expect(coach.archive()).rejects.toThrow('Another server coaching update');
    finish(response({data: {plan: null}, revision: 0, result: null}));
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
});

test('static hosts report unavailable backend rather than a JSON parsing error', async () => {
    fetch.mockResolvedValue({headers: {get: () => 'text/html'}});
    await expect(serverRequest('session')).rejects.toThrow('Auuki backend is unavailable');
});

test('authentication expiry triggers the protected shell without silently switching to local mode', async () => {
    const expired = jest.fn();
    window.addEventListener('session:expired', expired);
    serverAccount.email = 'rider@example.com';
    fetch.mockResolvedValue({ok: false, status: 401, headers: {get: () => 'application/json'},
        json: async () => ({error: 'Your session expired'})});
    await expect(serverRequest('coaching')).rejects.toMatchObject({status: 401});
    expect(expired).toHaveBeenCalledTimes(1);
    expect(expired.mock.calls[0][0].detail).toBe('Your session expired');
    window.removeEventListener('session:expired', expired);
});

test('malformed backend responses produce an actionable error', async () => {
    fetch.mockResolvedValue({headers: {get: () => 'application/json'},
        json: async () => { throw new SyntaxError('Unexpected token'); }});
    await expect(serverRequest('login')).rejects.toThrow('backend returned an invalid response');
});

test('authentication never opens a different session account after a concurrent login', async () => {
    fetch.mockResolvedValueOnce(response({email: 'alice@example.com'}))
        .mockResolvedValueOnce(response({email: 'bob@example.com'}));
    await expect(authenticate('login', {email: 'alice@example.com', password: 'a long test password'}))
        .rejects.toThrow('signed-in account changed');
    expect(serverEnabled()).toBe(false);
});
