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
 * implements the ANT+ transport and message protocol used to communicate with trainers and sensors.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf, equals, exists, existance, dataviewToArray } from '../functions.js';
import { time } from '../utils.js';
import { events, keys } from './constants.js';
import { message } from './message.js';
import { fec } from './fec.js';
import { hr } from './hr.js';
import { Q } from './q.js';
import { driver } from './driver.js';

function profileToDeviceType(profile) {
    if(equals(profile, 'hrm')) return 120;
    if(equals(profile, 'fec')) return 17;
    return undefined;
}

function Device(args = {}) {
    const defaults = {
        profile: 'generic',
        name:    'ant:device',
        onData:  ((x) => x),
    };

    const name          = existance(args.name, defaults.name);

    const onData        = existance(args.onData, defaults.onData);
    const profile       = existance(args.profile, defaults.profile);
    const channelNumber = existance(args.channelNumber, defaults.channelNumber);
    const q             = Q();
    const deviceType    = profileToDeviceType(profile);

    let deviceNumber     = 0;
    let transmissionType = 0;
    let _connected = false;
    let _searching = false;
    let abortController;

    function start() {
        if(abortController) return;
        abortController = new AbortController();
        const options = {signal: abortController.signal};
        console.log(`:ant :${profile} :start`);
        xf.sub(`ui:${name}:switch`, onSwitch, options);
        xf.sub(`ant:search:pair`, onPair, options);
        xf.sub('ant:search:cancel', onCancelSearch, options);
        xf.sub(`ant:driver:${channelNumber}:rx`, onRx, options);
        xf.sub('ant:driver:error', onDriverError, options);
        xf.sub('ant:driver:closed', onDriverClosed, options);
    }

    function stop() {
        console.log(`:ant :${profile} :stop`);
        abortController?.abort();
        abortController = undefined;
        q.rejectAll();
        _connected = false;
        _searching = false;
    }

    async function onSwitch() {
        try {
            if(isConnected()) await disconnect();
            else if(_searching) await onCancelSearch();
            else await connect();
        } catch(error) {
            _connected = false;
            _searching = false;
            _searching = false;
            xf.dispatch(`${name}:disconnected`);
            xf.dispatch('ant:search:stopped');
            xf.dispatch('ui:modal:error:open', `ANT+ connection failed: ${error.message}`);
            console.error(`ANT+ ${profile} connection failed:`, error);
        }
    }

    async function onPair(channelId) {
        if(channelId && equals(channelId.deviceType, deviceType)) {
            try {
                await pair(channelId);
            } catch(error) {
                _connected = false;
                xf.dispatch(`${name}:disconnected`);
                xf.dispatch('ui:modal:error:open', `ANT+ pairing failed: ${error.message}`);
                console.error(`ANT+ ${profile} pairing failed:`, error);
            }
        }
    }

    async function onCancelSearch() {
        if(_connected || !_searching) return;
        _searching = false;
        try {
            await driver.runExclusive(() => write(message.closeChannel.encode({channelNumber})));
        } catch(error) {
            console.warn(`Unable to cancel ANT+ ${profile} search:`, error);
        }
        xf.dispatch('ant:search:stopped');
    }

    async function pair(channelId) {
        deviceNumber     = channelId.deviceNumber;
        transmissionType = channelId.transmissionType;
        await driver.runExclusive(track);
    }

    async function search() {
        const config = channelConfig.get({
            profile, channelNumber, status: 'searching'
        });

        xf.dispatch('ant:search:start');
        xf.dispatch(`${name}:connecting`);
        _searching = true;
        console.log(`:channel :${channelNumber} :search `, config);

        const commands = [
            message.unassignChannel.encode(config),
            message.setNetworkKey.encode(config),
            message.assignChannel.encode(config),
            message.setChannelId.encode(config),
            message.enableExtRxMessages.encode(config),
            message.lowPrioritySearchTimeout.encode(config),
            message.searchTimeout.encode(config),
            message.setChannelFrequency.encode(config),
            message.setChannelPeriod.encode(config),
            message.openChannel.encode(config),
        ];
        for(const command of commands) {
            if(!_searching) return;
            await write(command);
        }
    }

    async function track() {
        const config = channelConfig.get({
            profile,
            channelNumber,
            deviceNumber,
            transmissionType,
            status: 'tracking'
        });

        console.log(`:channel :${channelNumber} :track `, config);

        await write(message.closeChannel.encode(config)); // 76
        await write(message.unassignChannel.encode(config)); // 65
        await write(message.setNetworkKey.encode(config)); // 70
        await write(message.assignChannel.encode(config)); // 66
        await write(message.setChannelId.encode(config)); //81
        await write(message.setChannelFrequency.encode(config)); // 69
        await write(message.setChannelPeriod.encode(config)); // 67
        await write(message.openChannel.encode(config)); //75
        _connected = true;
        _searching = false;
        xf.dispatch('ant:search:stopped');
        xf.dispatch(`${name}:connected`);
    }

    async function close() {
        await write(message.closeChannel.encode({channelNumber}));
        _connected = false;
        _searching = false;
        xf.dispatch(`${name}:disconnected`);
        xf.dispatch('ant:search:stopped');
    }

    function isConnected() {
        return _connected;
    }

    async function connect() {
        await driver.open();
        await driver.runExclusive(search);
    }

    async function disconnect() {
        await driver.runExclusive(close);
        _connected = false;
    }

    function onRx(dataview) {
        if(dataview.byteLength < 4 || dataview.getUint8(0) !== 0xA4 ||
           dataview.byteLength !== dataview.getUint8(1) + 4) return;
        let decoded;

        if(message.isResponse(dataview)) {
            decoded = message.channelResponse.decode(dataview);
            onResponse(decoded);
        }
        if(message.isEvent(dataview)) {
            decoded = message.channelEvent.decode(dataview);
            onEvent(decoded);
        }
        if(message.isBroadcast(dataview)) {
            decoded = message.broadcastData.decode(dataview);
            if(!decoded.valid) return;

            if(exists(decoded.channelId)) {
                xf.dispatch('ant:search:found', decoded.channelId);
            }
            onData(decoded.payload);
        }
    }
    function onResponse(decoded) {
        q.pull(decoded);
    }
    function onEvent(decoded) {
        q.pull(decoded);
        if(equals(decoded.eventCode, events.event_channel_closed)) {
            _connected = false;
            xf.dispatch(`${name}:disconnected`);
        }
    }

    function onDriverError(error) {
        q.rejectAll(error instanceof Error ? error : new Error(String(error)));
    }

    function onDriverClosed() {
        q.rejectAll();
        _connected = false;
        _searching = false;
        xf.dispatch(`${name}:disconnected`);
        xf.dispatch('ant:search:stopped');
    }

    async function write(dataview) {
        console.log(`[${time()}] :ant :tx ${dataviewToArray(dataview)}`);
        const response = q.push(dataview);
        xf.dispatch('ant:driver:tx', dataview);
        return response;
    }

    return {
        q,
        start,
        stop,
        search,
        isConnected,
        connect,
        disconnect,
        write,
    };
}

function ChannelConfig() {
    const profiles = {
        hrm: {
            deviceType:    120,
            channelPeriod: 8070,
            rfFrequency:   57,
            networkKey:    keys.antPlus,
        },
        fec: {
            deviceType:    17,
            channelPeriod: 8192,
            rfFrequency:   57,
            networkKey:    keys.antPlus,
        },
    };

    const states = {
        searching: {
            enable:           1,
            extended:         0x01,
            searchTimeout:    0,
            lowSearchTimeout: 255,
        },
        tracking: {
            enable:           0,
            extended:         undefined,
            searchTimeout:    255, // 30,
            lowSearchTimeout: 2,
        },
    };

    function getProfile(value) {
        return profiles[value];
    }

    function getStatus(value) {
        return states[value];
    }

    function get(args = {}) {
        const status  = getStatus(args.status);
        const profile = getProfile(args.profile);
        return {
            channelNumber:    args.channelNumber,
            deviceNumber:     args.deviceNumber,
            channelType:      args.channelType || 0,
            transmissionType: args.transmissionType || 0,
            ...profile,
            ...status,
        };
    }

    return Object.freeze({
        get,
    });
}

const channelConfig = ChannelConfig();

function Controllable() {
    const name          = 'ant:controllable';
    const channelNumber = 1;
    const device        = Device({name, channelNumber, onData, profile: 'fec',});

    let _mode = 'erg';

    let abortController;

    function start() {
        if(abortController) return;
        abortController = new AbortController();
        const options = {signal: abortController.signal};
        device.start();
        console.log(':ant :controllable :start');
        xf.sub('db:mode', onMode, options);
        xf.sub('db:powerTarget', onPowerTarget, options);
        xf.sub('db:resistanceTarget', onResistanceTarget, options);
        xf.sub('db:slopeTarget', onSlopeTarget, options);
    }

    function stop() {
        abortController?.abort();
        abortController = undefined;
        device.stop();
    }

    function onMode(value) {
        _mode = value;
    }

    function onPowerTarget(power) {
        if(device.isConnected() && (equals(_mode, 'erg'))) {
            sendControl(setPowerTarget, power);
        }
    }

    function onResistanceTarget(resistance) {
        if(device.isConnected()) sendControl(setResistanceTarget, resistance);
    }

    function onSlopeTarget(power) {
        if(device.isConnected()) sendControl(setSlopeTarget, power);
    }

    async function sendControl(setTarget, value) {
        try {
            await driver.runExclusive(() => setTarget(value));
        } catch(error) {
            xf.dispatch('ui:modal:error:open', `ANT+ control failed: ${error.message}`);
            console.error('ANT+ control command failed:', error);
        }
    }

    function control(dataPage) {
        const view = message.acknowledgedData.encode({channelNumber, payload: dataPage});
        return device.write(view);
    }

    function setPowerTarget(power) {
        return control(fec.dataPage49.encode({power}));
    }

    function setResistanceTarget(resistance) {
        return control(fec.dataPage48.encode({resistance}));
    }

    function setSlopeTarget(grade) {
        return control(fec.dataPage51.encode({grade}));
    }

    function onData(payload) {
        const data = existance(fec.decode(payload), {});

        if(exists(data.power)) {
            xf.dispatch('power', data.power);
        }

        if(exists(data.cadence)) {
            xf.dispatch('cadence', data.cadence);
        }

        if(exists(data.speed)) {
            xf.dispatch('speed', data.speed);
        }
    }

    return Object.freeze({
        isConnected: device.isConnected,
        connect:     device.connect,
        disconnect:  device.disconnect,
        start,
        stop,
        setPowerTarget,
        setResistanceTarget,
        setSlopeTarget,
        onData,
    });
}

function Hrm() {
    // {deviceNumber: 49647, deviceType: 120, transmissionType: 161}

    const name          = 'ant:hrm';
    const channelNumber = 2;
    const device        = Device({name, channelNumber, onData, profile: 'hrm',});

    function start() {
        device.start();
    }

    function stop() {
        device.stop();
    }

    function onData(payload) {
        const data = existance(hr.decode(payload), {});

        if(exists(data.heartRate)) {
            xf.dispatch('heartRate', data.heartRate);
        };
    }

    return Object.freeze({
        isConnected: device.isConnected,
        connect:     device.connect,
        disconnect:  device.disconnect,
        start,
        stop,
        onData,
    });
}

// function Devices() {
//     let hrm;
//     let controllable;

//     xf.sub('ant:driver:ready', function() {
//         hrm = HRM();
//         controllable = Controllable();

//         hrm.start();
//         controllable.start();
//     });
// }

export { Device, Controllable, Hrm };
