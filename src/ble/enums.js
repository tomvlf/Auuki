/*
 * enums.js: front-end client module.
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

const Status = {
    disconnected: "disconnected",
    connected: "connected",
    connecting: "connecting",
    disconnecting: "disconnecting",
};

const Device = {
    controllable: 'controllable',
    speedCadenceSensor: 'speedCadenceSensor',
    powerMeter: 'powerMeter',
    heartRateMonitor: 'heartRateMonitor',
    raceController: 'raceController',
    smo2: 'smo2',
    coreTemp: 'coreTemp',
    openBikeControl: 'openBikeControl',
    generic: 'generic',
};

const Metric = {
    power: 'power',
    cadence: 'cadence',
    heartRate: 'heartRate',
    smo2: 'smo2',
    thb: 'thb',
    coreBodyTemperature: 'coreBodyTemperature',
    skinTemperature: 'skinTemperature',
};

const Responsibility = {
    controllable: [Metric.power, Metric.cadence, Metric.heartRate],
    powerMeter: [Metric.power, Metric.cadence],
    speedCadenceSensor: [Metric.cadence],
    heartRateMonitor: [Metric.heartRate, Metric.cadence],
    smo2: [Metric.smo2, Metric.thb],
};

const Priority = {
    power: [
        Device.powerMeter,
        Device.controllable,
    ],
    cadence: [
        Device.speedCadenceSensor,
        Device.powerMeter,
        Device.controllable,
        Device.heartRateMonitor,
    ],
    heartRate: [
        Device.heartRateMonitor,
        Device.controllable,
    ],
    smo2: [
        Device.smo2,
    ],
    coreTemp: [
        Device.coreTemp,
    ]
};

const ControlMode = {
    erg: 'erg',
    sim: 'sim',
    resistance: 'resistance',
    virtualGear: 'virtualGear',
};

export {
    Status,
    Device,
    Metric,
    Responsibility,
    Priority,
    ControlMode,
};

