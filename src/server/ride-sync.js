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
