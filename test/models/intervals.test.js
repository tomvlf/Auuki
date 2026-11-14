import intervals from '../../src/models/intervals.js';
import { CoachingService } from '../../src/coaching/service.js';
import { xf } from '../../src/functions.js';

const KEY = 'athlima-intervals-v1';
const response = (data, status = 200) => ({ok: status === 200, status,
    headers: {get: () => null}, json: async () => data});
const stored = () => JSON.parse(localStorage.getItem(KEY));
const seed = oldest => localStorage.setItem(KEY, JSON.stringify({
    apiKey: 'test-key', athleteId: '123', oldest: oldest || '2026-01-01',
}));

beforeEach(() => {
    localStorage.clear();
    global.fetch = jest.fn();
});

test('connection resolves the athlete, persists only locally, and never sends the API key in a URL', async () => {
    fetch.mockResolvedValue(response({id: 123}));
    expect(await intervals.connect({apiKey: 'test-key', oldest: '2026-01-01'}))
        .toEqual(expect.objectContaining({connected: true, status: 'connected'}));
    expect(stored()).toEqual({apiKey: 'test-key', athleteId: '123', oldest: '2026-01-01'});
    expect(intervals.status()).not.toHaveProperty('apiKey');
    expect(fetch).toHaveBeenCalledWith('https://intervals.icu/api/v1/athlete/0', expect.objectContaining({
        credentials: 'omit', headers: {Authorization: `Basic ${btoa('API_KEY:test-key')}`, Accept: 'application/json'},
    }));
    intervals.disconnect();
    expect(localStorage.getItem(KEY)).toBeNull();
});

test('planned workouts use the resolved athlete and keep errors explicit', async () => {
    seed();
    fetch.mockResolvedValueOnce(response([{id: 1, workout_file_base64: 'ZWO'}, {id: 2}]));
    expect(await intervals.wod('2026-03-01', '2026-03-31')).toHaveLength(1);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/api/v1/athlete/123/events');
    expect(url.searchParams.get('ext')).toBe('zwo');
    expect(url.searchParams.get('oldest')).toBe('2026-03-01');
    fetch.mockResolvedValueOnce(response({}, 401));
    await expect(intervals.wod()).rejects.toThrow('rejected the API key');
});

test('connection accepts prefixed athlete IDs and preserves them in subsequent requests', async () => {
    fetch.mockResolvedValueOnce(response({id: 'i1234567'}))
        .mockResolvedValueOnce(response({id: 'i1234567', weight: 75}));
    expect(await intervals.connect({apiKey: 'test-key', oldest: '2026-01-01'}))
        .toEqual(expect.objectContaining({connected: true, athleteId: 'i1234567'}));
    expect(stored().athleteId).toBe('i1234567');
    expect(await intervals.athlete()).toEqual({id: 'i1234567', weight: 75});
    expect(new URL(fetch.mock.calls[1][0]).pathname).toBe('/api/v1/athlete/i1234567');
});

test.each([undefined, null, '', '../123', '123?other=1', 'invalid', {}])(
    'connection rejects malformed athlete ID %p without saving credentials',
    async id => {
        fetch.mockResolvedValueOnce(response({id}));
        await expect(intervals.connect({apiKey: 'test-key', oldest: '2026-01-01'}))
            .rejects.toThrow('unexpected athlete profile');
        expect(localStorage.getItem(KEY)).toBeNull();
    },
);

test('profile import and FIT upload work directly without an app account', async () => {
    seed();
    fetch.mockResolvedValueOnce(response({weight: 75, sportSettings: [{types: ['VirtualRide'], indoor_ftp: 250}]}))
        .mockResolvedValueOnce(response({id: 'remote-ride'}));
    expect(await intervals.getAthlete()).toEqual({weight: 75, ftp: 250});
    const blob = new Blob(['FIT bytes']);
    expect(await intervals.uploadWorkout({id: 'ride', summary: {name: 'Real ride'}, blob})).toBe(':success');
    const [url, options] = fetch.mock.calls[1];
    expect(new URL(url).pathname).toBe('/api/v1/athlete/123/activities');
    expect(new URL(url).searchParams.get('external_id')).toBe('athlima:ride');
    expect(options.method).toBe('POST');
    expect(options.body.get('file').name).toBe('ride.fit');
});

test('profile sync validates both values and rejects results from a disconnected account', async () => {
    seed();
    const received = jest.fn();
    const handler = xf.sub('intervals:profile', received);
    try {
        fetch.mockResolvedValueOnce(response({weight: 73.5, sportSettings: [{types: ['VirtualRide'], indoor_ftp: 600}]}));
        expect(await intervals.syncProfile()).toEqual({ftp: 600, weight: 73.5});
        expect(received).toHaveBeenCalledWith({ftp: 600, weight: 73.5});
        received.mockClear();
        fetch.mockResolvedValueOnce(response({weight: null, sportSettings: [{types: ['Ride'], ftp: 280}]}));
        await expect(intervals.syncProfile()).rejects.toThrow('valid cycling FTP and body mass');
        expect(received).not.toHaveBeenCalled();
        fetch.mockImplementationOnce(async () => {
            localStorage.removeItem(KEY);
            return response({weight: 75, sportSettings: [{types: ['Ride'], ftp: 280}]});
        });
        await expect(intervals.syncProfile()).rejects.toThrow('connection changed');
        expect(received).not.toHaveBeenCalled();
    } finally { xf.unsub('intervals:profile', handler); }
});

test('history imports all sports into local coaching and resumes a failed date batch', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const oldest = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
    seed(oldest);
    const values = new Map();
    const service = new CoachingService({
        getItem: key => values.get(key),
        setItem: (key, value) => values.set(key, value),
    });
    fetch.mockResolvedValueOnce(response([{
        id: 'run-1', name: 'Run', start_date: `${oldest}T09:00:00Z`, type: 'Run', moving_time: 600,
    }])).mockResolvedValueOnce(response({}, 429));
    await expect(intervals.sync(service)).rejects.toThrow('rate limit');
    const cursor = stored().nextDate;
    expect(cursor).not.toBeNull();
    expect(service.data.activities[0].sport).toBe('running');
    expect(intervals.status().status).toBe('error');
    fetch.mockResolvedValueOnce(response([{
        id: 'ride-1', name: 'Ride', start_date: `${today}T09:00:00Z`, type: 'VirtualRide',
        moving_time: 600, icu_average_watts: 200, icu_ftp: 250, stream_types: ['watts'],
    }])).mockResolvedValueOnce(response([{type: 'watts', data: [100, 200, 300]}]));
    expect(await intervals.sync(service)).toEqual(expect.objectContaining({status: 'connected'}));
    expect(new URL(fetch.mock.calls[2][0]).searchParams.get('oldest')).toBe(cursor);
    expect(service.data.activities).toHaveLength(2);
    expect(service.data.activities[1].powerProfile).toEqual([100, 200, 300]);
    expect(stored().nextDate).toBeNull();
    expect(intervals.status().status).toBe('connected');
    expect(stored().lastSuccess).toBeTruthy();
});

test('route and measurement requests use the provider and reject invalid streams', async () => {
    seed();
    fetch.mockResolvedValueOnce(response([{type: 'watts', data: [100, 200]}]))
        .mockResolvedValueOnce(response({latlngs: [[50, 4], null]}));
    expect(await intervals.activityData('ride-1')).toEqual({
        streams: {watts: [100, 200]}, map: {latlngs: [[50, 4]]},
    });
    fetch.mockResolvedValueOnce(response([{type: 'watts', data: ['invalid']}]))
        .mockResolvedValueOnce(response(null));
    await expect(intervals.activityData('ride-1')).rejects.toThrow('invalid activity stream data');
});

test('invalid connections and offline responses do not erase a working local connection', async () => {
    seed();
    await expect(intervals.connect({apiKey: 'bad key', oldest: '2026-01-01'})).rejects.toThrow('personal API key');
    fetch.mockRejectedValue(new TypeError('Offline'));
    await expect(intervals.connect({apiKey: 'new-key', oldest: '2026-01-01'})).rejects.toThrow('could not be reached');
    expect(stored().apiKey).toBe('test-key');
});

test('a connection change in another tab cannot be undone by an in-flight sync', async () => {
    seed();
    const service = {data: {profile: null, activities: []}, importActivities: jest.fn(), advance: jest.fn()};
    let finish;
    fetch.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const pending = intervals.sync(service);
    localStorage.removeItem(KEY);
    finish(response([]));
    await expect(pending).rejects.toThrow('changed in another tab');
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(service.importActivities).not.toHaveBeenCalled();
});
