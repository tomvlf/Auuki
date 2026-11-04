/*
 * activity.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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

/** @jest-environment jsdom */
import { models } from '../../src/models/models.js';
import { idb } from '../../src/storage/idb.js';

jest.mock('../../src/storage/idb.js', () => ({idb: {
    remove: jest.fn(), getAll: jest.fn(), put: jest.fn(), putManyChecked: jest.fn(),
}}));
beforeEach(() => {
    jest.clearAllMocks();
    models.activity.pendingRecording = null;
});
afterEach(() => jest.restoreAllMocks());

test('recording cache evicts completed rides, never recordings awaiting server acknowledgement', () => {
    const pending = Array.from({length: 8}, (_, id) => ({id: `pending-${id}`, pendingSync: true}));
    const list = [...pending, {id: 'completed', pendingSync: false}];
    models.activity.add({id: 'new', pendingSync: true}, list);
    expect(list).toHaveLength(9);
    expect(list.every(activity => activity.pendingSync)).toBe(true);
    expect(idb.remove).toHaveBeenCalledTimes(1);
    expect(idb.remove).toHaveBeenCalledWith('activity', 'completed');
});

test('pending recordings count toward cache capacity without being evicted', () => {
    const list = [{id: 'pending', pendingSync: true},
        ...Array.from({length: 6}, (_, id) => ({id: `completed-${id}`}))];
    models.activity.add({id: 'new', pendingSync: true}, list);
    expect(list).toHaveLength(7);
    expect(list.some(activity => activity.id === 'pending')).toBe(true);
    expect(idb.remove).toHaveBeenCalledWith('activity', 'completed-5');
});

test('restoring local activity summaries preserves durable outbox status', async () => {
    idb.getAll.mockResolvedValue([
        {id: 'pending', pendingSync: true, summary: {id: 'pending', timestamp: 2, status: {}}},
        {id: 'synced', pendingSync: false, summary: {id: 'synced', timestamp: 1, status: {}}},
    ]);
    expect(await models.activity.restore()).toEqual([
        expect.objectContaining({id: 'pending', pendingSync: true}),
        expect.objectContaining({id: 'synced', pendingSync: false}),
    ]);
});

test('sensor connection state is attached to each sample without discarding real zero readings', () => {
    const db = {watchStatus: 'started', elapsed: 0, sources: {
        power: 'ble:controllable', heartRate: 'ble:heartRateMonitor', virtualState: 'speed'},
    connectedDevices: {'ble:controllable': true}, power1s: 0, heartRate: 0,
    records: [], lap: [], rrInterval: []};
    models.session.elapsed(1, db);
    expect(db.records[0]).toMatchObject({power: 0, powerValid: true, heartRateValid: false});
    db.connectedDevices['ble:controllable'] = false;
    models.session.elapsed(2, db);
    expect(db.records[1].powerValid).toBe(false);
});

test('local write failure retains the complete recording and retries the same identity after clocks reset', async () => {
    jest.spyOn(models.activity, 'encode').mockReturnValue(new Uint8Array([1, 2, 3]));
    idb.putManyChecked.mockRejectedValueOnce(new Error('Quota exceeded'));
    const db = {activity: [], elapsed: 60, records: [], ftp: 250,
        workout: {meta: {name: 'Preserved ride'}}};
    await expect(models.activity.createFromCurrent(db)).rejects.toThrow('Quota exceeded');
    const retained = models.activity.pendingRecording;
    expect(retained.ride.duration).toBe(60);
    expect(retained.blob).toBeInstanceOf(Blob);
    expect(db.activity).toEqual([]);
    db.elapsed = 0;
    idb.putManyChecked.mockResolvedValueOnce();
    const saved = await models.activity.retrySave(db);
    expect(saved).toBe(retained);
    expect(saved.summary.pendingSync).toBe(true);
    expect(saved.summary.duration).toBe(60);
    expect(models.activity.pendingRecording).toBeNull();
    expect(db.activity).toEqual([saved.summary]);
    expect(idb.putManyChecked.mock.calls[0][0][0][1].id).toBe(idb.putManyChecked.mock.calls[1][0][0][1].id);
    expect(idb.putManyChecked).toHaveBeenLastCalledWith([
        ['activity', retained], ['session', {id: 0, elapsed: 0}],
    ]);
});
