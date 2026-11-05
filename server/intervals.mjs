/*
 * intervals.mjs: backend service module.
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

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CoachingService } from '../src/coaching/service.js';
import { addDays, date } from '../src/coaching/domain.js';
import { sportForType } from '../src/coaching/activity-types.js';

// The Intervals.icu integration is a small server-side service. It is intentionally
// separated from the browser code so a user can connect with a personal API key
// without exposing that key in the frontend or in public deployment files.
//
// High level flow:
//   1. Save the encrypted API key for the signed-in account.
//   2. Resolve the user's athlete ID from Intervals.icu.
//   3. Fetch historical activities in bounded date windows.
//   4. Normalize provider responses into Athlima's internal activity model.
//   5. Upload FIT recordings and planned workouts using the stored athlete ID.
//   6. Keep sync state and retry metadata so resumable imports continue after restart.
//
// Function reference:
// - intervalsActivity(): converts raw provider data into Athlima's common activity format.
// - createIntervals(): creates the account-scoped Intervals service and its worker.
// - encrypt()/decrypt(): secure API-key storage and retrieval using AES-256-GCM.
// - status()/athlete()/events()/upload(): API surface used by the browser/server routes.
// - connect()/sync()/tick(): connection and import lifecycle management.

const API = 'https://intervals.icu/api/v1';

class IntegrationError extends Error {
    constructor(message, status = 400, retryAfter = null) {
        super(message);
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

// Intervals.icu summary fields kept as display details. Internal flags, sync bookkeeping and
// large binary/chart payloads are intentionally omitted to keep the coaching document small.
const detailFields = {
    type: 'type', subType: 'sub_type', description: 'description', startLocal: 'start_date_local',
    timeZone: 'timezone', provider: 'source', deviceName: 'device_name', powerMeter: 'power_meter',
    gear: 'gear', tags: 'tags', commute: 'commute', race: 'race', trainer: 'trainer', analyzed: 'analyzed',
    elapsedTime: 'elapsed_time', movingTime: 'moving_time', recordingTime: 'icu_recording_time',
    coastingTime: 'coasting_time', warmupTime: 'icu_warmup_time', cooldownTime: 'icu_cooldown_time',
    distance: 'distance', averageSpeed: 'average_speed', maxSpeed: 'max_speed', pace: 'pace', gap: 'gap',
    elevationGain: 'total_elevation_gain', elevationLoss: 'total_elevation_loss',
    averageAltitude: 'average_altitude', minAltitude: 'min_altitude', maxAltitude: 'max_altitude',
    averagePower: 'icu_average_watts', normalizedPower: 'icu_weighted_avg_watts', ftp: 'icu_ftp',
    intensity: 'icu_intensity', variabilityIndex: 'icu_variability_index',
    efficiencyFactor: 'icu_efficiency_factor', powerHr: 'icu_power_hr', decoupling: 'decoupling',
    work: 'icu_joules', workAboveFtp: 'icu_joules_above_ftp', wPrime: 'icu_w_prime',
    maxWbalDepletion: 'icu_max_wbal_depletion', lrBalance: 'avg_lr_balance', crankLength: 'crank_length',
    rollingFtp: 'icu_rolling_ftp', estimatedCp: 'icu_pm_cp', estimatedFtp: 'icu_pm_ftp',
    averageHeartRate: 'average_heartrate', maxHeartRate: 'max_heartrate', lthr: 'lthr',
    restingHeartRate: 'icu_resting_hr', athleteMaxHeartRate: 'athlete_max_hr', hrRecovery: 'icu_hrr',
    averageCadence: 'average_cadence', averageStride: 'average_stride',
    trainingLoad: 'icu_training_load', powerLoad: 'power_load', hrLoad: 'hr_load', paceLoad: 'pace_load',
    hrLoadType: 'hr_load_type', trimp: 'trimp', strainScore: 'strain_score',
    fitness: 'icu_ctl', fatigue: 'icu_atl', polarizationIndex: 'polarization_index',
    rpe: 'icu_rpe', perceivedExertion: 'perceived_exertion', sessionRpe: 'session_rpe', feel: 'feel',
    powerZoneTimes: 'icu_zone_times', heartRateZoneTimes: 'icu_hr_zone_times', paceZoneTimes: 'pace_zone_times',
    powerZones: 'icu_power_zones', heartRateZones: 'icu_hr_zones',
    calories: 'calories', carbsUsed: 'carbs_used', carbsIngested: 'carbs_ingested', weight: 'icu_weight',
    averageTemp: 'average_temp', minTemp: 'min_temp', maxTemp: 'max_temp',
    weatherTemp: 'average_weather_temp', feelsLike: 'average_feels_like', windSpeed: 'average_wind_speed',
    windGust: 'average_wind_gust', windDirection: 'prevailing_wind_deg', headwindPercent: 'headwind_percent',
    tailwindPercent: 'tailwind_percent', clouds: 'average_clouds', rain: 'max_rain', snow: 'max_snow',
    lapCount: 'icu_lap_count', intervalSummary: 'interval_summary', streamTypes: 'stream_types',
    lengths: 'lengths', poolLength: 'pool_length', kgLifted: 'kg_lifted', compliance: 'compliance',
    pairedEventId: 'paired_event_id', stravaId: 'strava_id',
};

function detailValue(value) {
    if(typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if(typeof value === 'boolean') return value;
    if(typeof value === 'string') return value ? value.slice(0, 2000) : undefined;
    if(Array.isArray(value)) {
        const items = value.slice(0, 60).map(item => item && typeof item === 'object'
            ? Object.fromEntries(Object.entries(item).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))
                .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]))
            : detailValue(item)).filter(item => item !== undefined);
        return items.length ? items : undefined;
    }
    if(value && typeof value === 'object') {
        const entries = Object.entries(value).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))
            .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return undefined;
}

function validTimeZone(zone) {
    if(typeof zone !== 'string' || !zone) return null;
    try { new Intl.DateTimeFormat('en', {timeZone: zone}); return zone; } catch { return null; }
}

const finite = (value, min = 0, max = Infinity) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

// Provider objects stop here. All consumers, including the coach, use normalizeActivity.
/**
 * Maps a raw Intervals.icu activity payload to Athlima's normalized activity format.
 *
 * Every activity type is imported. The sport category drives coaching (cycling only),
 * while the original type and the detail summary are kept for display.
 *
 * @param {object} activity - Raw activity payload returned from Intervals.icu.
 * @param {string} syncedAt - ISO timestamp when this import batch was processed.
 * @returns {object|null} Raw activity input for normalizeActivity, or null when a
 *   non-cycling activity has no duration and therefore cannot be represented.
 */
export function intervalsActivity(activity, syncedAt) {
    const type = typeof activity.type === 'string' && activity.type ? activity.type : 'Other';
    const sport = sportForType(type);
    const duration = finite(activity.moving_time, 1) ?? finite(activity.elapsed_time, 1);
    if(!activity.id || !activity.start_date || !duration) {
        if(sport !== 'cycling' && activity.id && activity.start_date) return null;
        throw new IntegrationError('A cycling activity is missing its ID, UTC start or moving time. Retry after correcting it in Intervals.icu.');
    }
    const externalId = activity.external_id || '';
    const legacyId = /^(?:athlima|auuki):([\w-]{1,100})$/.exec(externalId);
    const details = {};
    for(const [key, field] of Object.entries(detailFields)) {
        const value = detailValue(field === 'gear' ? activity.gear?.name : activity[field]);
        if(value !== undefined) details[key] = value;
    }
    const joules = finite(activity.icu_joules);
    return {
        id: legacyId ? legacyId[1] : `intervals:${activity.id}`,
        externalId: String(activity.id), source: 'intervals', providerIds: {intervals: String(activity.id)},
        name: activity.name, start: activity.start_date, duration,
        movingTime: finite(activity.moving_time), elapsedTime: finite(activity.elapsed_time),
        distance: finite(activity.distance) ?? finite(activity.icu_distance),
        elevation: finite(activity.total_elevation_gain),
        sport, activityType: type, timeZone: validTimeZone(activity.timezone) ?? undefined,
        indoor: activity.trainer === true || /^Virtual/.test(type),
        averagePower: activity.icu_average_watts ?? activity.average_watts,
        normalizedPower: activity.icu_weighted_avg_watts, ftp: activity.icu_ftp,
        averageHeartRate: activity.average_heartrate, maximumHeartRate: activity.max_heartrate,
        averageCadence: activity.average_cadence,
        workKj: joules == null ? null : joules / 1000,
        rpe: finite(activity.icu_rpe, 0, 10) ?? finite(activity.perceived_exertion, 0, 10),
        hasIntervals: Array.isArray(activity.interval_summary) && activity.interval_summary.length > 0,
        details, rawReference: String(activity.id), syncedAt,
    };
}

/**
 * Reduces one-second stream samples to a short averaged profile for list previews.
 *
 * @param {Array<number|null>} values - Stream samples from Intervals.icu.
 * @param {number} [buckets=120] - Maximum number of profile points.
 * @returns {number[]|null} Rounded averages, or null without enough valid samples.
 */
export function compactProfile(values, buckets = 120) {
    if(!Array.isArray(values)) return null;
    const count = Math.min(buckets, values.length);
    const profile = [];
    for(let index = 0; index < count; index++) {
        const slice = values.slice(Math.floor(index * values.length / count),
            Math.max(Math.floor(index * values.length / count) + 1, Math.floor((index + 1) * values.length / count)))
            .filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
        if(slice.length) profile.push(Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length));
    }
    return profile.length >= 2 ? profile : null;
}

/**
 * Creates the Intervals.icu account service bound to one SQLite database.
 *
 * Each signed-in account gets a separate row in the integrations table. The service
 * stores encrypted credentials, the athlete-specific ID, and the import cursor.
 *
 * @param {object} options - Configuration for the provider service.
 * @param {import('node:sqlite').DatabaseSync} options.db - SQLite database handle.
 * @param {Function} options.document - Returns a persisted document by user and kind.
 * @param {Function} options.save - Persists a user document and revision.
 * @param {Function} options.clock - Returns the current time in milliseconds.
 * @param {string} [options.encryptionKey] - Base64-encoded 32-byte AES key used for API-key encryption.
 * @param {Function} [options.fetchImpl=fetch] - HTTP fetch implementation used for provider calls.
 * @param {boolean} [options.startWorker=true] - Enables the background sync worker timer.
 * @returns {{status: Function, connect: Function, test: Function, disconnect: Function,
 *   sync: Function, tick: Function, athlete: Function, events: Function, upload: Function,
 *   close: Function}} The Intervals integration API used by the server routes.
 */
export function createIntervals({db, document, save, clock, encryptionKey, fetchImpl = fetch, startWorker = true}) {
    const key = encryptionKey ? Buffer.from(encryptionKey, 'base64') : null;
    if(key && (key.length !== 32 || key.toString('base64') !== encryptionKey)) {
        throw new Error('ATHLIMA_INTEGRATION_KEY must be a base64-encoded 32-byte key.');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS integrations (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        athlete_id TEXT NOT NULL DEFAULT '0', credential TEXT NOT NULL, oldest TEXT NOT NULL,
        cursor TEXT, newest TEXT, status TEXT NOT NULL, last_success TEXT, error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0
    );
    UPDATE integrations SET status = 'queued' WHERE status = 'running';`);
    const columns = db.prepare('PRAGMA table_info(integrations)').all();
    if(!columns.some(column => column.name === 'athlete_id')) {
        db.exec('ALTER TABLE integrations ADD COLUMN athlete_id TEXT NOT NULL DEFAULT "0"');
    }
    db.exec("UPDATE integrations SET athlete_id = '0' WHERE athlete_id IS NULL OR athlete_id = ''");
    const row = id => db.prepare('SELECT * FROM integrations WHERE user_id = ?').get(id);
    const nowDay = () => new Date(clock()).toISOString().slice(0, 10);
    let active = false;
    let stopped = false;
    const connecting = new Map();

    /**
     * Encrypts a plaintext API key with a server-managed AES-256-GCM key.
     *
     * The user ID is used as associated data so every account's stored key is bound
     * to that rider's integration record rather than a global bucket.
     *
     * @param {string} value - Plaintext Intervals.icu API key.
     * @param {number|string} id - Account ID used as the encryption AAD value.
     * @returns {string} Base64-encoded ciphertext plus authentication tag and nonce.
     */
    function encrypt(value, id) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(String(id)));
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
    }
    /**
     * Decrypts a stored Intervals.icu API key for the given account.
     *
     * @param {string} value - Base64-encoded encrypted credential.
     * @param {number|string} id - Account ID that originally encrypted the value.
     * @returns {string} Decrypted API key.
     */
    function decrypt(value, id) {
        try {
            const bytes = Buffer.from(value, 'base64');
            const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            cipher.setAAD(Buffer.from(String(id)));
            cipher.setAuthTag(bytes.subarray(12, 28));
            return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
        } catch {
            throw new IntegrationError('Stored Intervals.icu credentials cannot be decrypted. Restore the server encryption key or reconnect in Settings.', 503);
        }
    }
    /**
     * Returns the current connection state for a user account.
     *
     * @param {number|string} id - User account identifier.
     * @returns {{configured: boolean, connected: boolean, status: string, athleteId: string|null,
     *   oldest: string|null, nextDate: string|null, through: string|null, lastSuccess: string|null,
     *   error: string|null, retryAt: string|null}} The persisted integration state.
     */
    function status(id) {
        const current = row(id);
        return {configured: Boolean(key), connected: Boolean(current),
            status: current?.status || 'disconnected', athleteId: current?.athlete_id ?? null,
            oldest: current?.oldest ?? null, nextDate: current?.cursor ?? null,
            through: current?.newest ?? null, lastSuccess: current?.last_success ?? null,
            error: current?.error ?? null, retryAt: current?.retry_at ? new Date(current.retry_at).toISOString() : null};
    }
    /**
     * Builds the athlete-specific Intervals API endpoint used for all provider calls.
     *
     * @param {string} [athleteId='0'] - Athlete number to call; defaults to the root account endpoint.
     * @returns {string} URL for the athlete resource.
     */
    function athleteEndpoint(athleteId = '0') {
        return `${API}/athlete/${encodeURIComponent(String(athleteId))}`;
    }
    /**
     * Executes a provider request against Intervals.icu with the rider's API key.
     *
     * @param {string} apiKey - Intervals.icu API key for the current user.
     * @param {string} path - API path relative to the athlete endpoint.
     * @param {{query?: Record<string,string|number|boolean>, body?: BodyInit, method?: string,
     *   athleteId?: string}} [options] - Request customisation.
     * @returns {Promise<any>} Parsed JSON response body.
     */
    async function remote(apiKey, path, {query, body, method = 'GET', athleteId = '0', base} = {}) {
        let response;
        try {
            response = await fetchImpl(`${base ?? athleteEndpoint(athleteId)}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {
                method, ...(body ? {body} : {}),
                headers: {Authorization: `Basic ${Buffer.from(`API_KEY:${apiKey}`).toString('base64')}`,
                    Accept: 'application/json'}, signal: AbortSignal.timeout(25000), redirect: 'error',
            });
        } catch {
            throw new IntegrationError('Intervals.icu could not be reached. Check the connection and retry.', 502);
        }
        if(!response.ok) {
            const seconds = Number(response.headers.get('retry-after'));
            const retry = response.headers.get('retry-after');
            const retryAt = retry && Number.isFinite(seconds) ? clock() + Math.max(0, seconds) * 1000
                : retry && Number.isFinite(Date.parse(retry)) ? Date.parse(retry) : null;
            throw new IntegrationError(response.status === 401 || response.status === 403
                ? 'Intervals.icu rejected the API key. Reconnect with a valid key.'
                : response.status === 429 ? 'Intervals.icu rate limited this import; it will retry later.'
                    : `Intervals.icu returned HTTP ${response.status}. Retry the synchronization.`,
            response.status === 429 ? 429 : response.status >= 500 ? 502 : 400, retryAt);
        }
        let result;
        try { result = await response.json(); }
        catch { throw new IntegrationError('Intervals.icu returned an invalid response.', 502); }
        return result;
    }
    /**
     * Downloads a bounded activity range for a rider and athlete combination.
     *
     * @param {string} apiKey - API key for the rider.
     * @param {string} oldest - Start date in ISO YYYY-MM-DD format.
     * @param {string} newest - End date in ISO YYYY-MM-DD format.
     * @param {string} [athleteId='0'] - Athlete number used for the API call.
     * @returns {Promise<Array<object>>} Raw activities from Intervals.icu.
     */
    async function download(apiKey, oldest, newest, athleteId = '0') {
        const activities = await remote(apiKey, '/activities', {query: {oldest, newest}, athleteId});
        if(!Array.isArray(activities)) throw new IntegrationError('Intervals.icu returned an unexpected activity list.', 502);
        return activities;
    }
    /**
     * Adds compact power and heart-rate profiles plus stream-derived maximum power.
     *
     * Only activities that advertise watts or heart-rate streams are requested. Profiles are
     * reused while Intervals.icu has not re-analysed the activity, which keeps repeat syncs cheap.
     * A missing stream never fails the import; rate limiting does, so the batch is retried later.
     *
     * @param {string} apiKey - API key for the rider.
     * @param {Array<{item: object, raw: object}>} pairs - Provider payloads with their mapped activity.
     * @param {Map<string, object>} known - Previously stored activities by ID.
     * @returns {Promise<void>} Resolves when every profile has been attached.
     */
    async function attachStreams(apiKey, pairs, known) {
        const wanted = pairs.filter(({item}) => Array.isArray(item.stream_types) &&
            item.stream_types.some(type => type === 'watts' || type === 'heartrate'));
        const queue = [];
        for(const {item, raw} of wanted) {
            const previous = known.get(raw.id);
            if(previous && previous.details?.analyzed === raw.details.analyzed &&
               (previous.powerProfile || previous.heartRateProfile)) {
                raw.powerProfile = previous.powerProfile ?? undefined;
                raw.heartRateProfile = previous.heartRateProfile ?? undefined;
                if(previous.original?.maximumPower != null) raw.maximumPower = previous.original.maximumPower;
            } else queue.push({item, raw});
        }
        const worker = async () => {
            for(let next = queue.shift(); next; next = queue.shift()) {
                let streams;
                try {
                    streams = await remote(apiKey, `/activity/${encodeURIComponent(String(next.item.id))}/streams.json`,
                        {base: API, query: {types: 'watts,heartrate'}});
                } catch(error) {
                    if(error.status === 429) throw error;
                    continue;
                }
                if(!Array.isArray(streams)) continue;
                const data = type => streams.find(stream => stream?.type === type)?.data;
                const watts = data('watts');
                const power = compactProfile(watts);
                const heartRate = compactProfile(data('heartrate'));
                if(power) {
                    next.raw.powerProfile = power;
                    const peak = watts.reduce((max, value) =>
                        Number.isFinite(value) && value <= 3000 ? Math.max(max, value) : max, 0);
                    if(peak > 0) next.raw.maximumPower = peak;
                }
                if(heartRate) next.raw.heartRateProfile = heartRate;
            }
        };
        await Promise.all(Array.from({length: Math.min(3, queue.length)}, worker));
    }
    /**
     * Returns the decrypted API key for a connected user account.
     *
     * @param {number|string} id - User account identifier.
     * @returns {string} Decrypted credential stored in the SQLite integration row.
     */
    function credential(id) {
        const current = row(id);
        if(!current || !key) throw new IntegrationError('Connect Intervals.icu in Settings > Integrations first.');
        return decrypt(current.credential, id);
    }
    /**
     * Reads the configured athlete profile from Intervals.icu.
     *
     * @param {number|string} id - User account identifier.
     * @returns {Promise<object>} Raw athlete profile from the provider.
     */
    async function athlete(id) {
        const current = row(id);
        if(!current || !key) throw new IntegrationError('Connect Intervals.icu in Settings > Integrations first.');
        return remote(credential(id), '', {athleteId: current.athlete_id || '0'});
    }
    /**
     * Fetches planned workouts in a bounded date window for the rider's athlete.
     *
     * @param {number|string} id - User account identifier.
     * @param {string} oldest - Start date of the workout window.
     * @param {string} newest - End date of the workout window.
     * @returns {Promise<Array<object>>} Raw Intervals.icu workout events.
     */
    async function events(id, oldest, newest) {
        try { date(oldest); date(newest); } catch { throw new IntegrationError('Choose valid calendar dates.'); }
        if(oldest > newest || newest > addDays(oldest, 62)) throw new IntegrationError('Request at most 63 days of planned workouts.');
        const current = row(id);
        const athleteId = current?.athlete_id || '0';
        const result = await remote(credential(id), '/events', {query: {oldest, newest, category: 'WORKOUT', ext: 'zwo', resolve: 'true'}, athleteId});
        if(!Array.isArray(result)) throw new IntegrationError('Intervals.icu returned an unexpected event list.', 502);
        return result;
    }
    /**
     * Uploads a FIT file to the rider's athlete account.
     *
     * @param {number|string} id - User account identifier.
     * @param {{file: string, id: string, name: string}} body - FIT payload and metadata.
     * @returns {Promise<{success: boolean}>} Empty success payload on upload.
     */
    async function upload(id, body) {
        if(typeof body.file !== 'string' || body.file.length > 24 * 1024 * 1024 ||
           !/^[A-Za-z0-9+/]+={0,2}$/.test(body.file) || typeof body.id !== 'string' ||
           !/^[\w-]{1,100}$/.test(body.id) || typeof body.name !== 'string' || body.name.length > 500) {
            throw new IntegrationError('Upload a valid FIT recording smaller than 18 MiB.');
        }
        const bytes = Buffer.from(body.file, 'base64');
        if(bytes.toString('base64') !== body.file || bytes.length < 14 || bytes.subarray(8, 12).toString() !== '.FIT') {
            throw new IntegrationError('Upload a valid FIT recording.');
        }
        const current = row(id);
        const athleteId = current?.athlete_id || '0';
        const form = new FormData();
        form.append('file', new Blob([bytes], {type: 'application/octet-stream'}), `${body.id}.fit`);
        await remote(credential(id), '/activities', {method: 'POST', body: form,
            query: {name: body.name, external_id: `athlima:${body.id}`}, athleteId});
        return {success: true};
    }
    /**
     * Connects a rider to Intervals.icu and stores their encrypted API key and athlete ID.
     *
     * The request must validate the API key, resolve the athlete profile, and persist a
     * matching athlete number so future imports stay tied to the correct account.
     *
     * @param {number|string} id - User account identifier.
     * @param {{apiKey: string, oldest: string}} body - Connection payload including API key and history start date.
     * @returns {Promise<object>} The persisted connection state.
     */
    async function connect(id, body) {
        if(!key) throw new IntegrationError('The operator must configure ATHLIMA_INTEGRATION_KEY before connecting.', 503);
        if(typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 1024) {
            throw new IntegrationError('Enter your Intervals.icu API key.');
        }
        let oldest;
        try { oldest = date(body.oldest); } catch { throw new IntegrationError('Choose a valid historical import start date.'); }
        if(oldest > nowDay() || oldest < addDays(nowDay(), -3660)) {
            throw new IntegrationError('Choose an import date within the last ten years.');
        }
        if(['running', 'queued'].includes(row(id)?.status)) throw new IntegrationError('Wait for the current import before reconnecting.', 409);
        const operation = Symbol();
        connecting.set(id, operation);
        try {
            const athleteProfile = await remote(body.apiKey.trim(), '', {athleteId: '0'});
            if(stopped || connecting.get(id) !== operation) {
                throw new IntegrationError('Connection changed while testing. Retry with your current settings.', 409);
            }
            const athleteId = Array.isArray(athleteProfile) ? '0' :
                athleteProfile && typeof athleteProfile === 'object'
                    ? (athleteProfile.id ?? athleteProfile.athlete?.id ?? athleteProfile.user_id ?? athleteProfile.athleteId ?? '0')
                    : '0';
            const resolvedAthleteId = /^\d+$/.test(String(athleteId)) ? String(athleteId) : '0';
            if(athleteProfile && !Array.isArray(athleteProfile) && typeof athleteProfile === 'object' &&
               athleteProfile.id === undefined && athleteProfile.athlete?.id === undefined &&
               athleteProfile.user_id === undefined && athleteProfile.athleteId === undefined) {
                throw new IntegrationError('Intervals.icu returned an unexpected athlete profile.', 502);
            }
            if(['running', 'queued'].includes(row(id)?.status)) throw new IntegrationError('An import started while testing. Wait before reconnecting.', 409);
            db.prepare(`INSERT INTO integrations (user_id, athlete_id, credential, oldest, status)
            VALUES (?, ?, ?, ?, 'connected') ON CONFLICT(user_id) DO UPDATE SET
            athlete_id=excluded.athlete_id, credential=excluded.credential, oldest=excluded.oldest,
            cursor=NULL, newest=NULL, status='connected', error=NULL, attempts=0, retry_at=0, last_success=NULL`)
                .run(id, resolvedAthleteId, encrypt(body.apiKey.trim(), id), oldest);
            return status(id);
        } finally {
            if(connecting.get(id) === operation) connecting.delete(id);
        }
    }
    /**
     * Validates an existing connection by downloading the current day's activities.
     *
     * @param {number|string} id - User account identifier.
     * @returns {Promise<{success: boolean}>} Success signal when the saved credential still works.
     */
    async function test(id) {
        const current = row(id);
        if(!current || !key) throw new IntegrationError('Connect Intervals.icu first.');
        await download(decrypt(current.credential, id), nowDay(), nowDay(), current.athlete_id || '0');
        return {success: true};
    }
    /**
     * Removes the saved Intervals connection for a user account.
     *
     * @param {number|string} id - User account identifier.
     * @returns {{configured: boolean, connected: boolean, status: string, athleteId: string|null,
     *   oldest: string|null, nextDate: string|null, through: string|null, lastSuccess: string|null,
     *   error: string|null, retryAt: string|null}} Reset state after disconnect.
     */
    function disconnect(id) {
        connecting.delete(id);
        db.prepare('DELETE FROM integrations WHERE user_id = ?').run(id);
        return status(id);
    }
    /**
     * Schedules a new import batch for the user's configured athlete.
     *
     * @param {number|string} id - User account identifier.
     * @returns {{configured: boolean, connected: boolean, status: string, athleteId: string|null,
     *   oldest: string|null, nextDate: string|null, through: string|null, lastSuccess: string|null,
     *   error: string|null, retryAt: string|null}} The queued status after scheduling.
     */
    function sync(id) {
        const current = row(id);
        if(!current || !key) throw new IntegrationError('Connect Intervals.icu first.');
        if(['running', 'queued'].includes(current.status)) return status(id);
        const cursor = current.cursor || (current.last_success
            ? [current.oldest, addDays(current.last_success.slice(0, 10), -7)].sort().at(-1) : current.oldest);
        db.prepare(`UPDATE integrations SET status='queued', cursor=?, newest=?, error=NULL,
            attempts=0, retry_at=0 WHERE user_id=?`).run(cursor, nowDay(), id);
        return status(id);
    }
    /**
     * Runs one queued import cycle and persists progress back to the account row.
     *
     * The worker is intentionally serialized so stale batches cannot overwrite newer
     * connection state after a user reconnects or disconnects.
     *
     * @returns {Promise<void>} Resolves when the current queue item is processed or explicitly skipped.
     */
    async function tick() {
        if(active || stopped || !key) return;
        const current = db.prepare(`SELECT * FROM integrations WHERE status='queued' AND retry_at <= ? ORDER BY retry_at, user_id LIMIT 1`).get(clock());
        if(!current) return;
        active = true;
        db.prepare("UPDATE integrations SET status='running' WHERE user_id=?").run(current.user_id);
        try {
            if(stopped || row(current.user_id)?.credential !== current.credential) return;
            const athleteId = current.athlete_id || '0';
            const newest = [addDays(current.cursor, 30), current.newest].sort()[0];
            const apiKey = decrypt(current.credential, current.user_id);
            const received = await download(apiKey, current.cursor, newest, athleteId);
            if(stopped || row(current.user_id)?.credential !== current.credential) return;
            const syncedAt = new Date(clock()).toISOString();
            const pairs = received.map(item => ({item, raw: intervalsActivity(item, syncedAt)})).filter(pair => pair.raw);
            const known = new Map((document(current.user_id, 'coaching').data?.activities || [])
                .map(activity => [activity.id, activity]));
            await attachStreams(apiKey, pairs, known);
            if(stopped || row(current.user_id)?.credential !== current.credential) return;
            const raw = pairs.map(pair => pair.raw);
            const stored = document(current.user_id, 'coaching');
            let staged;
            const service = new CoachingService({
                getItem: () => stored.data ? JSON.stringify(stored.data) : null,
                setItem: (key, value) => { staged = JSON.parse(value); },
            }, () => new Date(clock()).toISOString());
            await service.importActivities(raw);
            if(stopped || row(current.user_id)?.credential !== current.credential) return;
            db.exec('BEGIN IMMEDIATE');
            try {
                save(current.user_id, 'coaching', staged, stored.revision);
                const done = newest >= current.newest;
                db.prepare(`UPDATE integrations SET cursor=?, status=?, last_success=?,
                    error=NULL, attempts=0, retry_at=? WHERE user_id=?`).run(
                    done ? null : addDays(newest, 1), done ? 'connected' : 'queued',
                    done ? new Date(clock()).toISOString() : current.last_success,
                    clock() + 1000, current.user_id);
                db.exec('COMMIT');
            } catch(error) { db.exec('ROLLBACK'); throw error; }
        } catch(error) {
            if(stopped || row(current.user_id)?.credential !== current.credential) return;
            const attempts = current.attempts + 1;
            const retry = attempts < 5 && [429, 502, 409].includes(error.status);
            const retryAt = Math.max(clock() + Math.min(3600000, 5000 * 2 ** attempts), error.retryAfter || 0);
            db.prepare(`UPDATE integrations SET status=?, error=?, attempts=?, retry_at=? WHERE user_id=?`)
                .run(retry ? 'queued' : 'error', error.status ? error.message :
                    'Activity import failed validation. Check activity dates and durations, then retry.',
                attempts, retryAt, current.user_id);
        } finally { active = false; }
    }
    const timer = startWorker ? setInterval(() => { void tick(); }, 1000) : null;
    timer?.unref();
    return {status, connect, test, disconnect, sync, tick, athlete, events, upload,
        close() { stopped = true; connecting.clear(); clearInterval(timer); }};
}
