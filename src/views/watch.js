/*
 * watch.js: front-end client module.
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

import { xf } from '../functions.js';

class Watch extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.dom = {
            start:   document.querySelector('#watch-start'),
            pause:   document.querySelector('#watch-pause'),
            back:    document.querySelector('#watch-back'),
            lap:     document.querySelector('#watch-lap'),
            stop:    document.querySelector('#watch-stop'),
            save:    document.querySelector('#activity-save'),
            // workout: document.querySelector('#start-workout'),
        };

        this.dom.start.addEventListener('pointerup', this.onStart, this.signal);
        this.dom.pause.addEventListener('pointerup', this.onPause, this.signal);
        this.dom.back.addEventListener('pointerup', this.onBack, this.signal);
        this.dom.lap.addEventListener('pointerup', this.onLap, this.signal);
        this.dom.stop.addEventListener('pointerup', this.onStop, this.signal);
        // this.dom.workout.addEventListener('pointerup', this.onWorkoutStart);
        this.dom.save.addEventListener(`pointerup`, this.onSave, this.signal);

        this.renderInit(this.dom);

        xf.sub(`db:watchStatus`, this.onWatchStatus.bind(this), this.signal);
        xf.sub(`db:workoutStatus`, this.onWorkoutStatus.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onStart(e) {
        xf.dispatch('ui:watchStart');
        xf.dispatch('ui:workoutStart');
    }
    onPause(e) { xf.dispatch('ui:watchPause'); }
    onBack(e)  { xf.dispatch('ui:watchBack'); }
    onLap(e)   { xf.dispatch('ui:watchLap'); }
    onStop(e)  { xf.dispatch('ui:watchStop'); }
    onSave(e)  { xf.dispatch('ui:activity:save'); }
    onWorkoutStart(e) { xf.dispatch('ui:workoutStart'); }
    onWatchStatus(status) {
        if(status === 'started') { this.renderStarted(this.dom); }
        if(status === 'paused')  { this.renderPaused(this.dom);  }
        if(status === 'stopped') { this.renderStopped(this.dom); }
    }
    onWorkoutStatus(status) {
        if(status === 'started') { this.renderWorkoutStarted(this.dom); }
        if(status === 'done')    {  }
    }
    renderInit(dom) {
        dom.pause.style.display = 'none';
        dom.stop.style.display  = 'none';
        dom.save.style.display  = 'none';
        dom.lap.style.display   = 'none';
        dom.back.style.display  = 'none';
    };
    renderStarted(dom) {
        dom.start.style.display  = 'none';
        dom.save.style.display   = 'none';
        dom.pause.style.display  = 'inline-block';
        dom.lap.style.display    = 'inline-block';
        dom.back.style.display   = 'inline-block';
        dom.stop.style.display   = 'none';
        // dom.stop.style.display  = 'inline-block';
    };
    renderPaused(dom) {
        dom.pause.style.display    = 'none';
        // dom.back.style.display = 'none';
        dom.lap.style.display      = 'none';
        dom.start.style.display    = 'inline-block';
        dom.stop.style.display     = 'inline-block';
    };
    renderStopped(dom) {
        dom.pause.style.display  = 'none';
        dom.lap.style.display    = 'none';
        dom.back.style.display   = 'none';
        dom.stop.style.display   = 'none';
        dom.save.style.display   = 'inline-block';
        // dom.workout.style.display = 'inline-block';
        dom.start.style.display  = 'inline-block';
    };
    renderWorkoutStarted(dom) {
        // dom.workout.style.display = 'none';
    };
}

customElements.define('watch-control', Watch);

export { Watch };
