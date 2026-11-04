/*
 * q.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * implements the ANT+ transport and message protocol used to communicate with trainers and sensors.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { events, ids } from './constants.js';

function Q({timeout = 2000} = {}) {
    const pending = new Map();

    function push(dataview) {
        const id = dataview.getUint8(2, true);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                remove(id, entry);
                reject(new Error(`ANT+ message ${id} timed out.`));
            }, timeout);
            const entry = {resolve, reject, timer};
            const queue = pending.get(id) ?? [];
            queue.push(entry);
            pending.set(id, queue);
        });
    }

    function pull(decoded) {
        let id = decoded.initMsgId;
        if(decoded.eventCode !== undefined) {
            if(decoded.eventCode === events.event_channel_closed) {
                id = ids.closeChannel;
            } else if(decoded.eventCode === events.event_transfer_tx_completed ||
                      decoded.eventCode === events.event_transfer_tx_failed) {
                id = ids.acknowledgedData;
            } else {
                return;
            }
        }

        const entry = pending.get(id)?.[0];
        if(!entry) return;

        if(decoded.valid === false ||
           decoded.eventCode === events.event_transfer_tx_failed ||
           (decoded.responseCode !== undefined &&
            decoded.responseCode !== events.response_no_error)) {
            finish(id, entry, new Error(`ANT+ message ${id} was rejected.`));
            return;
        }
        if(decoded.eventCode === events.event_transfer_tx_completed ||
           decoded.eventCode === events.event_channel_closed ||
           decoded.responseCode === events.response_no_error) {
            finish(id, entry, undefined, decoded);
        }
    }

    function remove(id, entry) {
        const queue = pending.get(id);
        if(!queue) return;
        const index = queue.indexOf(entry);
        if(index !== -1) queue.splice(index, 1);
        if(queue.length === 0) pending.delete(id);
    }

    function finish(id, entry, error, value) {
        clearTimeout(entry.timer);
        remove(id, entry);
        if(error) entry.reject(error);
        else entry.resolve(value);
    }

    function rejectAll(error = new Error('ANT+ driver closed.')) {
        for(const [id, queue] of pending) {
            for(const entry of queue) finish(id, entry, error);
        }
    }

    return Object.freeze({push, pull, rejectAll});
}

export { Q };
