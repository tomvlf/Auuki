/*
 * ant.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
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
import { Controllable, Hrm } from './devices.js';
import { driver } from './driver.js';

const devices = [Controllable(), Hrm()];
let started = false;

function start() {
    if(started) return;
    started = true;
    driver.init();
    devices.forEach(device => device.start());
}

async function stop() {
    if(!started) return;
    started = false;
    devices.forEach(device => device.stop());
    await driver.stop();
}

xf.sub('app:start', start);
xf.sub('app:stop', stop);
