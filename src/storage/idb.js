/*
 * idb.js: front-end client module.
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
// IDB
//

import { exists, existance, empty, } from '../functions.js';
import { uuid } from './uuid.js';

function promisify(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = function(event) {
            return resolve(request.result);
        };
        request.onerror = function(event) {
            return reject(request.error);
        };
    });
}

function IDB(args = {}) {
    let db;

    function setDB(idb) {
        db = idb;
    }

    async function start(database = '', version = 1, stores = []) {
        if(!exists(database)) {
            throw new Error(`:idb idb.start() needs database name!`);
        };
        if(empty(database)) {
            throw new Error(`:idb idb.start() called with empty name!`);
        };
        await open(database, version, stores);
    }

    function open(name, version, storeNames) {
        console.log(`:idb :open :db '${name}' :store-name '${storeNames}' ...`);
        let openReq = window.indexedDB.open(name, version);

        return new Promise((resolve, reject) => {
            openReq.onupgradeneeded = function(e) {
                setDB(openReq.result);
                console.log(`:idb :version ${db.version} :old ${e.oldVersion}`);

                switch(e.oldVersion) {
                // switch(db.version) {
                case 0: createStores(storeNames);
                case 1: update(storeNames);
                case 2: update(storeNames);
                case 3: latest(storeNames);
                }
            };
            openReq.onerror = function() {
                console.error(`:idb :error :open :db '${name}'`, openReq.error);
                return reject(openReq.error);
            };
            openReq.onsuccess = function() {
                setDB(openReq.result);
                console.log(`:idb :version ${db.version}`);
                return resolve(openReq.result);
            };
        });
    }

    function deleteStore(name) {
        let deleteReq = db.deleteObjectStore(name);

        return promisify(deleteReq).then(res => {
            console.log(`:idb :delete-store '${name}'`);
            return res;
        }).catch(err => {
            console.error(`:idb :error :delete-store '${name}'`, err);
            return {};
        });
    }

    function createStore(name, keyPath = 'id') {
        if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, {keyPath: keyPath});
            console.log(`:idb :create-store '${name}'`);
        } else {
            console.warn(`:idb :error :createStore 'trying to create store with existing name: ${name}'`);
        }
    }

    function createStores(storeNames, keyPaths = []) {
        storeNames.forEach((storeName, i) => {
            createStore(storeName, existance(keyPaths[i], 'id'));
        });
    }

    async function update(storeNames) {
        console.log(`:idb :update :stores ${storeNames}`);
        // create IndexedDB > db > session, workouts
        await createStores(storeNames);
    }

    function latest(storeNames) {
        console.log(`:idb :latest :stores ${storeNames}`);
    }

    function transaction(storeName, method, param = undefined, type = 'readonly') {
        if(!db.objectStoreNames.contains(storeName)) return undefined;

        let transaction = db.transaction(storeName, type);
        let store = transaction.objectStore(storeName);
        let req;

        if(param === undefined) {
            req = store[method]();
        } else {
            req = store[method](param);
        }

        return promisify(req).then(res => {
            console.log(`:idb :${method} :store '${storeName}' :success`);
            return res;
        }).catch(err => {
            console.error(`:idb :error :${method} :store '${storeName}'`, err);
            return [];
        });
    }

    function add(storeName, item) {
        return transaction(storeName, 'add', item, 'readwrite');
    }

    function put(storeName, item) {
        return transaction(storeName, 'put', item, 'readwrite');
    }

    function putChecked(storeName, item) {
        return putManyChecked([[storeName, item]]).then(() => item);
    }

    function putManyChecked(entries) {
        return new Promise((resolve, reject) => {
            const write = db.transaction([...new Set(entries.map(([name]) => name))], 'readwrite');
            write.oncomplete = () => resolve();
            write.onabort = () => reject(write.error || new Error('Unable to save device data.'));
            write.onerror = () => reject(write.error || new Error('Unable to save device data.'));
            try {
                for(const [name, item] of entries) write.objectStore(name).put(item);
            } catch(error) {
                write.abort();
                reject(error);
            }
        });
    }

    function get(storeName, key) {
        return transaction(storeName, 'get', key, 'readonly');
    }

    function getAll(storeName) {
        return transaction(storeName, 'getAll', undefined, 'readonly');
    }

    function remove(storeName, id) {
        return transaction(storeName, 'delete', id, 'readwrite');
    }

    function clear(storeName) {
        return transaction(storeName, 'clear', undefined, 'readwrite');
    }

    function setId(item, id = undefined) {
        if(!exists(item.id)) {
            if(!exists(id)) {
                id = uuid();
            };
            item.id = id;
            console.log(`:idb :setId`, id);
        }
        return item;
    }

    return Object.freeze({
        start,
        open,
        createStore,
        deleteStore,
        add,
        put,
        putManyChecked,
        putChecked,
        get,
        getAll,
        remove,
        clear,
        setId,
    });
}

const idb = IDB();

export { idb };
