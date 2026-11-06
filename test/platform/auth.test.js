/*
 * auth.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * documents the expected behavior of the application and prevents regressions during development.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

/** @jest-environment jsdom */
jest.mock('../../src/platform/ui.js', () => ({launchPlatform: jest.fn().mockResolvedValue()}));
jest.mock('../../src/platform/pwa.js', () => ({registerPwa: jest.fn()}));

const settle = async () => { for(let i = 0; i < 30; i++) await Promise.resolve(); };
const response = (data, status = 200) => ({ok: status === 200, status,
    headers: {get: () => 'application/json'}, json: async () => data});
let listeners;

beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    window.history.replaceState({}, '', '/#/account');
    document.body.innerHTML = '<div id="platform"></div><div class="wrapper" hidden></div>';
    global.fetch = jest.fn(url => {
        if(url === '/api/server/health') {
            return Promise.resolve(response({available: true, version: 'build-42.1', revision: '0123456789abcdef'}));
        }
        throw new Error(`Unexpected request: ${url}`);
    });
    listeners = jest.spyOn(window, 'addEventListener');
});
afterEach(() => {
    for(const [type, handler] of listeners.mock.calls) window.removeEventListener(type, handler);
    listeners.mockRestore();
});
const start = async () => {
    await import('../../src/platform/start.js');
    await settle();
    return require('../../src/platform/ui.js').launchPlatform;
};
const fill = () => {
    const form = document.querySelector('#platform-login');
    form.elements.email.value = 'rider@example.com';
    form.elements.password.value = 'a long test password';
    return form;
};

test.each(['/', '/mobile'])('guest startup at %s preserves local data and never requires a backend', async path => {
    window.history.replaceState({}, '', path);
    localStorage.setItem('ftp', '250');
    const launch = await start();
    expect(fetch).not.toHaveBeenCalled();
    expect(launch).toHaveBeenCalledWith(document.querySelector('#platform'), null);
    expect(require('../../src/storage/account.js').accountDatabase()).toBe('store');
    expect(localStorage.getItem('ftp')).toBe('250');
    expect(localStorage.getItem('athlima-server-mode')).toBeNull();
});

test.each(['login', 'register'])('%s submits to the current backend and restores an isolated account scope', async operation => {
    const launch = await start();
    expect(launch).not.toHaveBeenCalled();
    expect(document.querySelector('[data-frontend-version]').textContent).toBe('development');
    expect(document.querySelector('[data-backend-version]').textContent).toBe('build-42.1 (0123456789ab)');
    const form = fill();
    fetch.mockResolvedValueOnce(response({email: 'rider@example.com'}))
        .mockResolvedValueOnce(response({email: 'rider@example.com'}));
    form.querySelector(`[value="${operation}"]`).click();
    await settle();
    const request = fetch.mock.calls.find(([url]) => url === `/api/server/${operation}`);
    expect(request).toBeDefined();
    expect(JSON.parse(request[1].body)).toEqual({
        email: 'rider@example.com', password: 'a long test password'});
    expect(launch).toHaveBeenCalledWith(document.querySelector('#platform'), {email: 'rider@example.com'});
    expect(require('../../src/storage/account.js').accountDatabase()).toContain('rider%40example.com');
    expect(localStorage.getItem('athlima-server-mode')).toBe('1');
    expect(localStorage.getItem('password')).toBeNull();
});

test('implicit submission, duplicate registration and network failures show errors without losing input', async () => {
    await start();
    const form = fill();
    fetch.mockResolvedValueOnce(response({error: 'An account with this email already exists.'}, 409));
    form.querySelector('[value="register"]').click();
    await settle();
    expect(document.querySelector('[role="alert"]').textContent).toContain('already exists');
    expect(form.elements.email.value).toBe('rider@example.com');
    expect(form.querySelector('button').disabled).toBe(false);
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
    await settle();
    expect(fetch.mock.calls.some(([url]) => url === '/api/server/login')).toBe(true);
    expect(document.querySelector('[role="alert"]').textContent).toContain('Cannot reach Athlima');
});

test('origin and credential errors stay visible and guest access is explicit after session failure', async () => {
    localStorage.setItem('athlima-server-mode', '1');
    fetch.mockResolvedValueOnce(response({error: 'Session expired'}, 401));
    const launch = await start();
    expect(launch).not.toHaveBeenCalled();
    const form = fill();
    for(const [error, status] of [['Request origin is not allowed. Configure ATHLIMA_ORIGIN.', 403],
        ['Email or password is incorrect.', 401]]) {
        fetch.mockResolvedValueOnce(response({error}, status));
        form.querySelector('[value="login"]').click();
        await settle();
        expect(document.querySelector('[role="alert"]').textContent).toContain(
            status === 403 ? 'This action is not allowed.' : error);
    }
    document.querySelector('#continue-guest').click();
    await settle();
    expect(launch).toHaveBeenCalledWith(document.querySelector('#platform'), null);
    expect(localStorage.getItem('athlima-server-mode')).toBeNull();
});

test('a rejected session cookie is reported instead of pretending registration succeeded', async () => {
    const launch = await start();
    const form = fill();
    fetch.mockResolvedValueOnce(response({email: 'rider@example.com'}))
        .mockResolvedValueOnce(response({error: 'Sign in'}, 401));
    form.querySelector('[value="register"]').click();
    await settle();
    expect(document.querySelector('[role="alert"]').textContent).toContain("account was created, but we couldn't keep you signed in");
    expect(launch).not.toHaveBeenCalled();
    expect(localStorage.getItem('athlima-server-mode')).toBeNull();
});

test('restoring an account verifies its session; simultaneous expiry errors keep account data protected', async () => {
    localStorage.setItem('athlima-server-mode', '1');
    fetch.mockResolvedValueOnce(response({email: 'rider@example.com'}));
    const launch = await start();
    expect(launch).toHaveBeenCalledWith(document.querySelector('#platform'), {email: 'rider@example.com'});
    window.dispatchEvent(new CustomEvent('session:expired', {detail: 'Session expired'}));
    window.dispatchEvent(new CustomEvent('session:expired', {detail: 'Session expired'}));
    await settle();
    expect(document.querySelector('#platform-login')).not.toBeNull();
    expect(document.querySelector('.wrapper').hidden).toBe(true);
    expect(localStorage.getItem('athlima-server-mode')).toBe('1');
});

test('an unavailable account backend is reported without silently switching to guest mode', async () => {
    localStorage.setItem('athlima-server-mode', '1');
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const launch = await start();
    expect(launch).not.toHaveBeenCalled();
    expect(document.querySelector('[role="alert"]').textContent).toContain('Cannot reach Athlima');
    expect(document.querySelector('#continue-guest')).not.toBeNull();
    expect(localStorage.getItem('athlima-server-mode')).toBe('1');
});
