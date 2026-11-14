/*
 * ride-sync.js: updates local coaching from persisted recordings.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { idb } from '../storage/idb.js';

export async function syncRecordedRides(service) {
    const records = await idb.getAll('activity');
    let synced = 0;
    for(const record of records) {
        if(!record.pendingSync || !record.ride) continue;
        await service.recordRide(record.ride, record.coachingWorkoutId);
        await idb.putChecked('activity', {...record, pendingSync: false,
            summary: {...record.summary, pendingSync: false}});
        synced++;
    }
    return synced;
}
