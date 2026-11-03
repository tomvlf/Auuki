/** @jest-environment jsdom */
import intervals from '../../src/models/intervals.js';
import { serverRequest } from '../../src/server/client.js';
import { xf } from '../../src/functions.js';

jest.mock('../../src/server/client.js', () => ({serverRequest: jest.fn()}));

beforeEach(() => jest.clearAllMocks());

test('legacy connect opens account integration settings rather than an OAuth redirect', () => {
    intervals.connect();
    expect(window.location.hash).toBe('#/settings');
    expect(serverRequest).not.toHaveBeenCalled();
    expect(intervals.paramsHandler).toBeUndefined();
});

test('planned workouts use same-origin API-key proxy with dates and no credentials in URL', async () => {
    serverRequest.mockResolvedValue([{id: 1, workout_file_base64: 'ZWO'}, {id: 2}]);
    expect(await intervals.wod('2026-03-01', '2026-03-31')).toHaveLength(1);
    expect(serverRequest).toHaveBeenCalledWith('integrations/intervals/events?oldest=2026-03-01&newest=2026-03-31');
});

test('profile retrieval and disconnect reuse the authenticated server connection', async () => {
    serverRequest.mockResolvedValueOnce({sportSettings: [{types: ['VirtualRide'], indoor_ftp: 250}], weight: 75});
    expect(await intervals.getAthlete()).toEqual({ftp: 250, weight: 75});
    await intervals.disconnect();
    expect(serverRequest).toHaveBeenLastCalledWith('integrations/intervals', {method: 'DELETE', body: {}});
});

test('FIT upload goes through the account API and returns existing player-compatible status', async () => {
    serverRequest.mockResolvedValue({success: true});
    const blob = {arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer};
    expect(await intervals.uploadWorkout({id: 'ride', summary: {name: 'Real ride'}, blob})).toBe(':success');
    expect(serverRequest).toHaveBeenCalledWith('integrations/intervals/upload', {method: 'POST',
        body: {id: 'ride', name: 'Real ride', file: 'AQID'}});
});

test('proxy errors are surfaced and never replaced with a success-shaped empty activity list', async () => {
    const listener = jest.fn();
    window.addEventListener('ui:modal:error:open', listener);
    serverRequest.mockRejectedValue(new Error('API key rejected'));
    await expect(intervals.wod()).rejects.toThrow('API key rejected');
    await expect(intervals.getAthlete()).rejects.toThrow('API key rejected');
    expect(await intervals.uploadWorkout({blob: {arrayBuffer: async () => new ArrayBuffer(1)}})).toBe(':fail');
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({detail: {data: 'API key rejected'}}));
    window.removeEventListener('ui:modal:error:open', listener);
});
