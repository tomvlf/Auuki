/** @jest-environment jsdom */
import { serverRequest } from '../../src/server/client.js';
import { launchPlatform } from '../../src/platform/ui.js';
import { accountDatabase } from '../../src/storage/account.js';

jest.mock('../../src/server/client.js', () => ({
    SERVER_MODE_KEY: 'auuki-server-mode', serverAccount: {}, serverRequest: jest.fn(),
}));
jest.mock('../../src/platform/ui.js', () => ({launchPlatform: jest.fn().mockResolvedValue()}));
jest.mock('../../src/platform/pwa.js', () => ({registerPwa: jest.fn()}));

const settle = async () => { for(let i = 0; i < 15; i++) await Promise.resolve(); };

test('mandatory login protects engine startup, handles unavailable service and restores an authenticated account scope', async () => {
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden></div>';
    serverRequest.mockRejectedValueOnce(Object.assign(new Error('Sign in'), {status: 401}));
    await import('../../src/platform/start.js');
    await settle();
    expect(launchPlatform).not.toHaveBeenCalled();
    expect(document.querySelector('#platform-login')).not.toBeNull();
    expect(document.querySelector('.wrapper').hidden).toBe(true);
    const form = document.querySelector('form');
    form.elements.email.value = 'rider@example.com';
    form.elements.password.value = 'a long test password';
    serverRequest.mockResolvedValueOnce({email: 'rider@example.com'})
        .mockResolvedValueOnce({email: 'rider@example.com'});
    const event = new Event('submit', {bubbles: true, cancelable: true});
    Object.defineProperty(event, 'submitter', {value: form.querySelector('[value="login"]')});
    form.dispatchEvent(event);
    await settle();
    expect(serverRequest).toHaveBeenCalledWith('login', {method: 'POST', account: null,
        body: {email: 'rider@example.com', password: 'a long test password'}});
    expect(launchPlatform).toHaveBeenCalledWith(document.querySelector('#platform'), {email: 'rider@example.com'});
    expect(accountDatabase()).toContain('rider%40example.com');
    expect(localStorage.getItem('auuki-server-mode')).toBe('1');
    expect(localStorage.getItem('password')).toBeNull();
});
