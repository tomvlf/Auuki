/*
 * local-storage.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * persists user and application data in the browser so settings and workouts survive reloads.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

//
// LocalStorageItem
//

import { equals, exists, existance } from '../functions.js';
import { accountStorage } from './account.js';

function LocalStorageItem(args = {}) {
    const defaults = {
        fallback: '',
        isValid:  function (v) { return exists(v); },
        parse:    function(str) { return str; },
        encode:   function(str) { return str; },
    };

    let key      = args.key;
    let fallback = existance(args.fallback, defaults.fallback);
    let isValid  = existance(args.isValid, defaults.isValid);
    let parse    = existance(args.parse, defaults.parse);
    let encode   = existance(args.encode, defaults.encode);

    if(!exists(key)) throw new Error('LocalStorageItem needs a key!');

    function restore() {
        const inStorageValue = get();

        if(equals(inStorageValue, fallback)) {
            set(fallback);
        }

        return get();
    }

    function get() {
        const value = accountStorage.getItem(`${key}`);

        if(!exists(value)) {
            console.warn(`Trying to get non-existing value from Local Storage at key ${key}!`);
            return fallback;
        }

        return parse(value);
    }

    function set(value) {
        if(isValid(value)) {
            accountStorage.setItem(`${key}`, encode(value));
            return value;
        } else {
            console.warn(`Trying to enter invalid ${key} value in Local Storage: ${typeof value}`, value);
            accountStorage.setItem(`${key}`, fallback);
            return fallback;
        }
    }

    function remove() {
        accountStorage.removeItem(`${key}`);
    }

    return Object.freeze({
        restore,
        get,
        set,
        remove,
    });
}

export { LocalStorageItem };
