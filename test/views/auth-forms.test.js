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
