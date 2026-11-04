/*
 * ride-sync.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * documents the expected behavior of the application and prevents regressions during development.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { syncRecordedRides } from '../../src/server/ride-sync.js';
import { idb } from '../../src/storage/idb.js';

jest.mock('../../src/storage/idb.js', () => ({idb: {getAll: jest.fn(), putChecked: jest.fn()}}));

beforeEach(() => jest.clearAllMocks());

test('retries persisted pending recordings by stable identity and clears outbox only after a successful server write', async () => {
    const pending = {id: 'ride', pendingSync: true, ride: {id: 'ride', duration: 123}, coachingWorkoutId: 'session'};
    idb.getAll.mockResolvedValue([pending, {id: 'old', pendingSync: false}]);
    const service = {recordRide: jest.fn().mockResolvedValue(null)};
    expect(await syncRecordedRides(service)).toBe(1);
    expect(service.recordRide).toHaveBeenCalledWith(pending.ride, 'session');
    expect(idb.putChecked).toHaveBeenCalledWith('activity', {...pending, pendingSync: false, summary: {pendingSync: false}});
});

test('failed remote write leaves local outbox pending and surfaces the error', async () => {
    idb.getAll.mockResolvedValue([{pendingSync: true, ride: {id: 'ride'}}]);
    await expect(syncRecordedRides({recordRide: jest.fn().mockRejectedValue(new Error('Offline'))}))
        .rejects.toThrow('Offline');
    expect(idb.putChecked).not.toHaveBeenCalled();
});

test('failed local acknowledgement surfaces the failure so a later idempotent retry is possible', async () => {
    idb.getAll.mockResolvedValue([{pendingSync: true, ride: {id: 'ride'}}]);
    idb.putChecked.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(syncRecordedRides({recordRide: jest.fn().mockResolvedValue(null)})).rejects.toThrow('Quota exceeded');
});
