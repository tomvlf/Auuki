/*
 * driver.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * implements the ANT+ transport and message protocol used to communicate with trainers and sensors.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf } from '../functions.js';
import { SerialDriver, SerialPolyfillDriver } from './web-serial.js';

let _driver;
let _abortController;
let _opening;
let _operation = Promise.resolve();
let _started = false;

function setup() {
    if(navigator.serial?.requestPort) {
        _driver = SerialDriver({
            onData: onRx,
            onClose: () => xf.dispatch('ant:driver:closed'),
        });
        return {available: true, driver: 'web-serial'};
    }
    if(navigator.usb?.requestDevice) {
        _driver = SerialPolyfillDriver({
            onData: onRx,
            onClose: () => xf.dispatch('ant:driver:closed'),
        });
        return {available: true, driver: 'web-usb'};
    }
    _driver = undefined;
    return {available: false};
}

function start() {
    if(_started) return;
    _abortController = new AbortController();
    const options = {signal: _abortController.signal};
    xf.sub('ui:ant:driver:switch', onSwitch, options);
    xf.sub('ant:driver:tx', onTx, options);
    _started = true;
}

function stop() {
    _abortController?.abort();
    _started = false;
    return close();
}

function runExclusive(operation) {
    const result = _operation.then(operation);
    _operation = result.catch(() => {});
    return result;
}

function init() {
    const result = setup();
    const antControllable = document.querySelector('#ant-controllable-settings');
    const antHrm = document.querySelector('#ant-hrm-settings');

    [antControllable, antHrm].filter(Boolean).forEach(element => {
        element.classList.toggle('ant-not-supported', !result.available);
    });

    if(result.available) {
        start();
        xf.dispatch('ant:driver:enable', result.driver);
    } else {
        xf.dispatch('ant:driver:disable');
    }
    return result;
}

async function open() {
    if(!_driver) {
        const result = setup();
        if(!result.available) throw new Error('ANT+ is not supported by this browser.');
    }
    if(_driver.isOpen()) return;
    if(_opening) return _opening;

    xf.dispatch('ant:driver:connecting');
    _opening = _driver.open(onOpen)
        .catch(error => {
            xf.dispatch('ant:driver:error', error);
            xf.dispatch('ant:driver:closed');
            throw error;
        })
        .finally(() => {
            _opening = undefined;
        });
    return _opening;
}

async function close() {
    if(_driver?.isOpen()) await _driver.close();
    else xf.dispatch('ant:driver:closed');
}

async function onSwitch() {
    try {
        if(_driver?.isOpen()) await close();
        else await open();
    } catch(error) {
        console.error('Unable to connect ANT+ adapter:', error);
    }
}

function onOpen() {
    xf.dispatch('ant:driver:ready');
    xf.dispatch('ant:driver:connected');
}

function onRx(data) {
    if(!data || data.length < 4 || data[0] !== 0xA4 ||
       data.length !== data[1] + 4) {
        console.warn('Ignoring malformed ANT+ message.', data);
        return;
    }
    const channel = data[3] & 0x1F;
    channelDispatch(channel, data);
}

function channelDispatch(channel, data) {
    const bytes = Uint8Array.from(data);
    if(channel === 0) {
        for(let channelNumber = 0; channelNumber < 8; channelNumber++) {
            xf.dispatch(`ant:driver:${channelNumber}:rx`, new DataView(bytes.slice().buffer));
        }
    } else {
        xf.dispatch(`ant:driver:${channel}:rx`, new DataView(bytes.buffer));
    }
}

async function onTx(dataview) {
    try {
        if(!_driver?.isOpen()) throw new Error('ANT+ adapter is not open.');
        await _driver.write(dataview);
    } catch(error) {
        xf.dispatch('ant:driver:error', error);
        console.error('Unable to write to ANT+ adapter:', error);
    }
}

const driver = Object.freeze({init, start, stop, open, close, runExclusive});

export {driver};
