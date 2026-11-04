/*
 * virtual-gear-shifting.js: front-end client module.
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
// OpenBikeControl
// Virtual Gear Shifting
//
// A gear report is one button id plus one state byte.
// Digital paddles use 0x00 (released) and 0x01 (pressed).
// A direct gear pick uses 0x02 for gear 1, 0x03 for gear 2, and so on.
// 0x01 on a gear pick is a no-op, so it is not confused with "pressed".

import { equals } from '../../functions.js';

const virtualGearShiftingButtonIds = [
    0x01, // shiftUp
    0x02, // shiftDown
    0x03, // gearSet
    0x04, // chainringSet
    0x05, // cassetteSet
];

const digitalActions = {
    0x01: 'shiftUp',
    0x02: 'shiftDown',
};

const gearActions = {
    0x03: 'gearSet',
    0x04: 'chainringSet',
    0x05: 'cassetteSet',
};

function VirtualGearShifting() {

    // {id, state} -> Message?
    function decodePair(pair) {
        const id = pair.id;
        const state = pair.state;

        if(id in digitalActions) {
            if(equals(state, 0x00)) {
                return {id, action: digitalActions[id], kind: 'digital', state: 'released'};
            }
            if(equals(state, 0x01)) {
                return {id, action: digitalActions[id], kind: 'digital', state: 'pressed'};
            }
            return;
        }

        if(id in gearActions) {
            const action = gearActions[id];
            if(equals(state, 0x00)) {
                return {id, action, kind: 'gear', state: 'released'};
            }
            if(equals(state, 0x01)) {
                return {id, action, kind: 'gear', state: 'noop'};
            }
            return {id, action, kind: 'gear', state: 'value', value: state - 1};
        }

        return;
    }

    // [{id, state}] -> [Message]
    function decode(pairs = []) {
        const messages = [];

        for(let i = 0; i < pairs.length; i++) {
            const message = decodePair(pairs[i]);
            if(message) messages.push(message);
        }

        return messages;
    }

    return Object.freeze({
        decode,
        decodePair,
    });
}

const virtualGearShifting = VirtualGearShifting();

export {
    VirtualGearShifting,
    virtualGearShifting,
    virtualGearShiftingButtonIds,
};
