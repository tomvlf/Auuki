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

export async function serverRequest(path, {method = 'GET', body, account = serverAccount.email} = {}) {
    let response;
    try { response = await fetch(`/api/server/${path}`, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json', 'X-Athlima-Client': '1',
            ...(account ? {'X-Athlima-Account': account} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    }); } catch(error) {
        throw new Error('Cannot reach the Athlima server. Check your connection and try again.', {cause: error});
    }
    if(!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The Athlima backend is unavailable on this host. Your loaded ride remains local; retry when the server is available.');
    }
    let result;
    try { result = await response.json(); }
    catch(error) {
        throw new Error('The Athlima backend returned an invalid response. Try again or contact the server operator.', {cause: error});
    }    if(!response.ok) {
        const error = new Error(result?.error || `Server request failed (${response.status}).`);
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
        throw new Error(`${operation === 'register' ? 'Your account was created, but' : 'Your credentials were accepted, but'} the session cookie was not saved. Enable cookies and use HTTPS, or ask the operator to enable ATHLIMA_INSECURE_COOKIES for localhost HTTP.`);
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
        const service = new ServerCoachingService(await serverRequest('coaching', {account: account.email}), account.email);
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
    resolve(...args) { return this.call('resolve', args); }
    updateFeedback(...args) { return this.call('updateFeedback', args); }
    advance(...args) { return this.call('advance', args); }
}
