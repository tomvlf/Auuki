/*
 * format.test.js: test coverage module.
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

import { escape, time, number, trainingSummary, profileGraph } from '../../src/platform/format.js';

test('escapes user-supplied content and formats missing values explicitly', () => {
    expect(escape('<img src=x onerror="x">&')).toBe('&lt;img src=x onerror=&quot;x&quot;&gt;&amp;');
    expect(time(65)).toBe('1:05');
    expect(time(-10)).toBe('0:00');
    expect(time(null)).toBe('--:--');
    expect(number(null)).toBe('--');
    expect(number(NaN)).toBe('--');
    expect(number(0)).toBe('0');
});

test('training summary excludes future and non-cycling activities, calculates exact rolling days and adherence', () => {
    const data = {activities: [
        {sport: 'cycling', day: '2026-03-20', duration: 3600},
        {sport: 'cycling', day: '2026-03-14', duration: 1800},
        {sport: 'cycling', day: '2026-03-13', duration: 9999},
        {sport: 'cycling', day: '2026-03-21', duration: 9999},
        {sport: 'running', day: '2026-03-20', duration: 9999},
    ], plan: {status: 'active', workouts: [
        {date: '2026-03-17', status: 'completed'},
        {date: '2026-03-18', status: 'substituted'},
        {date: '2026-03-19', status: 'missed'},
        {date: '2026-03-20', status: 'scheduled'},
        {date: '2026-03-21', status: 'scheduled'},
    ]}};
    const summary = trainingSummary(data, '2026-03-20');
    expect(summary.seconds).toBe(5400);
    expect(summary.week).toHaveLength(2);
    expect(summary.days).toHaveLength(7);
    expect(summary.days[0]).toEqual({date: '2026-03-14', seconds: 1800});
    expect(summary.days.at(-1).seconds).toBe(3600);
    expect(summary.completed).toBe(2);
    expect(summary.due).toBe(4);
    expect(summary.adherence).toBe(0.5);
    expect(summary.upcoming).toHaveLength(2);
    data.plan.status = 'archived';
    expect(trainingSummary(data, '2026-03-20').adherence).toBeNull();
});

test('empty training history does not invent metrics', () => {
    const summary = trainingSummary(null, '2026-03-20');
    expect(summary.seconds).toBe(0);
    expect(summary.adherence).toBeNull();
    expect(summary.upcoming).toEqual([]);
    expect(summary.days.every(day => day.seconds === 0)).toBe(true);
});

test('workout profile uses real interval durations and finite power targets', () => {
    expect(profileGraph({})).toContain('Free ride');
    const html = profileGraph({intervals: [{steps: [{duration: 60, power: .5}, {duration: 120, power: 1.1}]}]});
    expect(html).toContain('flex-grow:60');
    expect(html).toContain('flex-grow:120');
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('NaN');
});
