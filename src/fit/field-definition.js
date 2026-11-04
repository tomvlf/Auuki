/*
 * field-definition.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * reads, writes, and validates FIT files so training data can be stored and exchanged reliably.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { profiles } from './profiles/profiles.js';

function FieldDefinition(args = {}) {
    const architecture = args.architecture ?? true;

    const length        = 3;
    const numberIndex   = (offset = 0) => offset+0;
    const sizeIndex     = (offset = 0) => offset+1;
    const baseTypeIndex = (offset = 0) => offset+2;

    // {number: Int, size: Int, base_type: BaseType}
    // DataView,
    // Int,
    // -> DataView
    function encode(definition, view, i = 0) {
        const base_type_number = profiles.BaseType[definition.base_type];
        view.setUint8(numberIndex(i),   definition.number, architecture);
        view.setUint8(sizeIndex(i),     definition.size,   architecture);
        view.setUint8(baseTypeIndex(i), base_type_number,  architecture);
        return view;
    }

    // String
    // DataView,
    // Int,
    // ->
    // {number: Int, size: Int, base_type: BaseType}
    function decode(messageName, view, i = 0) {
        const number           = view.getUint8(numberIndex(i),   architecture);
        const size             = view.getUint8(sizeIndex(i),     architecture);
        const base_type_number = view.getUint8(baseTypeIndex(i), architecture);
        const base_type        = profiles.BaseType[(base_type_number).toString()];

        return { number, size, base_type };
    }

    return Object.freeze({
        length,
        numberIndex,
        sizeIndex,
        baseTypeIndex,
        encode,
        decode,
    });
}

const fieldDefinition = FieldDefinition();

export {
    fieldDefinition,
};

