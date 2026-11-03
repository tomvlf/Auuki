import { serverAccount, serverRequest, SERVER_MODE_KEY } from '../server/client.js';
import { setAccountScope } from '../storage/account.js';
import { escape } from './format.js';

const root = document.querySelector('#platform');
let launched = false;

function login(message = '', unavailable = false) {
    root.removeAttribute('role');
    root.innerHTML = `<main class="auth-screen"><section class="auth-card">
        <a class="brand" href="/">auuki<span> / training</span></a>
        <p class="eyebrow">A clear path to your next goal</p>
        <h1>Your training.<br>Your next chapter.</h1>
        <p class="muted">Plan with purpose. Ride with focus. See your progress.</p>
        ${message ? `<p role="alert">${escape(message)}</p>` : ''}
        <form id="platform-login">
            <label>Email<input name="email" type="email" required maxlength="254" autocomplete="username"></label>
            <label>Password<input name="password" type="password" required minlength="12" maxlength="1024" autocomplete="current-password"></label>
            <p class="muted">Use at least 12 characters. Accounts are private to this server.</p>
            <div class="button-row"><button type="submit" value="login">Sign in</button>
                <button class="secondary" type="submit" value="register">Create account</button></div>
        </form>
        ${unavailable ? '<p>This platform requires the Auuki backend. Ask the operator to enable the server deployment.</p>' : ''}
        <p class="muted">Trainer connections require Chrome or Edge with Bluetooth support, on HTTPS or localhost. iOS browsers do not support Web Bluetooth.</p>
    </section></main>`;
    root.querySelector('form').addEventListener('submit', async event => {
        event.preventDefault();
        const form = event.target;
        const values = new FormData(form);
        const method = event.submitter.value;
        form.querySelectorAll('button').forEach(button => { button.disabled = true; });
        try {
            await serverRequest(method, {method: 'POST', account: null,
                body: {email: values.get('email'), password: values.get('password')}});
            window.localStorage.setItem('auuki-session-change', crypto.randomUUID());
            if(launched) { window.location.reload(); return; }
            await open();
        } catch(error) { login(error.message); }
    });
}

async function open() {
    const account = await serverRequest('session', {account: null});
    serverAccount.email = account.email;
    setAccountScope(account.email);
    window.localStorage.setItem(SERVER_MODE_KEY, '1');
    const { launchPlatform } = await import('./ui.js');
    launched = true;
    await launchPlatform(root, account);
    const {registerPwa} = await import('./pwa.js');
    void registerPwa();
}

window.addEventListener('session:expired', async event => {
    if(launched) {
        const { xf } = await import('../functions.js');
        xf.dispatch('ui:watchPause');
        xf.dispatch('sources', {autoStart: false});
        xf.dispatch('lock:beforeunload');
        document.querySelector('.wrapper').hidden = true;
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

open().catch(error => login(error.status === 401 ? '' : error.message, error.status !== 401));
