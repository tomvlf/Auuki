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
 * defines the data structures and API contracts used by the app when storing and exchanging rider data.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { uuid } from '../storage/uuid.js';

const DialogMsg = {
    noAuth: ':no-auth',
};

const OAuthService = {
    strava: 'strava',
    intervals: 'intervals',
    trainingPeaks: 'trainingPeaks',
};

function StateParam() {
    function encode(name) {
        const param = name+'_'+uuid();
        return param;
    }
    function decode(param) {
        const parts = param.split('_');

        return {
            service: parts[0] ?? '',
            id: parts[1] ?? '',
        };
    }

    function store() {
    }

    function restore() {
    }

    return Object.freeze({
        encode,
        decode,
        store,
        restore,
    });
}

const stateParam = StateParam();

export {
    OAuthService,
    DialogMsg,
    StateParam,
    stateParam,
}

