/*
 * devices.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * implements Bluetooth Low Energy device handling, services, and characteristic decoding for sensors and trainers.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { print, } from '../functions.js';
import ReactiveConnectable from './reactive-connectable.js';
import { webBle, } from './web-ble.js';
import { Device, } from './enums.js';

const controllable = ReactiveConnectable({
    deviceType: Device.controllable,
    filter: webBle.filters.controllable(),
});

const speedCadenceSensor = ReactiveConnectable({
    deviceType: Device.speedCadenceSensor,
    filter: webBle.filters.speedCadenceSensor(),
});

const heartRateMonitor = ReactiveConnectable({
    deviceType: Device.heartRateMonitor,
    filter: webBle.filters.heartRateMonitor(),
});

const powerMeter = ReactiveConnectable({
    deviceType: Device.powerMeter,
    filter: webBle.filters.powerMeter(),
});

const moxy = ReactiveConnectable({
    deviceType: Device.smo2,
    filter: webBle.filters.smo2(),
});

const coreTemp = ReactiveConnectable({
    deviceType: Device.coreTemp,
    filter: webBle.filters.coreTemp(),
});

const openBikeControl = ReactiveConnectable({
    deviceType: Device.openBikeControl,
    filter: webBle.filters.openBikeControl(),
});

// export {
//     controllabe,
//     heartRateMonitor,
//     powerMeter,
//     speedCadenceSensor,
// };

