import { xf } from '../functions.js';
import { isoDate } from '../utils.js';
import { addDays, date } from '../coaching/domain.js';
import { normalizeActivity } from '../coaching/normalizer.js';
import { intervalsActivity, compactProfile } from './intervals-data.js';

const API = 'https://intervals.icu/api/v1';
const KEY = 'athlima-intervals-v1';
const validAthleteId = id => /^(?:i)?\d{1,20}$/.test(String(id));
let syncing = false;

function saved() {
    const value = window.localStorage.getItem(KEY);
    if(!value) return null;
    const result = JSON.parse(value);
    if(typeof result.apiKey !== 'string' || !result.apiKey || !validAthleteId(result.athleteId)) {
        throw new Error('Stored Intervals.icu connection is invalid. Disconnect and reconnect in Settings.');
    }
    date(result.oldest);
    return result;
}

function status() {
    const connection = saved();
    return {configured: true, connected: Boolean(connection),
        status: syncing ? 'running' : connection?.error ? 'error' : connection ? 'connected' : 'disconnected',
        athleteId: connection?.athleteId, oldest: connection?.oldest,
        lastSuccess: connection?.lastSuccess, nextDate: connection?.nextDate,
        through: connection?.through, error: connection?.error, skipped: connection?.skipped || []};
}

async function request(path, {query, body, method = 'GET', connection = saved()} = {}) {
    if(!connection) throw new Error('Connect Intervals.icu in Settings first.');
    let response;
    try {
        response = await fetch(`${API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {
            method, ...(body ? {body} : {}),
            headers: {Authorization: `Basic ${btoa(`API_KEY:${connection.apiKey}`)}`, Accept: 'application/json'},
            credentials: 'omit', cache: 'no-store', redirect: 'error',
            signal: AbortSignal.timeout(25000),
        });
    } catch {
        throw new Error('Intervals.icu could not be reached. Check your connection and browser access to Intervals.icu, then retry.');
    }
    if(!response.ok) {
        const error = new Error(response.status === 401 || response.status === 403
            ? 'Intervals.icu rejected the API key. Reconnect in Settings.'
            : response.status === 429 ? 'Intervals.icu rate limit reached. Wait before retrying.'
                : 'Intervals.icu could not complete the request. Please retry.');
        error.status = response.status;
        throw error;
    }
    try { return await response.json(); }
    catch { throw new Error('Intervals.icu returned an unreadable response. Please retry.'); }
}

const athletePath = (connection = saved()) => {
    if(!connection) throw new Error('Connect Intervals.icu in Settings first.');
    return `/athlete/${connection.athleteId}`;
};

async function connect({apiKey, oldest} = {}) {
    if(apiKey === undefined) {
        window.location.hash = '/settings';
        xf.dispatch('ui:page-set', 'settings');
        return;
    }
    if(syncing) throw new Error('Wait for the current import before reconnecting.');
    if(typeof apiKey !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(apiKey.trim())) {
        throw new Error('Enter your Intervals.icu personal API key.');
    }
    date(oldest);
    if(oldest > isoDate() || oldest < addDays(isoDate(), -3660)) {
        throw new Error('Choose an import date within the last ten years.');
    }
    const previous = window.localStorage.getItem(KEY);
    const connection = {apiKey: apiKey.trim(), athleteId: '0', oldest};
    const athlete = await request('/athlete/0', {connection});
    const id = athlete?.id ?? athlete?.athlete?.id ?? athlete?.user_id ?? athlete?.athleteId;
    if(!validAthleteId(id)) throw new Error('Intervals.icu returned an unexpected athlete profile.');
    if(window.localStorage.getItem(KEY) !== previous) throw new Error('The Intervals.icu connection changed in another tab. Retry.');
    connection.athleteId = String(id);
    window.localStorage.setItem(KEY, JSON.stringify(connection));
    xf.dispatch('services', {intervals: true});
    return status();
}

function disconnect() {
    if(syncing) throw new Error('Wait for the current import before disconnecting.');
    window.localStorage.removeItem(KEY);
    xf.dispatch('services', {intervals: false});
    return status();
}

async function athlete() {
    return request(athletePath());
}

async function wod(oldest = isoDate(), newest = isoDate()) {
    try {
        date(oldest);
        date(newest);
        if(oldest > newest || newest > addDays(oldest, 62)) throw new Error('Request at most 63 days of planned workouts.');
        const events = await request(`${athletePath()}/events`, {
            query: {oldest, newest, category: 'WORKOUT', ext: 'zwo', resolve: 'true'},
        });
        if(!Array.isArray(events)) throw new Error('Intervals.icu returned an unexpected event list.');
        xf.dispatch('action:planned', ':intervals:wod:success');
        return events.filter(event => event.workout_file_base64);
    } catch(error) {
        xf.dispatch('action:planned', ':intervals:wod:fail');
        xf.dispatch('ui:modal:error:open', error.message);
        throw error;
    }
}

async function uploadWorkout(record) {
    try {
        if(!record?.blob || !/^[\w-]{1,100}$/.test(record.id)) throw new Error('Choose a valid FIT recording.');
        const form = new FormData();
        form.append('file', record.blob, `${record.id}.fit`);
        await request(`${athletePath()}/activities`, {method: 'POST', body: form,
            query: {name: record.summary?.name || 'Athlima workout', external_id: `athlima:${record.id}`}});
        return ':success';
    } catch(error) {
        xf.dispatch('ui:modal:error:open', error.message);
        return ':fail';
    }
}

function athleteToSettings(athlete = {}, defaults = {weight: 0, ftp: 0}) {
    const settings = athlete.sportSettings || [];
    const selected = settings.find(setting => setting.types?.includes('VirtualRide')) ||
        settings.find(setting => setting.types?.includes('Ride'));
    return {weight: athlete.weight ?? athlete.icu_weight ?? defaults.weight,
        ftp: selected?.indoor_ftp ?? selected?.ftp ?? defaults.ftp};
}

async function getAthlete() {
    try {
        const result = athleteToSettings(await athlete());
        xf.dispatch('action:athlete', ':intervals:athlete:success');
        return result;
    } catch(error) {
        xf.dispatch('action:athlete', ':intervals:athlete:fail');
        xf.dispatch('ui:modal:error:open', error.message);
        throw error;
    }
}

async function syncProfile() {
    const connection = saved();
    if(!connection) throw new Error('Connect Intervals.icu in Settings first.');
    const profile = await getAthlete();
    if(!Number.isInteger(profile.ftp) || profile.ftp < 1 || profile.ftp > 1500 ||
        !Number.isFinite(profile.weight) || profile.weight < 1 || profile.weight > 500) {
        throw new Error('Set a valid cycling FTP and body mass in Intervals.icu, then retry profile sync.');
    }
    const current = saved();
    if(current?.apiKey !== connection.apiKey || current?.athleteId !== connection.athleteId) {
        throw new Error('The Intervals.icu connection changed while syncing your profile. Retry.');
    }
    xf.dispatch('intervals:profile', profile);
    return profile;
}

async function sync(service, onProgress = () => {}) {
    if(syncing) throw new Error('An Intervals.icu import is already running.');
    const connection = saved();
    if(!connection) throw new Error('Connect Intervals.icu first.');
    let persisted = window.localStorage.getItem(KEY);
    const checkConnection = () => {
        if(window.localStorage.getItem(KEY) !== persisted) {
            throw new Error('The Intervals.icu connection changed in another tab. Retry with the current settings.');
        }
    };
    const saveProgress = () => {
        checkConnection();
        const next = JSON.stringify(connection);
        window.localStorage.setItem(KEY, next);
        persisted = next;
    };
    const through = isoDate();
    let cursor = connection.nextDate || (connection.lastSuccess
        ? [connection.oldest, addDays(connection.lastSuccess.slice(0, 10), -7)].sort().at(-1) : connection.oldest);
    connection.error = null;
    if(!connection.nextDate) connection.skipped = [];
    syncing = true;
    try {
        while(cursor <= through) {
            const newest = [addDays(cursor, 30), through].sort()[0];
            const received = await request(`${athletePath(connection)}/activities`, {
                connection, query: {oldest: cursor, newest},
            });
            if(!Array.isArray(received)) throw new Error('Intervals.icu returned an unexpected activity list.');
            const raw = [];
            for(const item of received) {
                let activity;
                try {
                    activity = intervalsActivity(item, new Date().toISOString());
                    if(!activity) throw new Error('Missing activity ID, start time or duration.');
                    normalizeActivity(activity, service.data.profile || undefined);
                } catch(error) {
                    console.warn('Skipping invalid Intervals.icu activity:', error.message);
                    connection.skipped = [...(connection.skipped || []),
                        `${item?.start_date || 'undated'} ${item?.name || item?.id || 'activity'}`].slice(-50);
                    continue;
                }
                const previous = service.data.activities.find(entry => entry.id === activity.id);
                if(previous && previous.details?.analyzed === activity.details.analyzed &&
                    (previous.powerProfile || previous.heartRateProfile)) {
                    activity.powerProfile = previous.powerProfile ?? undefined;
                    activity.heartRateProfile = previous.heartRateProfile ?? undefined;
                    activity.maximumPower = previous.original?.maximumPower;
                } else if(Array.isArray(item.stream_types) && item.stream_types.some(type => ['watts', 'heartrate'].includes(type))) {
                    let streams;
                    try {
                        streams = await request(`/activity/${encodeURIComponent(String(item.id))}/streams.json`, {
                            connection, query: {types: 'watts,heartrate'},
                        });
                    } catch(error) {
                        if(![400, 404].includes(error.status)) throw error;
                        console.warn('Intervals.icu has no accessible streams for this activity:', item.id);
                        raw.push(activity);
                        continue;
                    }
                    if(!Array.isArray(streams)) throw new Error('Intervals.icu returned invalid activity streams.');
                    const watts = streams.find(stream => stream.type === 'watts')?.data;
                    activity.powerProfile = compactProfile(watts) ?? undefined;
                    activity.heartRateProfile = compactProfile(streams.find(stream => stream.type === 'heartrate')?.data) ?? undefined;
                    if(Array.isArray(watts)) activity.maximumPower = watts.reduce((max, value) =>
                        Number.isFinite(value) && value <= 3000 ? Math.max(max, value) : max, 0) || undefined;
                }
                raw.push(activity);
            }
            checkConnection();
            await service.importActivities(raw);
            cursor = addDays(newest, 1);
            connection.nextDate = cursor <= through ? cursor : null;
            connection.through = through;
            saveProgress();
            onProgress(status());
        }
        await service.advance();
        connection.lastSuccess = new Date().toISOString();
        connection.nextDate = null;
        saveProgress();
    } catch(error) {
        connection.error = error.message;
        if(window.localStorage.getItem(KEY) === persisted) saveProgress();
        throw error;
    } finally { syncing = false; }
    return status();
}

async function activityData(activityId) {
    if(typeof activityId !== 'string' || !/^[\w-]{1,100}$/.test(activityId)) throw new Error('Invalid Intervals.icu activity ID.');
    const optional = async path => {
        try { return await request(path); }
        catch(error) {
            if([400, 404].includes(error.status)) return null;
            throw error;
        }
    };
    const [received, map] = await Promise.all([
        request(`/activity/${encodeURIComponent(activityId)}/streams.json`, {query: {types: 'watts,heartrate,cadence,time'}})
            .catch(error => {
                if([400, 404].includes(error.status)) return [];
                throw error;
            }),
        optional(`/activity/${encodeURIComponent(activityId)}/map`),
    ]);
    if(!Array.isArray(received)) throw new Error('Intervals.icu returned invalid activity streams.');
    const streams = {};
    for(const type of ['watts', 'heartrate', 'cadence', 'time']) {
        const values = received.find(stream => stream.type === type)?.data;
        if(values == null) continue;
        if(!Array.isArray(values) || values.length > 200000 || values.some(value => value != null && !Number.isFinite(value))) {
            throw new Error('Intervals.icu returned invalid activity stream data.');
        }
        streams[type] = values;
    }
    if(!map) return {streams, map: null};
    const points = map.latlngs;
    if(!Array.isArray(points) || points.length > 200000 || points.some(point => point !== null &&
        (!Array.isArray(point) || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]) ||
            Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180))) {
        return {streams, map: null, routeError: 'The route contains invalid locations. Activity measurements are still available.'};
    }
    return {streams, map: {latlngs: points.filter(point => point !== null)}};
}

export default Object.freeze({connect, disconnect, status, sync, athlete, activityData,
    wod, uploadWorkout, getAthlete, syncProfile, athleteToSettings, update() {}});
