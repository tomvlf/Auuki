export const SERVER_MODE_KEY = 'auuki-server-mode';
export const serverAccount = {email: null};
export const serverEnabled = () => window.localStorage.getItem(SERVER_MODE_KEY) === '1';

export async function serverRequest(path, {method = 'GET', body, account = serverAccount.email} = {}) {
    const response = await fetch(`/api/server/${path}`, {
        method, credentials: 'same-origin', cache: 'no-store',
        headers: {'Content-Type': 'application/json', 'X-Auuki-Client': '1',
            ...(account ? {'X-Auuki-Account': account} : {})},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
    });
    if(!response.headers.get('content-type')?.includes('application/json')) {
        throw new Error('The Auuki backend is unavailable on this host. Your loaded ride remains local; retry when the server is available.');
    }
    const result = await response.json();
    if(!response.ok) {
        const error = new Error(result.error || `Server request failed (${response.status}).`);
        error.status = response.status;
        if(response.status === 401 && account && typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('session:expired', {detail: error.message}));
        }
        throw error;
    }
    return result;
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
