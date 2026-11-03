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
    expect(idb.putChecked).toHaveBeenCalledWith('activity', {...pending, pendingSync: false});
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
