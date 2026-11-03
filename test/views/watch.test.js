/**
 * @jest-environment jsdom
 */

import { xf } from '../../src/functions.js';
import { Watch } from '../../src/views/watch.js';

describe('Watch View', () => {
    let watch;

    beforeEach(() => {
        watch = new Watch();
        watch.innerHTML = `
            <button id="watch-start">Start</button>
            <button id="watch-pause">Pause</button>
            <button id="watch-back">Back</button>
            <button id="watch-lap">Lap</button>
            <button id="watch-stop">Stop</button>
            <button id="activity-save">Save</button>`;
        document.body.append(watch);
    });

    afterEach(() => {
        watch.remove();
        jest.restoreAllMocks();
    });

    test('initializes with pause, stop, save, lap and back hidden', () => {
        for(const key of ['pause', 'stop', 'save', 'lap', 'back']) {
            expect(watch.dom[key].style.display).toBe('none');
        }
    });

    test('renders started, paused and stopped states', () => {
        xf.dispatch('db:watchStatus', {watchStatus: 'started'});
        expect(watch.dom.start.style.display).toBe('none');
        expect(watch.dom.pause.style.display).toBe('inline-block');
        expect(watch.dom.lap.style.display).toBe('inline-block');

        xf.dispatch('db:watchStatus', {watchStatus: 'paused'});
        expect(watch.dom.pause.style.display).toBe('none');
        expect(watch.dom.start.style.display).toBe('inline-block');
        expect(watch.dom.stop.style.display).toBe('inline-block');

        xf.dispatch('db:watchStatus', {watchStatus: 'stopped'});
        expect(watch.dom.stop.style.display).toBe('none');
        expect(watch.dom.save.style.display).toBe('inline-block');
    });

    test.each([
        ['pause', 'ui:watchPause'],
        ['back', 'ui:watchBack'],
        ['lap', 'ui:watchLap'],
        ['stop', 'ui:watchStop'],
        ['save', 'ui:activity:save'],
    ])('%s dispatches its action', (key, action) => {
        const handler = jest.fn();
        const subscription = xf.sub(action, handler);
        watch.dom[key].dispatchEvent(new Event('pointerup'));
        expect(handler).toHaveBeenCalledTimes(1);
        xf.unsub(action, subscription);
    });

    test('start dispatches both watch and workout actions', () => {
        const watchHandler = jest.fn();
        const workoutHandler = jest.fn();
        const watchSubscription = xf.sub('ui:watchStart', watchHandler);
        const workoutSubscription = xf.sub('ui:workoutStart', workoutHandler);
        watch.dom.start.dispatchEvent(new Event('pointerup'));
        expect(watchHandler).toHaveBeenCalledTimes(1);
        expect(workoutHandler).toHaveBeenCalledTimes(1);
        xf.unsub('ui:watchStart', watchSubscription);
        xf.unsub('ui:workoutStart', workoutSubscription);
    });
});
