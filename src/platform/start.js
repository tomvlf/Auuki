import { setAccountScope } from '../storage/account.js';

const root = document.querySelector('#platform');

async function start() {
    setAccountScope(null);
    window.localStorage.removeItem('athlima-server-mode');
    if(window.location.hash === '#/account') window.location.hash = '/settings';
    const { launchPlatform } = await import('./ui.js');
    await launchPlatform(root);
    const { registerPwa } = await import('./pwa.js');
    await registerPwa();
}

void start().catch(error => {
    console.error('Unable to start the local application:', error);
    root.replaceChildren();
    const message = document.createElement('p');
    message.setAttribute('role', 'alert');
    message.textContent = `The application could not be opened: ${error.message}. Reload to retry.`;
    root.append(message);
});
