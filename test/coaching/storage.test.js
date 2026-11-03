import { IDBFactory } from 'fake-indexeddb';
import { openCoachingStorage } from '../../src/coaching/storage.js';
import { CoachingService } from '../../src/coaching/service.js';
import { profile, goal } from './fixtures.js';

describe('durable coaching IndexedDB storage', () => {
    test('commits before resolving and restores the same bundle after reopening', async () => {
        const idb = new IDBFactory();
        const storage = await openCoachingStorage(idb);
        const service = new CoachingService(storage);
        await service.configure(profile, goal);
        storage.close();
        const reopened = await openCoachingStorage(idb);
        expect(new CoachingService(reopened).data).toEqual(service.data);
        reopened.close();
    });
    test('does not silently overwrite changes from another tab', async () => {
        const idb = new IDBFactory();
        const one = await openCoachingStorage(idb), two = await openCoachingStorage(idb);
        const first = new CoachingService(one), second = new CoachingService(two);
        await first.configure(profile, goal);
        await expect(second.configure(profile, goal)).rejects.toThrow(/another tab/);
        expect(second.data.profile).toBeNull();
        one.close(); two.close();
    });
});
