/*
 * activity-list.test.js: test coverage module.
 *
 * This file verifies activity restoration and the metrics shown in the activity list.
 */

/** @jest-environment jsdom */

jest.mock('../../src/models/models.js', () => ({
    models: {activity: {restore: jest.fn()}},
}));
jest.mock('../../src/coaching/service.js', () => ({
    coachingData: jest.fn(() => null),
}));
jest.mock('../../src/coaching/state.js', () => ({
    estimateState: jest.fn(),
}));

import {models} from '../../src/models/models.js';
import {coachingData} from '../../src/coaching/service.js';
import {estimateState} from '../../src/coaching/state.js';
import {xf} from '../../src/functions.js';
import '../../src/views/activity-list.js';

const ActivityList = customElements.get('activity-list');

afterEach(() => {
    document.body.replaceChildren();
    jest.clearAllMocks();
});

test('restores persisted activities when the activity:restore event fires', async () => {
    models.activity.restore.mockResolvedValue([{
        id: 'ride-1',
        name: 'Morning ride',
        timestamp: Date.UTC(2026, 0, 1),
        duration: 3600,
        status: {},
    }]);
    const list = new ActivityList();
    document.body.append(list);

    xf.dispatch('activity:restore');
    await Promise.resolve();

    expect(models.activity.restore).toHaveBeenCalledTimes(1);
    expect(list.textContent).toContain('Morning ride');
});

test('shows available ride metrics without inventing training-load values', () => {
    coachingData.mockReturnValue({
        activities: [{
            id: 'ride-1',
            loadMetrics: {power: {value: 80}},
            rpe: 6,
        }],
    });
    const list = new ActivityList();

    expect(list.stats({
        id: 'ride-1',
        distance: 25000,
        averagePower: 190,
        averageHeartRate: 145,
        duration: 3600,
    })).toEqual(['25.0 km', '190 W', '145 bpm', 'Load 80', 'RPE 6']);
});

test('omits unavailable current training-state values instead of rendering NaN', () => {
    coachingData.mockReturnValue({
        profile: {timeZone: 'UTC'},
        activities: [{id: 'old-ride', day: '2020-01-01', duration: 3600, distance: 0}],
    });
    estimateState.mockReturnValue({
        chronicLoad: null,
        acuteLoad: null,
        formBalance: null,
        rampRate: null,
        loadSource: 'duration',
    });
    const list = new ActivityList();

    expect(list.summary()).not.toContain('activity-load-state');
    expect(list.summary()).not.toContain('NaN');
});
