/*
 * battery-level.js: front-end client module.
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

//
// Battery Service Spec
// Battery Level (characteristic)
//

import { dataviewToArray, } from '../../functions.js';

function BatteryLevel() {

    function decode(dataview) {
        const batteryLevel = dataview.getUint8(0, true); // 0-100, %

        return {
            batteryLevel,
        };
    }

    return Object.freeze({
        decode,
    });
}

const batteryLevel = BatteryLevel();

export {
    batteryLevel
}

