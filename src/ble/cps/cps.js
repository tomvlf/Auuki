/*
 * cps.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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
// Cycling Power Service
//

import { expect } from '../../functions.js';
import { uuids, } from '../web-ble.js';
import { Service } from '../service.js';
import { Characteristic } from '../characteristic.js';
import { cyclingPowerMeasurement as cyclingPowerMeasurementParser } from './cycling-power-measurement.js';

function CPS(args = {}) {
    // config
    // BluetoothRemoteGATTService{
    //     device: BluetoothDevice,
    //     uuid: String,
    //     isPrimary: Bool,
    // }
    const gattService = expect(
        args.service, 'CPS needs BluetoothRemoteGATTService!'
    );

    // {} -> Void
    const onData = args.onData;
    // end config

    // Service
    const spec = {
        measurement: {
            uuid: uuids.cyclingPowerMeasurement,
            notify: {callback: onData, parser: cyclingPowerMeasurementParser},
        },
    };
    const service = Service({service: gattService, spec,});

    return Object.freeze({
        ...service, // CPS will have all the public methods and properties of Service
    });
}

export default CPS;
