/*
 * fit.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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

//
// FITjs
//

import { CRC } from './crc.js';
import { fileHeader } from './file-header.js';
import { recordHeader } from './record-header.js';
import { fieldDefinition } from './field-definition.js';
import { definitionRecord } from './definition-record.js';
import { dataRecord } from './data-record.js';
import { profiles } from './profiles/profiles.js';
import { fitRecord, FITjs } from './fitjs.js';

import { localActivity } from './local-activity.js';
import { localCourse } from './local-course.js';

function FIT(args = {}) {

    return {
        fileHeader,
        recordHeader,
        definitionRecord,
        dataRecord,
        fieldDefinition,
        CRC,
        profiles,
        fitRecord,
        FITjs,

        // remove those from the general library
        localActivity,
        localCourse,
    };
}

const fit = FIT();

export {
    FIT,
    fit,
};

