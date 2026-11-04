/*
 * ftms.js: front-end client module.
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
// Fitness Machine Service
//

import { exists, expect, wait, } from '../../functions.js';
import { uuids, } from '../web-ble.js';
import { ControlMode, } from '../enums.js';
import { Service } from '../service.js';
import { Characteristic } from '../characteristic.js';
import { indoorBikeData as indoorBikeDataParser } from './indoor-bike-data.js';
import { control as controlParser } from './control-point.js';

function FTMS(args = {}) {

    // config
    const onData = args.onData;

    // BluetoothRemoteGATTService{
    //     device: BluetoothDevice,
    //     uuid: String,
    //     isPrimary: Bool,
    // }
    const gattService = expect(
        args.service, 'FTMS needs BluetoothRemoteGATTService!'
    );
    // end config

    // Service
    function onControlResponse(msg) {
        const control = service.characteristics.control;
        // it's important to release the control characteristic for writes
        // but that can happen only when a response has been received from
        // the control point characteristic
        control.release();
    }

    async function protocol() {
        const control = service.characteristics.control;

        if(exists(control)) {
            const res = await control.write(
                controlParser.requestControl.encode()
            );
            return res;
        }

        return false;
    }

    async function reset() {
        const control = service.characteristics.control;

        if(exists(control)) {
            let res = await control.write(controlParser.reset.encode());
            await wait(1000);
            return res;
        }
        return false;
    }

    const spec = {
        measurement: {
            uuid: uuids.indoorBikeData,
            notify: {callback: onData, parser: indoorBikeDataParser},
        },
        control: {
            uuid: uuids.fitnessMachineControlPoint,
            notify: {callback: onControlResponse, parser: controlParser.response},
        },
    };

    const service = Service({service: gattService, spec, protocol, });
    // end sevice

    // methods
    // this service has special write methods

    // {WindSpeed: Float, Grade: Float, Crr: Float, WindResistance: Float} -> Bool
    async function setSimulation(args = {}) {
        const control = service.characteristics.control;

        if(!exists(control) || !control.isReady()) return false;

        control.block();

        const res = await control.write(
            controlParser.simulationParameters.encode(args)
        );

        return res;
    }

    // {power: Int} -> Bool
    async function setPowerTarget(args = {}) {
        const control = service.characteristics.control;

        if(!exists(control)) return false;

        const res = await control.writeWithRetry(
            controlParser.powerTarget.encode(args),
            4, 500,
        );
        return res;
    }

    // {power: Int} -> Bool
    async function setResistanceTarget(args = {}) {
        const control = service.characteristics.control;

        if(!exists(control)) return false;

        const res = await control.writeWithRetry(
            controlParser.resistanceTarget.encode(args),
            4, 500,
        );
        return res;
    }
    // end methods

    // expose public methods and properties
    return Object.freeze({
        ...service, // FTMS will have all the public methods and properties of Service
        protocol,
        reset,
        setSimulation,
        setPowerTarget,
        setResistanceTarget,
    });
}

export default FTMS;
