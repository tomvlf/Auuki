/*
 * heart-rate-measurement.js: front-end client module.
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
// Heart Rate Spec
// Heart Rate Measurement characteristic
//

function HeartRateMeasurement(args = {}) {
    const rrIntervalResolution = 1024;

    function decode(dataview) {
        const flags = dataview.getUint8(0, true);
        const heartRateValueFormat    = ((flags >> 0) & 1) === 1;
        const sensorContactStatus     = ((flags >> 1) & 1) === 1;
        const sensorContactSupported  = ((flags >> 2) & 1) === 1;
        const energyExpenditureStatus = ((flags >> 3) & 1) === 1;
        const rrIntervalPresent       = ((flags >> 4) & 1) === 1;

        let i = 1;
        let heartRate = 0;
        let energyExpenditure;
        let rrInterval;

        if(heartRateValueFormat) {
            heartRate = dataview.getUint16(i, true);
            i += 2;
        } else {
            heartRate = dataview.getUint8(i, true);
            i += 1;
        }

        if(energyExpenditureStatus) {
            energyExpenditure = dataview.getUint16(i, true);
            i += 2;
        }

        if(rrIntervalPresent) {
            rrInterval = [];
            while(i <= dataview.byteLength - 2) {
                rrInterval.push(
                    dataview.getUint16(i, true) / rrIntervalResolution
                );
                i += 2;
            }
        }

        return {
            sensorContactSupported, // Bool
            sensorContactStatus, // Bool
            heartRate, // Int
            energyExpenditure, // Int?
            rrInterval, // [Float]?
        };
    }

    return Object.freeze({
        rrIntervalResolution,
        decode,
    });
}

const heartRateMeasurement = HeartRateMeasurement();

export {
    HeartRateMeasurement,
    heartRateMeasurement
};

