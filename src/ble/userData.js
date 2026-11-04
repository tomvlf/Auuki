/*
 * userData.js: front-end client module.
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

import { isNumber } from '../functions.js';

function UserData(args = {}) {
    const defaults = {
        userWeight: 75,
        bikeWeight: 8,
    };

    let _userWeight = args.userWeight ?? defaults.userWeight;
    let _bikeWeight = args.bikeWeight ?? defaults.bikeWeight;

    function userWeight() {
        return _userWeight;
    }

    function bikeWeight() {
        return _bikeWeight;
    }

    // x: Int
    // weight in grams 75000 -> 75 kg
    function setUserWeight(x) {
        if(isNumber(x)) {
            _userWeight = x / 1000;
        } else {
            throw 'invalid userWeight';
        }
    }

    // x: Int
    // weight in grams 8000 -> 8 kg
    function setBikeWeight(x) {
        if(isNumber(x)) {
            _bikeWeight = x / 1000;
        } else {
            throw 'invalid bikeWeight';
        }
    }

    return {
        userWeight,
        bikeWeight,
        setUserWeight,
    };
}

const userData = UserData();

export {
    UserData,
    userData,
};

