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

// Provider objects stop here. All consumers, including the coach, use normalizeActivity.
/**
 * Maps a raw Intervals.icu activity payload to Athlima's normalized activity format.
 *
 * The coach and history logic consume only the normalized model, so Intervals data
 * must be reduced to a stable internal shape before any planning logic runs.
 *
 * @param {object} activity - Raw activity payload returned from Intervals.icu.
 * @param {string} syncedAt - ISO timestamp when this import batch was processed.
 * @returns {{id: string, externalId: string, source: string, providerIds: object,
 *   name: string|null, start: string, duration: number, movingTime: number,
 *   distance: number|null, elevation: number|null, indoor: boolean,
 *   averagePower: number|null, normalizedPower: number|null, ftp: number|null,
 *   averageHeartRate: number|null, averageCadence: number|null, rawReference: string,
 *   syncedAt: string}|null} A normalized activity or null when the activity type is not a cycling ride.
 */
export function intervalsActivity(activity, syncedAt) {
    if(!['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide',
        'EMountainBikeRide'].includes(activity.type)) return null;
    if(!activity.id || !activity.start_date || !(activity.moving_time > 0)) {
        throw new IntegrationError('A cycling activity is missing its ID, UTC start or moving time. Retry after correcting it in Intervals.icu.');
    }
    const externalId = activity.external_id || '';
    const legacyId = /^(?:athlima|auuki):([\w-]{1,100})$/.exec(externalId);
    return {
        id: legacyId ? legacyId[1] : `intervals:${activity.id}`,
        externalId: String(activity.id), source: 'intervals', providerIds: {intervals: String(activity.id)},
        name: activity.name, start: activity.start_date, duration: activity.moving_time,
        movingTime: activity.moving_time, distance: activity.distance,
        elevation: activity.total_elevation_gain, indoor: activity.type === 'VirtualRide',
        averagePower: activity.icu_average_watts ?? activity.average_watts,
        normalizedPower: activity.icu_weighted_avg_watts, ftp: activity.icu_ftp,
        averageHeartRate: activity.average_heartrate, averageCadence: activity.average_cadence,
        rawReference: String(activity.id), syncedAt,
    };
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
    async function remote(apiKey, path, {query, body, method = 'GET', athleteId = '0'} = {}) {
        let response;
        try {
            response = await fetchImpl(`${athleteEndpoint(athleteId)}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {
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
            const received = await download(decrypt(current.credential, current.user_id), current.cursor, newest, athleteId);
            if(stopped || row(current.user_id)?.credential !== current.credential) return;
            const raw = received.map(a => intervalsActivity(a, new Date(clock()).toISOString())).filter(Boolean);
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
