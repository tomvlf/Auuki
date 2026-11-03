import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CoachingService } from '../src/coaching/service.js';
import { addDays, date } from '../src/coaching/domain.js';

const API = 'https://intervals.icu/api/v1/athlete/0';

class IntegrationError extends Error {
    constructor(message, status = 400, retryAfter = null) {
        super(message);
        this.status = status;
        this.retryAfter = retryAfter;
    }
}

// Provider objects stop here. All consumers, including the coach, use normalizeActivity.
export function intervalsActivity(activity, syncedAt) {
    if(!['Ride', 'VirtualRide', 'EBikeRide', 'MountainBikeRide', 'GravelRide',
        'EMountainBikeRide'].includes(activity.type)) return null;
    if(!activity.id || !activity.start_date || !(activity.moving_time > 0)) {
        throw new IntegrationError('A cycling activity is missing its ID, UTC start or moving time. Retry after correcting it in Intervals.icu.');
    }
    return {
        id: /^auuki:[\w-]{1,100}$/.test(activity.external_id || '') ? activity.external_id.slice(6) : `intervals:${activity.id}`,
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

export function createIntervals({db, document, save, clock, encryptionKey, fetchImpl = fetch, startWorker = true}) {
    const key = encryptionKey ? Buffer.from(encryptionKey, 'base64') : null;
    if(key && (key.length !== 32 || key.toString('base64') !== encryptionKey)) {
        throw new Error('AUUKI_INTEGRATION_KEY must be a base64-encoded 32-byte key.');
    }
    db.exec(`CREATE TABLE IF NOT EXISTS integrations (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        credential TEXT NOT NULL, oldest TEXT NOT NULL, cursor TEXT, newest TEXT,
        status TEXT NOT NULL, last_success TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
        retry_at INTEGER NOT NULL DEFAULT 0
    );
    UPDATE integrations SET status = 'queued' WHERE status = 'running';`);
    const row = id => db.prepare('SELECT * FROM integrations WHERE user_id = ?').get(id);
    const nowDay = () => new Date(clock()).toISOString().slice(0, 10);
    let active = false;
    let stopped = false;

    function encrypt(value, id) {
        const nonce = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', key, nonce);
        cipher.setAAD(Buffer.from(String(id)));
        const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString('base64');
    }
    function decrypt(value, id) {
        const bytes = Buffer.from(value, 'base64');
        const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
        cipher.setAAD(Buffer.from(String(id)));
        cipher.setAuthTag(bytes.subarray(12, 28));
        return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
    }
    function status(id) {
        const current = row(id);
        return {configured: Boolean(key), connected: Boolean(current),
            status: current?.status || 'disconnected', oldest: current?.oldest ?? null,
            nextDate: current?.cursor ?? null, through: current?.newest ?? null,
            lastSuccess: current?.last_success ?? null, error: current?.error ?? null,
            retryAt: current?.retry_at ? new Date(current.retry_at).toISOString() : null};
    }
    async function remote(apiKey, path, {query, body, method = 'GET'} = {}) {
        let response;
        try {
            response = await fetchImpl(`${API}${path}${query ? `?${new URLSearchParams(query)}` : ''}`, {
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
    async function download(apiKey, oldest, newest) {
        const activities = await remote(apiKey, '/activities', {query: {oldest, newest}});
        if(!Array.isArray(activities)) throw new IntegrationError('Intervals.icu returned an unexpected activity list.', 502);
        return activities;
    }
    function credential(id) {
        const current = row(id);
        if(!current || !key) throw new IntegrationError('Connect Intervals.icu in Settings > Integrations first.');
        return decrypt(current.credential, id);
    }
    async function athlete(id) {
        return remote(credential(id), '');
    }
    async function events(id, oldest, newest) {
        try { date(oldest); date(newest); } catch { throw new IntegrationError('Choose valid calendar dates.'); }
        if(oldest > newest || newest > addDays(oldest, 62)) throw new IntegrationError('Request at most 63 days of planned workouts.');
        const result = await remote(credential(id), '/events', {query: {oldest, newest, category: 'WORKOUT', ext: 'zwo', resolve: 'true'}});
        if(!Array.isArray(result)) throw new IntegrationError('Intervals.icu returned an unexpected event list.', 502);
        return result;
    }
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
        const form = new FormData();
        form.append('file', new Blob([bytes], {type: 'application/octet-stream'}), `${body.id}.fit`);
        await remote(credential(id), '/activities', {method: 'POST', body: form,
            query: {name: body.name, external_id: `auuki:${body.id}`}});
        return {success: true};
    }
    async function connect(id, body) {
        if(!key) throw new IntegrationError('The operator must configure AUUKI_INTEGRATION_KEY before connecting.', 503);
        if(typeof body.apiKey !== 'string' || !body.apiKey.trim() || body.apiKey.length > 1024) {
            throw new IntegrationError('Enter your Intervals.icu API key.');
        }
        let oldest;
        try { oldest = date(body.oldest); } catch { throw new IntegrationError('Choose a valid historical import start date.'); }
        if(oldest > nowDay() || oldest < addDays(nowDay(), -3660)) {
            throw new IntegrationError('Choose an import date within the last ten years.');
        }
        if(['running', 'queued'].includes(row(id)?.status)) throw new IntegrationError('Wait for the current import before reconnecting.', 409);
        await download(body.apiKey.trim(), nowDay(), nowDay());
        if(['running', 'queued'].includes(row(id)?.status)) throw new IntegrationError('An import started while testing. Wait before reconnecting.', 409);
        db.prepare(`INSERT INTO integrations (user_id, credential, oldest, status)
            VALUES (?, ?, ?, 'connected') ON CONFLICT(user_id) DO UPDATE SET
            credential=excluded.credential, oldest=excluded.oldest, cursor=NULL, newest=NULL,
            status='connected', error=NULL, attempts=0, retry_at=0, last_success=NULL`)
            .run(id, encrypt(body.apiKey.trim(), id), oldest);
        return status(id);
    }
    async function test(id) {
        const current = row(id);
        if(!current || !key) throw new IntegrationError('Connect Intervals.icu first.');
        await download(decrypt(current.credential, id), nowDay(), nowDay());
        return {success: true};
    }
    function disconnect(id) {
        db.prepare('DELETE FROM integrations WHERE user_id = ?').run(id);
        return status(id);
    }
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
    async function tick() {
        if(active || stopped || !key) return;
        const current = db.prepare(`SELECT * FROM integrations WHERE status='queued' AND retry_at <= ? ORDER BY retry_at, user_id LIMIT 1`).get(clock());
        if(!current) return;
        active = true;
        db.prepare("UPDATE integrations SET status='running' WHERE user_id=?").run(current.user_id);
        try {
            const newest = [addDays(current.cursor, 30), current.newest].sort()[0];
            const received = await download(decrypt(current.credential, current.user_id), current.cursor, newest);
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
            if(stopped || !row(current.user_id)) return;
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
        close() { stopped = true; clearInterval(timer); }};
}
