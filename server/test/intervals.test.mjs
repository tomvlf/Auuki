/*
 * intervals.test.mjs: backend service module.
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

// These tests document the expected behavior for the Intervals.icu integration.
// Read them as examples of user flows, not as isolated unit tests:
//
// - connection + encryption
// - valid/invalid API-key handling
// - account isolation and secure persistence
// - retry logic and batch import progress
// - disconnect/reconnect race conditions
// - athlete-specific API usage
// - upload + coaching history integration
//
// The goal is to protect the user-facing behavior: if a rider connects their own
// Intervals account, Athlima must keep the API key encrypted, use the correct athlete ID,
// and never allow one account to read or mutate another account's provider data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '../app.mjs';
import { compactProfile, intervalsActivity } from '../intervals.mjs';
import { profile, goal } from '../../test/coaching/fixtures.js';

const origin = 'http://localhost:1234';
const key = Buffer.alloc(32, 7).toString('base64');
const apiKey = 'personal-test-api-key';
const endpoint = 'integrations/intervals';
const activity = {id: 'i123', name: 'Morning ride', type: 'Ride',
    start_date: '2026-03-19T10:00:00Z', moving_time: 3600, distance: 30000,
    icu_average_watts: 170, icu_weighted_avg_watts: 190, icu_ftp: 250,
    average_heartrate: 145, average_cadence: 88, total_elevation_gain: 200};
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
    status, headers: {'Content-Type': 'application/json', ...headers},
});

async function fixture(t, options = {}) {
    let now = Date.parse('2026-03-20T12:00:00Z');
    let remote = async url => url.endsWith('/athlete/0') ? json({id: 42}) : json([]);
    const calls = [];
    const configuration = {database: ':memory:', origin, encryptionKey: key,
        startWorker: false, clock: () => now,
        fetchImpl: async (url, args) => { calls.push({url, args}); return remote(url, args); }, ...options};
    let app;
    async function start() {
        app = createApp(configuration);
        await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    }
    await start();
    const request = async (path, {method = 'GET', body, cookie, headers = {}} = {}) => {
        const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/server/${path}`, {
            method, headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Athlima-Client': '1',
                ...(cookie ? {Cookie: cookie} : {}), ...headers},
            ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        });
        return {status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0]};
    };
    const register = async email => (await request('register', {method: 'POST',
        body: {email: email || 'rider@example.com', password: 'a long test password'}})).cookie;
    const close = async () => { await new Promise(resolve => app.server.close(resolve)); app.close(); };
    t.after(close);
    return {
        request, register, calls,
        tick: () => app.intervals.tick(),
        advance: ms => { now += ms; },
        remote: fn => { remote = fn; },
        restart: async (overrides = {}) => { await close(); Object.assign(configuration, overrides); await start(); },
        connect: (cookie, oldest = '2026-03-01') => request(endpoint, {method: 'PUT', cookie, body: {apiKey, oldest}}),
        sync: cookie => request(`${endpoint}/sync`, {method: 'POST', cookie, body: {}}),
        status: cookie => request(endpoint, {cookie}),
        history: async cookie => (await request('coaching', {cookie})).data,
    };
}

test('provider adapter maps every activity type and retains provenance without fabricating measurements', () => {
    const raw = intervalsActivity(activity, '2026-03-20T12:00:00Z');
    assert.equal(raw.id, 'intervals:i123');
    assert.equal(raw.duration, 3600);
    assert.equal(raw.normalizedPower, 190);
    assert.equal(raw.externalId, 'i123');
    assert.deepEqual(raw.providerIds, {intervals: 'i123'});
    assert.equal(raw.start, activity.start_date);
    const run = intervalsActivity({...activity, type: 'TrailRun', icu_rpe: 6, timezone: 'Europe/Brussels'});
    assert.equal(run.sport, 'running');
    assert.equal(run.activityType, 'TrailRun');
    assert.equal(run.rpe, 6);
    assert.equal(run.timeZone, 'Europe/Brussels');
    assert.equal(intervalsActivity({...activity, type: 'Yoga'}).sport, 'mobility');
    assert.equal(intervalsActivity({...activity, type: 'SomethingNew'}).sport, 'other');
    assert.equal(intervalsActivity({...activity, type: 'GravelRide'}).sport, 'cycling');
    assert.equal(intervalsActivity({...activity, timezone: 'Not/AZone'}).timeZone, undefined);
    assert.equal(intervalsActivity({...activity, type: 'WeightTraining', moving_time: 0, elapsed_time: 1800}).duration, 1800);
    assert.equal(intervalsActivity({...activity, type: 'WeightTraining', moving_time: 0}), null);
    assert.equal(intervalsActivity({...activity, type: 'Ride', trainer: true}).indoor, true);
    assert.equal(intervalsActivity({...activity, type: 'VirtualRide'}).indoor, true);
    assert.equal(intervalsActivity({...activity, external_id: 'athlima:recording-123'}).id, 'recording-123');
    assert.equal(intervalsActivity({...activity, icu_weighted_avg_watts: null}).normalizedPower, null);
    assert.equal(intervalsActivity({...activity, start_date: null}), null);
    assert.equal(intervalsActivity({...activity, moving_time: 0, elapsed_time: 0}), null);
});

test('provider adapter keeps Intervals summary details while dropping internal and invalid values', () => {
    const raw = intervalsActivity({...activity, max_heartrate: 182, icu_joules: 650000, icu_training_load: 74,
        calories: 900, decoupling: 3.2, icu_zone_times: [{id: 'Z1', secs: 600}, {id: 'Z2', secs: 1200}],
        icu_hr_zone_times: [100, 200], gear: {id: 'b1', name: 'Gravel bike'}, tags: ['race'],
        description: 'Felt good', icu_chat_id: 99, skyline_chart_bytes: ['AAA'], average_temp: Number.NaN,
        interval_summary: ['2x 10m 250w']});
    assert.equal(raw.maximumHeartRate, 182);
    assert.equal(raw.workKj, 650);
    assert.equal(raw.hasIntervals, true);
    assert.equal(raw.details.trainingLoad, 74);
    assert.equal(raw.details.gear, 'Gravel bike');
    assert.deepEqual(raw.details.powerZoneTimes, [{id: 'Z1', secs: 600}, {id: 'Z2', secs: 1200}]);
    assert.deepEqual(raw.details.heartRateZoneTimes, [100, 200]);
    assert.equal(raw.details.description, 'Felt good');
    assert.equal(raw.details.averageTemp, undefined);
    assert.equal('icu_chat_id' in raw.details || 'skyline' in raw.details, false);
});

test('compact profiles average streams into short previews', () => {
    assert.deepEqual(compactProfile([100, 200, null, 300], 2), [150, 300]);
    assert.equal(compactProfile([null, 5]), null);
    assert.equal(compactProfile('bad'), null);
    assert.equal(compactProfile(Array.from({length: 3600}, () => 200)).length, 120);
});

test('imports power and heart-rate profiles from streams and reuses them until Intervals re-analyses', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    const streamed = {...activity, stream_types: ['watts', 'heartrate', 'cadence'], analyzed: '2026-03-19T12:00:00Z'};
    const watts = Array.from({length: 3600}, (_, i) => i === 10 ? 900 : 200);
    f.remote(async url => url.includes('/streams') ? json([{type: 'watts', data: watts},
        {type: 'heartrate', data: Array.from({length: 3600}, () => 140)}]) : json([streamed,
        {...activity, id: 'swim', type: 'Swim', stream_types: ['heartrate']}]));
    await f.sync(cookie);
    await f.tick();
    let history = await f.history(cookie);
    const ride = history.data.activities.find(item => item.id === 'intervals:i123');
    assert.equal(ride.powerProfile.length, 120);
    assert.equal(ride.heartRateProfile[0], 140);
    assert.equal(ride.maximumPower, 900);
    assert.equal(history.data.activities.find(item => item.id === 'intervals:swim').sport, 'swimming');
    const streamCalls = () => f.calls.filter(call => call.url.includes('/streams'));
    assert.equal(streamCalls().length, 2);
    assert.equal(new URL(streamCalls()[0].url).pathname, '/api/v1/activity/i123/streams.json');

    f.advance(86400000);
    await f.sync(cookie);
    await f.tick();
    assert.equal(streamCalls().length, 2);
    assert.equal((await f.history(cookie)).data.activities.find(item => item.id === 'intervals:i123').maximumPower, 900);

    streamed.analyzed = '2026-03-21T08:00:00Z';
    f.advance(86400000);
    await f.sync(cookie);
    await f.tick();
    assert.equal(streamCalls().length, 3);
});

test('activity data endpoint returns full on-demand streams and account-scoped route data', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    f.remote(async url => {
        const path = new URL(url).pathname;
        if(path.endsWith('/activities')) return json([activity]);
        if(path.endsWith('/streams.json')) return json([
            {type: 'watts', data: [180, 0, 220]},
            {type: 'heartrate', data: [120, 121, 122]},
            {type: 'cadence', data: [80, 82, 84]},
            {type: 'time', data: [0, 1, 2]},
        ]);
        if(path.endsWith('/map')) return json({latlngs: [[52.1, 5.1], [52.2, 5.2]]});
        return json({id: 42});
    });
    await f.sync(cookie);
    await f.tick();
    const result = await f.request(`${endpoint}/activity-data?activityId=i123`, {cookie});
    assert.equal(result.status, 200);
    assert.deepEqual(result.data.streams, {
        watts: [180, 0, 220], heartrate: [120, 121, 122], cadence: [80, 82, 84], time: [0, 1, 2],
    });
    assert.deepEqual(result.data.map, {latlngs: [[52.1, 5.1], [52.2, 5.2]]});
    const streamCall = f.calls.find(call => call.url.endsWith('/streams.json?types=watts%2Cheartrate%2Ccadence%2Ctime'));
    assert.ok(streamCall);
    assert.match(streamCall.args.headers.Authorization, /^Basic /);

    const other = await f.register('other@example.com');
    await f.connect(other);
    const denied = await f.request(`${endpoint}/activity-data?activityId=i123`, {cookie: other});
    assert.equal(denied.status, 404);
    assert.equal((await f.request(`${endpoint}/activity-data?activityId=unknown`, {cookie})).status, 404);
});

test('integration endpoints require authentication, CSRF headers, encryption configuration and valid inputs', async t => {
    const f = await fixture(t, {encryptionKey: undefined});
    assert.equal((await f.status()).status, 401);
    const cookie = await f.register();
    assert.equal((await f.status(cookie)).data.configured, false);
    assert.equal((await f.connect(cookie)).status, 503);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request(endpoint, {cookie, method: 'PUT', body: {apiKey},
        headers: {Origin: 'https://untrusted.example'}})).status, 403);
    assert.throws(() => createApp({database: ':memory:', encryptionKey: 'not-a-key'}), /32-byte/);
});

test('encrypted credentials survive restart, never appear in responses, and are account isolated', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'athlima-intervals-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const database = join(directory, 'server.sqlite');
    const f = await fixture(t, {database});
    const alice = await f.register();
    const bob = await f.register('bob@example.com');
    const connected = await f.connect(alice);
    assert.equal(connected.status, 200);
    assert.equal(connected.data.connected, true);
    assert.ok(!JSON.stringify(connected).includes(apiKey));
    assert.equal((await f.status(bob)).data.connected, false);
    const db = new DatabaseSync(database);
    const stored = db.prepare('SELECT credential FROM integrations').get().credential;
    db.close();
    assert.ok(!stored.includes(apiKey));
    assert.ok(stored.length > apiKey.length);
    await f.restart();
    assert.equal((await f.request(`${endpoint}/test`, {method: 'POST', cookie: alice, body: {}})).status, 200);
    assert.equal(f.calls.at(-1).args.headers.Authorization, `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`);
    assert.equal(f.calls.at(-1).args.redirect, 'error');
    assert.equal((await f.request(`${endpoint}/test`, {method: 'POST', cookie: bob, body: {}})).status, 400);
});

test('bad credentials, future dates, malformed dates and remote errors are explicit', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    for(const oldest of ['2026-02-31', '2030-01-01', '2000-01-01', undefined]) {
        assert.equal((await f.connect(cookie, oldest === undefined ? null : oldest)).status, 400);
    }
    f.remote(async () => json({error: 'secret must never be exposed'}, 401));
    const rejected = await f.connect(cookie);
    assert.equal(rejected.status, 400);
    assert.match(rejected.data.error, /rejected the API key/);
    assert.ok(!JSON.stringify(rejected).includes('secret'));
    assert.equal((await f.status(cookie)).data.connected, false);
    f.remote(async () => { throw new Error('network error containing credentials'); });
    assert.equal((await f.connect(cookie)).status, 502);
    f.remote(async () => json({unexpected: true}));
    assert.equal((await f.connect(cookie)).status, 502);
});

test('disconnect cancels an in-flight connection test instead of silently reconnecting', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    f.remote(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const pending = f.connect(cookie);
    await began;
    await f.request(endpoint, {method: 'DELETE', cookie, body: {}});
    release(json([]));
    assert.equal((await pending).status, 409);
    assert.equal((await f.status(cookie)).data.connected, false);
});

test('a later connection wins over a slow earlier test', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    let release, started;
    const began = new Promise(resolve => { started = resolve; });
    f.remote(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const pending = f.connect(cookie);
    await began;
    f.remote(async () => json([]));
    assert.equal((await f.connect(cookie, '2026-02-01')).status, 200);
    release(json([]));
    assert.equal((await pending).status, 409);
    assert.equal((await f.status(cookie)).data.oldest, '2026-02-01');
});

test('a changed server encryption key produces an actionable reconnect error', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'athlima-key-change-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const f = await fixture(t, {database: join(directory, 'server.sqlite')});
    const cookie = await f.register();
    await f.connect(cookie);
    await f.restart({encryptionKey: Buffer.alloc(32, 8).toString('base64')});
    const result = await f.request(`${endpoint}/test`, {method: 'POST', cookie, body: {}});
    assert.equal(result.status, 503);
    assert.match(result.data.error, /encryption key or reconnect/);
    await f.sync(cookie);
    await f.tick();
    const state = (await f.status(cookie)).data;
    assert.equal(state.status, 'error');
    assert.match(state.error, /encryption key or reconnect/);
});

test('an old batch failure cannot overwrite a replacement connection after disconnect', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    let release;
    f.remote(() => new Promise(resolve => { release = resolve; }));
    await f.sync(cookie);
    const pending = f.tick();
    await f.request(endpoint, {method: 'DELETE', cookie, body: {}});
    f.remote(async () => json([]));
    await f.connect(cookie, '2026-02-01');
    release(json({}, 503));
    await pending;
    const state = (await f.status(cookie)).data;
    assert.equal(state.status, 'connected');
    assert.equal(state.error, null);
    assert.equal(state.oldest, '2026-02-01');
});

test('historical imports run in bounded date ranges, persist progress, and normalize history without a Coach profile', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie, '2026-01-01');
    f.calls.length = 0;
    f.remote(async () => json([activity, {...activity, type: 'Run', id: 'run'}]));
    await f.sync(cookie);
    for(let i = 0; i < 3; i++) { await f.tick(); f.advance(1001); }
    assert.deepEqual(f.calls.map(call => {
        const params = new URL(call.url).searchParams;
        return [params.get('oldest'), params.get('newest')];
    }), [['2026-01-01', '2026-01-31'], ['2026-02-01', '2026-03-03'], ['2026-03-04', '2026-03-20']]);
    const history = await f.history(cookie);
    assert.equal(history.data.activities.length, 2);
    const ride = history.data.activities.find(item => item.id === 'intervals:i123');
    assert.equal(ride.source, 'intervals');
    assert.equal(ride.loadMetrics.power.value, 57.76);
    assert.equal(history.data.activities.find(item => item.id === 'intervals:run').sport, 'running');
    assert.equal((await f.status(cookie)).data.status, 'connected');
    assert.ok((await f.status(cookie)).data.lastSuccess);
});

test('repeated and incremental syncs update provider rides, preserve feedback, and never duplicate activity or plan completion', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    f.remote(async () => json([activity, activity]));
    await f.sync(cookie);
    await f.tick();
    let history = await f.history(cookie);
    let result = await f.request('coaching', {method: 'POST', cookie,
        body: {method: 'updateFeedback', args: ['intervals:i123', {rpe: 7}], revision: history.revision}});
    assert.equal(result.status, 200);
    f.advance(86400000);
    f.remote(async () => json([{...activity, name: 'Corrected name', moving_time: 4000}]));
    await f.sync(cookie);
    await f.tick();
    history = await f.history(cookie);
    assert.equal(history.data.activities.length, 1);
    assert.equal(history.data.activities[0].name, 'Corrected name');
    assert.equal(history.data.activities[0].duration, 4000);
    assert.equal(history.data.activities[0].rpe, 7);
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('oldest'), '2026-03-13');
});

test('malformed activities are skipped with a notice instead of blocking the import', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    f.remote(async () => json([activity,
        {...activity, id: 'broken', name: 'Broken ride', start_date: 'not-an-iso-date'},
        {...activity, id: 'no-time', name: 'No time', moving_time: 0, elapsed_time: 0}]));
    await f.sync(cookie);
    await f.tick();
    assert.equal((await f.history(cookie)).data.activities.length, 1);
    const synced = (await f.status(cookie)).data;
    assert.equal(synced.status, 'connected');
    assert.equal(synced.error, null);
    const notice = synced.skipped;
    assert.equal(notice.length, 2);
    assert.ok(notice.some(label => label.includes('Broken ride')));
    assert.ok(notice.some(label => label.includes('No time')));
    f.remote(async () => json([activity]));
    await f.sync(cookie);
    await f.tick();
    assert.deepEqual((await f.status(cookie)).data.skipped, []);
});

test('sync matches offline rides before reviewing overdue sessions, then persists corrected coaching state', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    const mutate = async (method, args) => {
        const stored = await f.history(cookie);
        const result = await f.request('coaching', {method: 'POST', cookie,
            body: {method, args, revision: stored.revision}});
        assert.equal(result.status, 200, JSON.stringify(result.data));
        return result.data;
    };
    await mutate('configure', [profile, {...goal, date: '2026-05-01'}]);
    const generated = await mutate('generate', ['2026-03-01']);
    const workout = generated.data.plan.workouts[0];
    assert.ok(workout.date < '2026-03-20');
    const offlineRide = {...activity, start_date: `${workout.date}T10:00:00Z`,
        moving_time: workout.duration, icu_weighted_avg_watts: workout.targetIntensity * profile.ftp};
    await f.connect(cookie, '2026-02-01');
    f.remote(async url => {
        const params = new URL(url).searchParams;
        return json(params.get('oldest') <= workout.date && params.get('newest') >= workout.date
            ? [offlineRide] : []);
    });
    await f.sync(cookie);
    await f.tick();
    let stored = await f.history(cookie);
    assert.equal((await f.status(cookie)).data.status, 'queued');
    assert.equal(stored.data.plan.workouts.find(w => w.id === workout.id).status, 'completed');
    assert.equal(stored.data.plan.workouts.some(w => w.status === 'missed'), false);
    f.advance(1001);
    await f.tick();
    stored = await f.history(cookie);
    assert.equal((await f.status(cookie)).data.status, 'connected');
    assert.ok(stored.data.plan.workouts.some(w => w.status === 'missed'));
    const completed = stored.data.plan.workouts.find(w => w.id === workout.id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.matchedActivity, 'intervals:i123');

    await mutate('updateFeedback', ['intervals:i123', {rpe: 5}]);
    const before = await f.history(cookie);
    // Return the provider correction in the next incremental batch.
    f.remote(async () => json([{...offlineRide, icu_weighted_avg_watts: 300}]));
    await f.sync(cookie);
    f.advance(1001);
    await f.tick();
    const corrected = await f.history(cookie);
    assert.equal(corrected.data.plan.revision, before.data.plan.revision + 1);
    assert.equal(corrected.data.activities[0].normalizedPower, 300);
    assert.equal(corrected.data.activities[0].rpe, 5);
    assert.deepEqual(corrected.data.plan.workouts.find(w => w.id === workout.id), completed);
    assert.notEqual(corrected.data.snapshots.at(-1).acuteLoad, before.data.snapshots.at(-1).acuteLoad);
});

test('a launch during an older in-flight sync extends it through the current day', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie, '2026-03-20');
    let finish;
    f.remote(() => new Promise(resolve => { finish = resolve; }));
    await f.sync(cookie);
    const pending = f.tick();
    f.advance(86400000);
    const queued = await f.sync(cookie);
    assert.equal(queued.data.status, 'running');
    assert.equal(queued.data.through, '2026-03-21');
    finish(json([]));
    await pending;
    assert.equal((await f.status(cookie)).data.status, 'queued');
    f.advance(1001);
    f.remote(async () => json([{...activity, start_date: '2026-03-21T10:00:00Z'}]));
    await f.tick();
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('oldest'), '2026-03-21');
    assert.equal((await f.history(cookie)).data.activities.length, 1);
    assert.equal((await f.status(cookie)).data.status, 'connected');
});

test('rate limits honor Retry-After, retry transient failures, and bound attempts', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    f.remote(async () => json({}, 429, {'Retry-After': '120'}));
    await f.sync(cookie);
    await f.tick();
    assert.equal((await f.status(cookie)).data.status, 'queued');
    assert.match((await f.status(cookie)).data.error, /rate limited/);
    const count = f.calls.length;
    f.advance(119000);
    await f.tick();
    assert.equal(f.calls.length, count);
    f.advance(1001);
    await f.tick();
    assert.equal(f.calls.length, count + 1);
    f.remote(async () => json({}, 503));
    for(let i = 0; i < 4; i++) { f.advance(3600000); await f.tick(); }
    assert.equal((await f.status(cookie)).data.status, 'error');
    assert.match((await f.status(cookie)).data.error, /503/);
});

test('concurrent sync requests coalesce and disconnect during an in-flight batch prevents any commit', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    let release;
    f.remote(() => new Promise(resolve => { release = resolve; }));
    await Promise.all([f.sync(cookie), f.sync(cookie), f.sync(cookie)]);
    const pending = f.tick();
    assert.equal((await f.status(cookie)).data.status, 'running');
    await f.tick();
    assert.equal(f.calls.length, 2); // Connection test plus one worker.
    await f.request(endpoint, {method: 'DELETE', cookie, body: {}});
    release(json([activity]));
    await pending;
    assert.equal((await f.status(cookie)).data.connected, false);
    assert.equal((await f.history(cookie)).data.activities.length, 0);
});

test('queued imports resume from persistent cursor after process restart', async t => {
    const directory = await mkdtemp(join(tmpdir(), 'athlima-resume-'));
    t.after(() => rm(directory, {recursive: true, force: true}));
    const f = await fixture(t, {database: join(directory, 'server.sqlite')});
    const cookie = await f.register();
    await f.connect(cookie, '2026-01-01');
    await f.sync(cookie);
    await f.tick();
    assert.equal((await f.status(cookie)).data.nextDate, '2026-02-01');
    await f.restart();
    f.advance(1001);
    await f.tick();
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('oldest'), '2026-02-01');
});

test('API-key proxy preserves athlete settings, planned ZWO workouts and FIT upload without legacy OAuth', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    assert.equal((await f.status(cookie)).data.athleteId, '42');
    f.remote(async url => url.includes('/events?') ? json([{id: 42, workout_file_base64: 'ZWO'}])
        : url.endsWith('/athlete/42') ? json({id: 42, sportSettings: [{types: ['Ride'], ftp: 250}]})
            : json({id: 'uploaded'}));
    const athlete = await f.request(`${endpoint}/athlete`, {cookie});
    assert.equal(athlete.data.sportSettings[0].ftp, 250);
    const events = await f.request(`${endpoint}/events?oldest=2026-03-01&newest=2026-03-31`, {cookie});
    assert.equal(events.data[0].id, 42);
    const params = new URL(f.calls.at(-1).url).searchParams;
    assert.equal(params.get('ext'), 'zwo');
    assert.equal(params.get('category'), 'WORKOUT');
    assert.equal(params.get('resolve'), 'true');
    assert.equal((await f.request(`${endpoint}/events?oldest=2026-01-01&newest=2026-12-31`, {cookie})).status, 400);
    const fit = Buffer.alloc(16);
    fit.write('.FIT', 8);
    const uploaded = await f.request(`${endpoint}/upload`, {method: 'POST', cookie,
        body: {id: 'local-ride', name: 'My ride', file: fit.toString('base64')}});
    assert.equal(uploaded.status, 200);
    assert.equal(new URL(f.calls.at(-1).url).searchParams.get('external_id'), 'athlima:local-ride');
    assert.equal(f.calls.at(-1).args.method, 'POST');
    assert.ok(f.calls.at(-1).args.body instanceof FormData);
    assert.equal((await f.request(`${endpoint}/upload`, {method: 'POST', cookie,
        body: {id: 'invalid', name: 'invalid', file: 'aW52YWxpZA=='}})).status, 400);
});

test('account deletion removes integration credentials and pending jobs', async t => {
    const f = await fixture(t);
    const cookie = await f.register();
    await f.connect(cookie);
    await f.sync(cookie);
    await f.request('account', {method: 'DELETE', cookie, body: {confirm: 'rider@example.com'}});
    f.calls.length = 0;
    await f.tick();
    assert.equal(f.calls.length, 0);
    assert.equal((await f.status(cookie)).status, 401);
});

test('normalized imports inform server plan generation and cannot be read from another account', async t => {
    const f = await fixture(t);
    const alice = await f.register();
    const bob = await f.register('other@example.com');
    let stored = await f.history(alice);
    await f.request('coaching', {method: 'POST', cookie: alice,
        body: {method: 'configure', args: [profile, {...goal, date: '2026-05-01'}], revision: stored.revision}});
    await f.connect(alice);
    f.remote(async () => json([activity]));
    await f.sync(alice);
    await f.tick();
    stored = await f.history(alice);
    const generated = await f.request('coaching', {method: 'POST', cookie: alice,
        body: {method: 'generate', args: ['2026-03-20'], revision: stored.revision}});
    assert.equal(generated.status, 200);
    assert.equal(generated.data.data.activities[0].id, 'intervals:i123');
    assert.ok(generated.data.data.snapshots[0].weeklyDuration > 0);
    assert.equal((await f.history(bob)).data.activities.length, 0);
});
