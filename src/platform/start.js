/*
 * start.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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

import { authenticate, serverAccount, serverRequest, serverEnabled, SERVER_MODE_KEY } from '../server/client.js';
import { setAccountScope } from '../storage/account.js';
import { escape } from './format.js';

const root = document.querySelector('#platform');
let launched = false;
let expired = false;

function login(message = '', unavailable = false) {
    root.removeAttribute('role');
    root.innerHTML = `<main class="auth-screen"><section class="auth-card">
        <a class="brand" href="/">auuki<span> / training</span></a>
        <p class="eyebrow">A clear path to your next goal</p>
        <h1>Your training.<br>Your next chapter.</h1>
        <p class="muted">Plan with purpose. Ride with focus. See your progress.</p>
        <p id="auth-error" role="alert">${escape(message)}</p>
        <form id="platform-login">
            <label>Email<input name="email" type="email" required maxlength="254" autocomplete="username"></label>
            <label>Password<input name="password" type="password" required minlength="12" maxlength="1024" autocomplete="current-password"></label>
            <p class="muted">Use at least 12 characters. Accounts are private to this server.</p>
            <div class="button-row"><button type="submit" value="login">Sign in</button>
                <button class="secondary" type="submit" value="register">Create account</button></div>
        </form>
        <button class="secondary" type="button" id="continue-guest">Continue without an account</button>
        <p class="muted">Guest rides, workouts and local coaching stay on this device. Sign in for server coaching, private backups and integrations.</p>
        ${unavailable ? '<p>Account features need the Auuki backend. You can still train as a guest.</p>' : ''}
        <p class="muted">Trainer connections require Chrome or Edge with Bluetooth support, on HTTPS or localhost. iOS browsers do not support Web Bluetooth.</p>
    </section></main>`;
    root.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.target;
        if(form.getAttribute('aria-busy') === 'true') return;
        form.setAttribute('aria-busy', 'true');
        const values = new FormData(form);
        const method = event.submitter?.value || 'login';
        form.querySelectorAll('button').forEach(button => { button.disabled = true; });
        root.querySelector('#continue-guest').disabled = true;
        try {
            const account = await authenticate(method,
                {email: values.get('email'), password: values.get('password')});
            if(launched) { window.location.reload(); return; }
            await open(account);
        } catch(error) {
            if(form.isConnected) {
                root.querySelector('#auth-error').textContent = error.message || 'Authentication could not be completed.';
                form.querySelectorAll('button').forEach(button => { button.disabled = false; });
                form.removeAttribute('aria-busy');
                root.querySelector('#continue-guest').disabled = false;
            } else login(error.message || 'The application could not be opened.');
        }
    });
    root.querySelector('#continue-guest').addEventListener('click', () => {
        window.localStorage.removeItem(SERVER_MODE_KEY);
        window.location.hash = '/player';
        if(launched) window.location.reload();
        else void openGuest().catch(error => login(error.message));
    });
}

async function open(account) {
    serverAccount.email = account?.email ?? null;
    setAccountScope(account?.email);
    const { launchPlatform } = await import('./ui.js');
    launched = true;
    await launchPlatform(root, account);
    const {registerPwa} = await import('./pwa.js');
    void registerPwa();
}

async function openGuest() {
    window.localStorage.removeItem(SERVER_MODE_KEY);
    await open(null);
}

window.addEventListener('session:expired', async event => {
    if(expired) return;
    expired = true;
    if(launched) {
        const { xf } = await import('../functions.js');
        xf.dispatch('ui:watchPause');
        xf.dispatch('sources', {autoStart: false});
        xf.dispatch('lock:beforeunload');
        const wrapper = document.querySelector('.wrapper');
        if(wrapper) wrapper.hidden = true;
    }
    login(event.detail || 'Your session expired. Sign in to resume. Your ride is kept on this device.');
});
window.addEventListener('storage', async event => {
    if(event.key !== 'auuki-session-change' || !launched) return;
    const { xf } = await import('../functions.js');
    xf.dispatch('ui:watchPause');
    xf.dispatch('lock:beforeunload');
    window.location.reload();
});

if(serverEnabled()) {
    serverRequest('session', {account: null}).then(open)
        .catch(error => login(error.status === 401 ? '' : error.message, error.status !== 401));
} else if(window.location.hash === '#/account') login();
else openGuest().catch(error => login(error.message));
