/*
 * auth-forms.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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
import { models } from '../../src/models/models.js';
import '../../src/views/auth-forms.js';

jest.mock('../../src/models/models.js', () => ({models: {api: {auth: {
    register: jest.fn(), login: jest.fn(),
}}}}));

test('legacy registration and login no longer depend on Turnstile and display backend errors', async () => {
    document.body.innerHTML = `<div id="profile"></div><button id="logout--button"></button>
        <p id="auth-error--section"></p><p id="forgot--msg"></p>`;
    const auth = document.createElement('auth-forms');
    auth.innerHTML = ['register', 'login', 'forgot', 'reset'].map(method =>
        `<form id="${method}--form"><input name="email" value="rider@example.com">
        <input name="password" type="password" value="a long test password"><button>Submit</button></form>`).join('');
    document.body.append(auth);
    for(const method of ['register', 'login']) {
        models.api.auth[method].mockRejectedValueOnce(new Error('Meaningful backend error'));
        const form = auth.querySelector(`#${method}--form`);
        form.elements.password.value = 'a long test password';
        form.dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
        await Promise.resolve();
        await Promise.resolve();
        expect(models.api.auth[method]).toHaveBeenCalledWith({data: {
            email: 'rider@example.com', password: 'a long test password'}});
        expect(document.querySelector('#auth-error--section').textContent).toBe('Meaningful backend error');
        expect(form.elements.email.value).toBe('rider@example.com');
    }
    auth.remove();
});
