/*
 * bas.js: front-end client module.
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
// Battery Service
//

import { expect, exists, dataviewToArray, } from '../../functions.js';
import { uuids, } from '../web-ble.js';
import { Service } from '../service.js';
import { Characteristic } from '../characteristic.js';
import { batteryLevel as batteryLevelParser } from './battery-level.js';

function BAS(args = {}) {

    // config
    const onData = args.onData;
    // const onRead = args.onRead;

    // BluetoothRemoteGATTService{
    //     device: BluetoothDevice,
    //     uuid: String,
    //     isPrimary: Bool,
    // }
    const gattService = expect(
        args.service, 'BAS needs BluetoothRemoteGATTService!'
    );
    // end config

    // service
    const spec = {
        measurement: {
            uuid: uuids.batteryLevel,
            // read: {callback: onData, parser: batteryLevelParser},
            notify: {callback: onData, parser: batteryLevelParser},
        },
    };

    const service = Service({spec, service: gattService,});
    // end service

    async function readBatteryLevel() {
        const measurement = service.characteristics.measurement;

        if(!exists(measurement)) return false;

        const res = await measurement.read();
        return res;
    }

    return Object.freeze({
        ...service, // BAS will have all the public methods and properties of Service
        readBatteryLevel,
    });
}

export default BAS;
