/*
 * auth-forms.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * renders the screen, controls, and UI panels that let a rider interact with the app.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf, empty, } from '../functions.js';
import { models } from '../models/models.js';

// TODO: This needs refactoring to something more general with
// declarative configuration. Something that will work for all tabs and switches.
class AuthForms extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.el = {
            // each subset is exclusive or with css class .active
            //
            // tabs
            // passkey, password
            // forms
            // passkey -> login, register -> profile
            // password -> login, register, forgot, reset -> profile
            // error
            // switch: {
            //     $passkey: document.querySelector('#passkey--tab--switch'),
            //     $password: document.querySelector('#password--tab--switch'),
            // },
            // tab: {
            //     $passkey:  document.querySelector('#passkey--forms'),
            //     $password: document.querySelector('#password--forms'),
            // },
            password: {
                $register: self.querySelector('#register--form'),
                $login: self.querySelector('#login--form'),
                $forgot: self.querySelector('#forgot--form'),
                $reset: self.querySelector('#reset--form'),
                $profile: document.querySelector('#profile'),
            },
            // passkey: {
            //     $register: self.querySelector('#passkey--register--form'),
            //     $login: self.querySelector('#passkey--login--form'),
            //     $profile: document.querySelector('#profile'),
            // },
            $logout: document.querySelector('#logout--button'),
            $error: document.querySelector('#auth-error--section'),
            $pwds: document.querySelectorAll('input[type="password"]'),
        };

        this.subForm('password', '$login', 'login');
        this.subForm('password', '$register', 'register');
        this.subForm('password', '$forgot', 'forgot');
        this.subForm('password', '$reset', 'reset');

        this.el.$logout.addEventListener('click', async () => {
            try { await models.api.auth.logout(); }
            catch(error) { this.error(error.message || 'Sign out could not be completed.'); }
        }, this.signal);

        this.$forgotMsg = document.querySelector('#forgot--msg'),

        xf.sub('action:auth', self.onAction.bind(this));
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    subForm(group, form, method) {
        const $form = this.el[group][form];

        $form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData($form);
            try {
                if(!['register', 'login'].includes(method)) {
                    if(!window.turnstile) throw new Error('Password recovery is not available on this server.');
                    formData.append('cf-turnstile-response', window.turnstile.getResponse());
                }
                await models.api.auth[method]({data: Object.fromEntries(formData)});
                $form.reset();
                if(['forgot', 'reset'].includes(method)) models.api.auth.resetTurnstile();
            } catch(error) {
                this.error(error.message || 'Authentication could not be completed.');
            }

        }, this.signal);
    }
    onAction(action) {
        const self = this;
        console.log(action);

        // TODO: figure out a condition
        // models.api.auth.loadTurnstile();

        if(action === ':password') {
            this.switch('$password', this.el.tab);
            this.switch('$password', this.el.switch);
            return;
        }
        // if(action === ':passkey') {
        //     // TODO: fix when webauthn is ready
        //     // this.switch('$passkey', this.el.tab);
        //     // this.switch('$passkey', this.el.switch);
        //     return;
        // }
        if(action === ':password:login') {
            this.switch('$login', this.el.password);
            return;
        }
        if(action === ':password:register') {
            this.switch('$register', this.el.password);
            return;
        }
        if(action === ':password:forgot') {
            this.switch('$forgot', this.el.password);
            return;
        }
        if(action === ':password:reset') {
            this.switch('$reset', this.el.password);
            return;
        }
        if(action === ':password:profile') {
            this.switch('$profile', this.el.password);
            return;
        }
        if(action === ':password:logout') {
            this.switch('$login', this.el.password);
            return;
        }
        // if(action === ':passkey:login') {
        //     this.switch('$login', this.el.passkey);
        //     return;
        // }
        // if(action === ':passkey:register') {
        //     this.switch('$register', this.el.passkey);
        //     return;
        // }
        if(action === ':forgot:loading') {
            console.log(`:view :action:auth :forgot:loading`);
            this.$forgotMsg.textContent = "Sending reset request ...";
            this.$forgotMsg.classList.remove('success');
            this.$forgotMsg.classList.remove('error');
            this.$forgotMsg.classList.add('loading');
        }
        if(action === ':forgot:success') {
            console.log(`:view :action:auth :forgot:success`);
            this.$forgotMsg.textContent = "An email with a password reset link has been sent to your email!";
            this.$forgotMsg.classList.remove('loading');
            this.$forgotMsg.classList.remove('error');
            this.$forgotMsg.classList.add('success');
        }
        if(action === ':forgot:fail') {
            console.log(`:view :action:auth :forgot:fail`);
            this.$forgotMsg.textContent = "Something went wrong while sending a password reset email!";
            this.$forgotMsg.classList.remove('loading');
            this.$forgotMsg.classList.remove('success');
            this.$forgotMsg.classList.add('error');
        }
        if(action === ':error') {
            this.error('Wrong credentials or Authentication error');
            return;
        }
        if(action === ':no-api') {
            this.switch('', this.el.tab);
            this.switch('', this.el.password);
            this.switch('', this.el.passkey);
            this.error('No internet connection or the API service is currently offline.');
            return;
        }
    }
    switch(target, elements) {
        this.el.$error.classList.remove('active');

        // prevent potential content flash
        // by first removing and only after that adding .active
        // if there is no target element this is not an error,
        // it means all content should be 'non-active'
        for(let prop in elements) {
            if(!(target === prop)) {
                elements[prop].classList.remove('active');
            }
        }
        if(target) {
            elements[target].classList.add('active');
        }
    }
    error(msg = '') {
        if(msg !== '') {
            this.el.$error.textContent = msg;
        }
        this.el.$error.classList.add('active');
        this.el.$pwds.forEach(($el) => $el.value = '');
    }
}

customElements.define('auth-forms', AuthForms);
