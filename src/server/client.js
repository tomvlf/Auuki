/*
 * client.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

export const SERVER_MODE_KEY = 'athlima-server-mode';
export const serverAccount = {email: null};
export const serverEnabled = () => window.localStorage.getItem(SERVER_MODE_KEY) === '1';

function requestFailure(path, status, reason = 'response') {
    const operation = path.startsWith('integrations/intervals/activity-data') ? 'load this activity\'s route and measurements'
        : path.startsWith('integrations/intervals') ? 'complete this Intervals.icu action'
            : path === 'login' ? 'sign you in' : path === 'register' ? 'create your account'
                : path === 'session' ? 'check your sign-in'
                    : path === 'backup' ? 'complete your backup request'
                        : path === 'coaching' ? 'update or load your training information' : 'complete this action';
    const explanation = reason === 'connection' ? 'Cannot reach Athlima. Check your connection and try again.'
        : status === 401 ? 'Please sign in again.'
            : status === 403 ? 'This action is not allowed. If this continues, contact the app administrator.'
                : status === 404 ? 'This feature or item is not available. Refresh the page and try again.'
                    : status === 429 ? 'Too many requests were made. Wait a few minutes and try again.'
                        : [408, 504, 524].includes(status) ? 'The service took too long to respond. Try again shortly.'
                            : status >= 500 ? 'The service could not complete the request. Try again shortly.'
                                : 'The service sent a response we could not use. Refresh the page and try again.';
    const error = new Error(`We couldn't ${operation}. ${explanation}`);
    error.status = status;
    return error;
}

export async function serverRequest(path, {method = 'GET', body, account = serverAccount.email, signal} = {}) {
    let response;
    try { response = await fetch(`/api/server/${path}`, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json', 'X-Athlima-Client': '1',
            ...(account ? {'X-Athlima-Account': account} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        ...(signal ? {signal} : {}),
    }); } catch {
        throw requestFailure(path, undefined, 'connection');
    }
    if(!response.headers.get('content-type')?.includes('application/json')) {
        throw requestFailure(path, response.status);
    }
    let result;
    try { result = await response.json(); }
    catch {
        throw requestFailure(path, response.status);
    }
    if(!response.ok) {
        const error = response.status >= 500 || response.status === 403 || typeof result?.error !== 'string'
            ? requestFailure(path, response.status) : new Error(result.error);
        error.status = response.status;
        if(response.status === 401 && account && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('session:expired', {detail: error.message}));
        }
        throw error;
    }
    return result;
}

export async function authenticate(operation, credentials) {
    if(!['login', 'register'].includes(operation)) throw new Error('Choose sign in or create account.');
    const signedIn = await serverRequest(operation, {method: 'POST', account: null, body: credentials});
    let account;
    try { account = await serverRequest('session', {account: null}); }
    catch(error) {
        if(error.status !== 401) throw error;
        throw new Error(`${operation === 'register' ? 'Your account was created, but' : 'Your sign-in details were accepted, but'} we couldn't keep you signed in. Allow this site to save sign-in information in your browser and try signing in again. If this continues, contact the app administrator.`);
    }
    if(typeof signedIn?.email !== 'string' || account?.email !== signedIn.email) {
        throw new Error('The signed-in account changed. Please sign in again before opening account data.');
    }
    window.localStorage.setItem(SERVER_MODE_KEY, '1');
    window.localStorage.setItem('athlima-session-change', String(Date.now()));
    return account;
}

export class ServerCoachingService {
    constructor({data, revision}, email = serverAccount.email) {
        this.data = data;
        this.revision = revision;
        this.email = email;
    }
    static async open() {
        const account = await serverRequest('session', {account: null});
        let integration = await serverRequest('integrations/intervals', {account: account.email});
        if(integration.connected) {
            integration = await serverRequest('integrations/intervals/sync', {
                method: 'POST', account: account.email, body: {},
            });
        }
        const service = new ServerCoachingService(await serverRequest('coaching', {account: account.email}), account.email);
        service.syncPending = ['queued', 'running'].includes(integration.status);
        return service;
    }
    async call(method, args) {
        if(this.saving) throw new Error('Another server coaching update is saving; retry when it finishes.');
        this.saving = true;
        try {
            const result = await serverRequest('coaching', {method: 'POST', account: this.email,
                body: {method, args, revision: this.revision}});
            this.data = result.data;
            this.revision = result.revision;
            return result.result;
        } finally {
            this.saving = false;
        }
    }
    configure(...args) { return this.call('configure', args); }
    generate(...args) { return this.call('generate', args); }
    archive(...args) { return this.call('archive', args); }
    importActivities(...args) { return this.call('importActivities', args); }
    recordRide(...args) { return this.call('recordRide', args); }
    deleteRide(...args) { return this.call('deleteRide', args); }
    resolve(...args) { return this.call('resolve', args); }
    updateFeedback(...args) { return this.call('updateFeedback', args); }
    advance(...args) { return this.call('advance', args); }
}
