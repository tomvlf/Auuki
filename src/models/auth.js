/*
 * auth.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * defines the data structures and API contracts used by the app when storing and exchanging rider data.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { exists, xf, once, print, } from '../functions.js';
import { DialogMsg } from './enums.js';
import { uuid } from '../storage/uuid.js';
import config from './config.js';
import strava from './strava.js';
import intervals from './intervals.js';
import trainingPeaks from './training-peaks.js';
import { authenticate, serverRequest, SERVER_MODE_KEY } from '../server/client.js';

function Auth(args = {}) {
    const api_uri = config.get().API_URI;
    const pwa_uri = config.get().PWA_URI;

    let _loggedIn = false;
    let _hasApi = true;

    let _turnstileLoaded = false;
    let _turnstileId;
    let _expired = true;

    function loadTurnstile() {
        if(!_loggedIn && _hasApi && !_turnstileLoaded) {
            console.log(`:turnstile :load`);

            const script = document.createElement('script');
            script.src = `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onloadTurnstile`;
            script.async = true;
            script.defer = true;
            document.head.appendChild(script);
        }
    };

    window.onloadTurnstile = function() {
        console.log(`:turnstile :onload`);
        _turnstileLoaded = true;
        renderTurnstile();
    };

    function renderTurnstile() {
        if('turnstile' in window) {
            console.log(`:turnstile :render ${_turnstileId}`);

            _turnstileId = window.turnstile.render("#cf-turnstile-container", {
                sitekey: "0x4AAAAAAA2IUz1CU0EU3E-O",
            });

            _expired = false;
        }
    }

    function resetTurnstile() {
        if('turnstile' in window) {
            console.log(`:turnstile :reset ${_turnstileId}`);
            window.turnstile.reset(_turnstileId);
            _expired = false;
        }
    }
    function isTurnstileExpired() {
        if('turnstile' in window) {
            console.log(`:turnstile :reset ${_turnstileId}`);
            _expired = window.turnstile.isExpired(_turnstileId);
            return _expired;
        }
        return true;
    }

    function removeTurnstile() {
        if('turnstile' in window) {
            console.log(`:turnstile :remove ${_turnstileId}`);
            window.turnstile.remove(_turnstileId);
            _expired = true;
        }
    }


    function isBrowser() {
        return (
            ('bluetooth' in navigator) && ('wakeLock' in navigator)
        );
    }

    // {data: {FormData}} -> Void
    async function register(args = {}) {
        return signIn('register', args.data);
    }

    // {data: {FormData}} -> Void
    async function login(args = {}) {
        return signIn('login', args.data);
    }

    async function signIn(operation, data = {}) {
        if(operation === 'register' && data.password !== data.password_confirmation) {
            throw new Error('Passwords do not match.');
        }
        const { db } = await import('../db.js');
        if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before changing accounts.');
        await authenticate(operation, {email: data.email, password: data.password});
        window.location.reload();
    }

    async function logout() {
        const { db } = await import('../db.js');
        if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before signing out.');
        await serverRequest('logout', {method: 'POST', body: {}});
        window.localStorage.removeItem(SERVER_MODE_KEY);
        window.localStorage.setItem('auuki-session-change', String(Date.now()));
        window.location.reload();
    }

    // {data: {FormData}} -> Void
    async function forgot(args = {}) {
        const url = `${api_uri}/api/forgot-password`;
        const data = args.data;

        if(data.email.trim() === '' || !isBrowser()) {
            console.log(`:forgot :blocked :is-browser ${isBrowser()}`);
            return;
        }

        try {
            xf.dispatch('action:auth', ':forgot:loading');
            const response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json',},
                credentials: 'include',
                body: JSON.stringify(data),
            });

            if(response.ok) {
                console.log(`:api :forgot :success`);
                xf.dispatch('action:auth', ':forgot:success');
            } else {
                console.log(`:api :forgot :fail :with ${response.status}`);
                xf.dispatch('action:auth', ':forgot:fail');
            }
        } catch(error) {
            console.log(`:api :forgot :fail`);
            console.log(error);
            xf.dispatch('action:auth', ':forgot:fail');
        }
    }

    // {data: {FormData}} -> Void
    async function reset(args = {}) {
        const params = (new URL(document.location)).searchParams;
        const token = params.get('token') ?? '';

        const url = `${api_uri}/api/reset-password`;

        const data = args.data;
        data.token = token;

        if(data.password.trim() === '' ||
           data.password_confirmation.trim() === '' ||
           !isBrowser()) {
            console.log(`:reset :blocked :is-browser ${isBrowser()}`);
            return;
        }

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json',},
                body: JSON.stringify(data),
            });

            if(response.ok) {
                console.log(`:api :reset :success`);
                window.history.pushState({}, document.title, window.location.pathname);
                xf.dispatch('action:auth', ':password:login');
            } else {
                console.error(`:api :reset :fail`);
                xf.dispatch('action:auth', ':error');
            }
        } catch(e) {
            console.error(`:api :reset :error `, e);
        }
    }

    async function status() {
        const url = `${api_uri}/api/rpc`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {'Content-Type': 'application/json',},
                credentials: 'include',
                body: JSON.stringify({
                    id: uuid(),
                    method: 'status_handler',
                    params: {data: {}},
                }),
            });

            const status = response.status;
            const body = await response.json();

            if(response.ok) {
                console.log(`:api :profile`);
                _loggedIn = true;

                if(_turnstileLoaded) {
                    removeTurnstile();
                }

                console.log(`:status`, body.result);

                config.setServices(body.result.services);
                strava.update();
                intervals.update();
                trainingPeaks.update();

                xf.dispatch('action:auth', ':password:profile');
                xf.dispatch('services', body?.result);
                return body.result;
            }
            if(status === 403) {
                _loggedIn = false;

                if(_turnstileLoaded) {
                }

                xf.dispatch('action:status', ':logout');
                xf.dispatch('action:auth', ':password:login');
                return {strava: false, intervals: false, trainingPeaks: false};
            }
            if(status === 500 || status === 405) {
                console.log(`:api :no-api`);

                _loggedIn = false;
                _hasApi = false;

                if(_turnstileLoaded) {
                    removeTurnstile();
                }

                xf.dispatch('action:auth', ':no-api');
                return {strava: false, intervals: false, trainingPeaks: false};
            }

            return {strava: false, intervals: false, trainingPeaks: false};
        } catch(error) {
            console.log(`:api :no-api`);
            console.log(error);

            if(_turnstileLoaded) {
                removeTurnstile();
            }

            xf.dispatch('action:auth', ':no-api');
            return {strava: false, intervals: false, trainingPeaks: false};
        }
    }

    return Object.freeze({
        register,
        login,
        logout,
        forgot,
        reset,
        status,

        loadTurnstile,
        resetTurnstile,
        isTurnstileExpired,
        removeTurnstile,
    });
}

const auth = Auth();

export default auth;
