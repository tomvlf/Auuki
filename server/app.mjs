import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as deriveKey, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { CoachingService } from '../src/coaching/service.js';

const scrypt = promisify(deriveKey);
const digest = value => createHash('sha256').update(value).digest('hex');
const MAX_BODY = 32 * 1024 * 1024;
const SESSION_MS = 7 * 86400000;
const methods = new Set(['configure', 'generate', 'archive', 'importActivities',
    'recordRide', 'resolve', 'updateFeedback', 'advance']);

class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

async function readJSON(request) {
    if(request.headers['content-type'] !== 'application/json' ||
       request.headers['x-auuki-client'] !== '1') {
        throw new HttpError(415, 'Use the Auuki JSON client.');
    }
    if(Number(request.headers['content-length']) > MAX_BODY) throw new HttpError(413, 'Request exceeds 32 MiB.');
    let size = 0;
    const chunks = [];
    for await(const chunk of request.iterator({destroyOnReturn: false})) {
        size += chunk.length;
        if(size > MAX_BODY) throw new HttpError(413, 'Request exceeds 32 MiB.');
        chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString()); }
    catch { throw new HttpError(400, 'Invalid JSON.'); }
}

export function createApp({database = 'auuki.sqlite', origin = 'http://localhost:3000',
    secureCookies = true, clock = () => Date.now()} = {}) {
    const db = new DatabaseSync(database);
    db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS documents (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind TEXT NOT NULL, value TEXT NOT NULL, revision INTEGER NOT NULL,
            PRIMARY KEY (user_id, kind)
        );
        PRAGMA user_version = 1;
    `);
    const attempts = new Map();
    const cookie = (token, maxAge) => `auuki_session=${token}; Path=/api/server; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;
    const document = (id, kind) => {
        const row = db.prepare('SELECT value, revision FROM documents WHERE user_id = ? AND kind = ?').get(id, kind);
        return {data: row ? JSON.parse(row.value) : null, revision: row?.revision ?? 0};
    };
    const save = (id, kind, value, revision) => {
        if(!Number.isSafeInteger(revision) || revision < 0) throw new HttpError(400, 'A document revision is required.');
        const text = JSON.stringify(value);
        if(Buffer.byteLength(text) > MAX_BODY) throw new HttpError(413, 'Stored document exceeds 32 MiB.');
        const result = revision === 0
            ? db.prepare('INSERT OR IGNORE INTO documents VALUES (?, ?, ?, 1)').run(id, kind, text)
            : db.prepare('UPDATE documents SET value = ?, revision = revision + 1 WHERE user_id = ? AND kind = ? AND revision = ?').run(text, id, kind, revision);
        if(result.changes !== 1) throw new HttpError(409, 'Server data changed in another session. Reload before editing.');
        return document(id, kind);
    };
    function user(request) {
        const token = request.headers.cookie?.split(';').map(c => c.trim())
            .find(c => c.startsWith('auuki_session='))?.slice('auuki_session='.length);
        if(!token || !/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, 'Sign in to your server account.');
        const row = db.prepare(`SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id
            WHERE sessions.token = ? AND sessions.expires > ?`).get(digest(token), clock());
        if(!row) throw new HttpError(401, 'Your server session expired. Sign in again.');
        return {...row, token: digest(token)};
    }
    function rateLimit(request) {
        const now = clock();
        for(const [key, entry] of attempts) if(entry.until <= now) attempts.delete(key);
        const key = request.socket.remoteAddress;
        const entry = attempts.get(key) || {count: 0, until: now + 15 * 60000};
        if(entry.count >= 20 || (!attempts.has(key) && attempts.size >= 10000)) {
            throw new HttpError(429, 'Too many authentication attempts. Try again in 15 minutes.');
        }
        entry.count++;
        attempts.set(key, entry);
    }
    async function route(request, response) {
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        const path = new URL(request.url, origin).pathname;
        const send = (status, data) => { response.writeHead(status); response.end(JSON.stringify(data)); };
        if(path === '/api/server/health' && request.method === 'GET') return send(200, {available: true});
        if(!path.startsWith('/api/server/')) throw new HttpError(404, 'Not found.');
        if(!['GET', 'POST', 'PUT', 'DELETE'].includes(request.method)) throw new HttpError(405, 'Method not allowed.');
        let body;
        if(request.method !== 'GET') {
            if(request.headers.origin !== origin) throw new HttpError(403, 'Request origin is not allowed.');
            body = await readJSON(request);
            if(!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected a JSON object.');
        }
        if(['/api/server/register', '/api/server/login'].includes(path) && request.method === 'POST') {
            rateLimit(request);
            const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
            const password = body.password;
            if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
               typeof password !== 'string' || password.length < 12 || Buffer.byteLength(password) > 1024) {
                throw new HttpError(400, 'Use a valid email and a password of 12-1024 bytes (at least 12 characters).');
            }
            let id;
            if(path.endsWith('/register')) {
                const salt = randomBytes(16).toString('hex');
                const hash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
                const result = db.prepare('INSERT OR IGNORE INTO users (email, password) VALUES (?, ?)').run(email, `${salt}:${hash}`);
                if(!result.changes) throw new HttpError(409, 'An account with this email already exists.');
                id = Number(result.lastInsertRowid);
            } else {
                const row = db.prepare('SELECT id, password FROM users WHERE email = ?').get(email);
                const [salt, hash] = (row?.password || `${'0'.repeat(32)}:${'0'.repeat(128)}`).split(':');
                const candidate = Buffer.from(await scrypt(password, salt, 64));
                if(!timingSafeEqual(candidate, Buffer.from(hash, 'hex')) || !row) {
                    throw new HttpError(401, 'Email or password is incorrect.');
                }
                id = row.id;
            }
            // Replace this browser's prior session rather than leaving it live.
            const oldToken = request.headers.cookie?.match(/(?:^|;\s*)auuki_session=([a-f0-9]{64})(?:;|$)/)?.[1];
            if(oldToken) db.prepare('DELETE FROM sessions WHERE token = ?').run(digest(oldToken));
            db.prepare('DELETE FROM sessions WHERE expires <= ?').run(clock());
            const token = randomBytes(32).toString('hex');
            db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), id, clock() + SESSION_MS);
            response.setHeader('Set-Cookie', cookie(token, SESSION_MS / 1000));
            return send(200, {email});
        }
        const account = user(request);
        if(request.headers['x-auuki-account'] && request.headers['x-auuki-account'] !== account.email) {
            throw new HttpError(409, 'The signed-in account changed in another tab. Reload before continuing.');
        }
        if(path === '/api/server/session' && request.method === 'GET') return send(200, {email: account.email});
        if(path === '/api/server/logout' && request.method === 'POST') {
            db.prepare('DELETE FROM sessions WHERE token = ?').run(account.token);
            response.setHeader('Set-Cookie', cookie('', 0));
            return send(200, {success: true});
        }
        if(path === '/api/server/account' && request.method === 'DELETE') {
            if(body.confirm !== account.email) throw new HttpError(400, 'Confirm your account email to delete it.');
            db.prepare('DELETE FROM users WHERE id = ?').run(account.id);
            response.setHeader('Set-Cookie', cookie('', 0));
            return send(200, {success: true});
        }
        if(path === '/api/server/backup') {
            if(request.method === 'GET') return send(200, document(account.id, 'backup'));
            if(request.method === 'PUT') {
                if(body.data?.version !== 1 || !Array.isArray(body.data.workouts) ||
                   !Array.isArray(body.data.activities) || !body.data.settings ||
                   typeof body.data.settings !== 'object' || Array.isArray(body.data.settings) ||
                   !Array.isArray(body.data.calendar)) {
                    throw new HttpError(400, 'Invalid Auuki backup.');
                }
                return send(200, save(account.id, 'backup', body.data, body.revision));
            }
        }
        if(path === '/api/server/coaching' && request.method === 'GET') {
            const stored = document(account.id, 'coaching');
            const service = new CoachingService({getItem: () => stored.data ? JSON.stringify(stored.data) : null});
            return send(200, {...stored, data: service.data});
        }
        if(path === '/api/server/coaching' && request.method === 'POST') {
            if(!methods.has(body.method) || !Array.isArray(body.args) || body.args.length > 4) {
                throw new HttpError(400, 'Unknown coaching operation or invalid arguments.');
            }
            const stored = document(account.id, 'coaching');
            if(body.revision !== stored.revision) throw new HttpError(409, 'Server coaching changed. Reload before editing.');
            let saved = stored;
            const service = new CoachingService({
                getItem: () => stored.data ? JSON.stringify(stored.data) : null,
                setItem: (key, value) => { saved = save(account.id, 'coaching', JSON.parse(value), stored.revision); },
            }, () => new Date(clock()).toISOString());
            let result;
            try { result = await service[body.method](...body.args); }
            catch(error) {
                if(error instanceof HttpError) throw error;
                if(error.code) throw error;
                console.warn('Coaching input rejected:', error.message);
                throw new HttpError(400, error.message);
            }
            return send(200, {data: service.data, revision: saved.revision, result});
        }
        throw new HttpError(404, 'Not found.');
    }
    const server = createServer((request, response) => {
        route(request, response).catch(error => {
            if(!error.status || error.status >= 500) console.error('Server request failed:', error);
            if(response.destroyed) return;
            if(error.status === 413) {
                response.setHeader('Connection', 'close');
                request.resume();
            }
            response.writeHead(error.status || 500);
            response.end(JSON.stringify({error: error.status ? error.message : 'Server operation failed.'}));
        });
    });
    server.requestTimeout = 60000;
    server.headersTimeout = 15000;
    return {server, close: () => db.close()};
}
