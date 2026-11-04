/*
 * lock.js: front-end client module.
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

import { xf } from './functions.js';

class WakeLock {
    constructor(args) {
        this.lock = undefined;
        this.isLocked = false;
        this.isLocable = false;
        this.isVisible = false;
        this.init();
    }
    init() {
        let self = this;
        self.isLocable = ('wakeLock' in navigator);
        self.isVisible = self.checkVisibility();

        self.lockScreen();

        document.addEventListener('visibilitychange', self.onVisibilityChange.bind(self));

        window.addEventListener('beforeunload', e => {
            xf.dispatch('lock:beforeunload');
        });
    }
    checkVisibility() {
        let isVisible = false;
        let visibilityState = document.visibilityState;

        if(visibilityState === 'visible') {
            isVisible = true;
        } else {
            isVisible = false;
        }
        return isVisible;
    }
    onVisibilityChange () {
        let self = this;

        if(self.checkVisibility()) {
            self.lockScreen();
        }
    }
    async lockScreen() {
        let self = this;
        if(self.isLocable && self.isVisible) {
            try {
                let lock = await navigator.wakeLock.request('screen');
                self.isLocked = true;

                lock.addEventListener('release', e => {
                    self.isLocked = false;
                    xf.dispatch('lock:release');
                    console.log(`Wake lock released.`);
                });
            } catch(e) {
                console.warn(`wake-lock: not-supported:`, e);
            }
        }
    }
}

const lock = new WakeLock();

export { lock };
