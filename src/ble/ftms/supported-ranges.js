/*
 * supported-ranges.js: front-end client module.
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
// 4.13 Supported Resistance Level Range (characteristic)
// 4.14 Supported Power Range (characteristic)
//

import { existance }  from '../../functions.js';

function supportedResistanceLevelRange(dataview) {
    // (0x) 00-00-E8-03-01-00
    let min = dataview.getUint16(0, dataview, true);
    let max = dataview.getUint16(2, dataview, true);
    let inc = dataview.getUint16(4, dataview, true);

    return { min, max, inc };
}

function PowerRange() {
    const length = 6;

    function encode(args = {}) {
        const min = existance(args.min);
        const max = existance(args.max);
        const inc = existance(args.inc);

        const buffer = new ArrayBuffer(length);
        const view   = new DataView(buffer);

        view.setUint16(0, min, true);
        view.setUint16(2, max, true);
        view.setUint16(4, inc, true);

        return view.buffer;
    }

    function decode(dataview) {
        // (0x) 00-00-20-03-01-00
        // (10) [0, 0, 32, 3, 1, 0]
        // 0, 800, 1
        const min = dataview.getUint16(0, dataview, true);
        const max = dataview.getUint16(2, dataview, true);
        const inc = dataview.getUint16(4, dataview, true);

        return { min, max, inc };
    }

    return Object.freeze({
        length,
        encode,
        decode
    });
}

function ResistanceRange() {
    const length = 6;

    function encode(args = {}) {
        const min = existance(args.min);
        const max = existance(args.max);
        const inc = existance(args.inc);

        const buffer = new ArrayBuffer(length);
        const view   = new DataView(buffer);

        view.setUint16(0, min, true);
        view.setUint16(2, max, true);
        view.setUint16(4, inc, true);

        return view.buffer;
    }

    function decode(dataview) {
        // (0x) 00-00-E8-03-01-00
        // (10) [0, 0, 232, 3, 1, 0]
        // 0, 1000, 1
        const min = dataview.getUint16(0, dataview, true);
        const max = dataview.getUint16(2, dataview, true);
        const inc = dataview.getUint16(4, dataview, true);

        return { min, max, inc };
    }

    return Object.freeze({
        length,
        encode,
        decode
    });
}

const supported = {
    powerRange:      PowerRange(),
    resistanceRange: ResistanceRange(),
};

export {
    supported
};
