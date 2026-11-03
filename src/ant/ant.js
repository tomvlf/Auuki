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
