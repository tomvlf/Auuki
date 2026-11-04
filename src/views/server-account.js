import { xf } from '../functions.js';
import { db } from '../db.js';
import { authenticate, serverAccount, serverEnabled, serverRequest, SERVER_MODE_KEY } from '../server/client.js';
import { createBackup, restoreBackup } from '../server/backup.js';
import { fileHandler } from '../file.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

class ServerAccount extends HTMLElement {
    connectedCallback() {
        this.controller = new AbortController();
        const options = {signal: this.controller.signal};
        this.addEventListener('submit', event => this.submit(event), options);
        this.addEventListener('click', event => this.click(event), options);
        xf.sub('coaching:changed', () => this.render(), options);
        this.render();
    }
    disconnectedCallback() { this.controller.abort(); }
    render() {
        this.innerHTML = `<details><summary>Optional server account</summary>
            <p>Local-only is the default. Signing in uses this host's server to store coaching
            history and calculate plans and adaptations. Local coaching history is kept separately
            and is not uploaded. No LLM or external AI service is used.</p>
            <p>Workouts, recent FIT recordings, profile settings and your manual calendar can be
            saved explicitly as a private server backup. They are not automatically synced.</p>
            ${this.message ? `<p role="status">${escape(this.message)}</p>` : ''}
            ${this.error ? `<p role="alert">${escape(this.error)}</p>` : ''}
            <fieldset ${this.busy ? 'disabled' : ''}>
            ${serverEnabled() && serverAccount.email ? `
                <p>Server coaching enabled for ${escape(serverAccount.email)}.</p>
                <button type="button" data-server="save">Save this device's data to server</button>
                <button type="button" data-server="download">Download server backup</button>
                <form data-server-form="restore">
                    <label><input type="checkbox" name="confirm" required>Merge saved workouts and
                    FIT recordings into this device and replace its profile settings and calendar.</label>
                    <button type="submit">Restore server backup and reload</button>
                </form>
                <button type="button" data-server="logout">Sign out and use local coaching</button>
                <form data-server-form="delete">
                    <label>Type your account email to permanently delete the account and all server data
                    <input type="email" name="confirm" required autocomplete="off"></label>
                    <button type="submit">Delete server account</button>
                </form>
            ` : `
                <p>${serverEnabled() ? 'Server mode is selected. Sign in again to reconnect.' : 'Local-only mode. No server account is required.'}</p>
                <form data-server-form="auth">
                    <label>Email <input type="email" name="email" autocomplete="username" required maxlength="254"></label>
                    <label>Password (at least 12 characters)
                        <input type="password" name="password" autocomplete="current-password" minlength="12" maxlength="1024" required></label>
                    <button type="submit" name="operation" value="login">Sign in and enable server coaching</button>
                    <button type="submit" name="operation" value="register">Create account and enable server coaching</button>
                </form>
            `}
            ${serverEnabled() ? '<button type="button" data-server="local">Use local-only without ending the server session</button>' : ''}
            </fieldset></details>`;
    }
    async run(operation) {
        if(this.busy) return;
        if(db.watchStatus !== 'stopped') {
            this.error = 'Stop the current ride before changing server data or account mode.';
            this.render();
            return;
        }
        this.busy = true;
        this.error = '';
        this.message = '';
        const details = this.querySelector('details');
        try { await operation(); }
        catch(error) {
            console.error('Server account operation failed:', error);
            this.error = error.message;
        } finally {
            this.busy = false;
            this.render();
            if(details?.open) this.querySelector('details').open = true;
        }
    }
    async submit(event) {
        const form = event.target.closest('[data-server-form]');
        if(!form) return;
        event.preventDefault();
        const values = new FormData(form);
        const operation = event.submitter?.value;
        await this.run(async () => {
            if(form.dataset.serverForm === 'auth') {
                if(!['register', 'login'].includes(operation)) throw new Error('Choose sign in or create account.');
                await authenticate(operation, {email: values.get('email'), password: values.get('password')});
                window.location.reload();
            } else if(form.dataset.serverForm === 'restore') {
                if(!values.get('confirm')) throw new Error('Confirm the restore first.');
                const backup = await serverRequest('backup');
                if(!backup.data) throw new Error('No server backup has been saved yet.');
                await restoreBackup(backup.data);
                window.location.reload();
            } else if(form.dataset.serverForm === 'delete') {
                await serverRequest('account', {method: 'DELETE', body: {confirm: values.get('confirm')}});
                window.localStorage.removeItem(SERVER_MODE_KEY);
                window.localStorage.setItem('auuki-session-change', String(Date.now()));
                window.location.reload();
            }
        });
    }
    async click(event) {
        const action = event.target.closest('[data-server]')?.dataset.server;
        if(!action) return;
        await this.run(async () => {
            if(action === 'local' || action === 'logout') {
                if(action === 'logout') await serverRequest('logout', {method: 'POST', body: {}});
                window.localStorage.removeItem(SERVER_MODE_KEY);
                window.localStorage.setItem('auuki-session-change', String(Date.now()));
                window.location.reload();
            } else if(action === 'save') {
                // First save after reload must not overwrite an existing backup without reviewing it.
                if(this.backupRevision === undefined) {
                    const backup = await serverRequest('backup');
                    this.backupRevision = backup.revision;
                    if(backup.data) {
                        this.message = `Existing backup from ${backup.data.savedAt}. Download it first if needed, or click Save again to replace it.`;
                        return;
                    }
                }
                const saved = await serverRequest('backup', {method: 'PUT',
                    body: {revision: this.backupRevision, data: await createBackup(db.workouts)}});
                this.backupRevision = saved.revision;
                this.message = 'Device data saved to your private server backup.';
            } else if(action === 'download') {
                const backup = await serverRequest('backup');
                if(!backup.data) throw new Error('No server backup has been saved yet.');
                fileHandler.download()(JSON.stringify(backup.data, null, 2), 'auuki-server-backup.json', 'application/json');
                this.message = 'Server backup downloaded. Export coaching history separately in Workouts > Calendar.';
            }
        });
    }
}

customElements.define('server-account', ServerAccount);
