/*
 * fixtures.js: test coverage module.
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

import { addDays } from '../../src/coaching/domain.js';
import { normalizeActivity } from '../../src/coaching/normalizer.js';
import { estimateState } from '../../src/coaching/state.js';

export const profile = {
    id: 'athlete', weight: 75, ftp: 250, experience: 'intermediate',
    timeZone: 'Europe/Paris', unitSystem: 'metric', typicalWeeklyHours: 6, maxWeeklyHours: 8,
    availableDays: [0, 2, 4, 6], maxSessionMinutes: {0: 90, 2: 75, 4: 75, 6: 180},
    longRideDay: 6, powerMeter: true, heartRateMonitor: true, smartTrainer: true,
    maxHeartRate: 190, restingHeartRate: 50,
};
export const goal = {
    id: 'goal', name: 'Mountain fondo', type: 'gran_fondo', date: '2026-04-01',
    priority: 'A', active: true, distanceKm: 160, elevationM: 2500, expectedDurationMinutes: 360,
};
export const start = '2026-01-01';
export const timestamp = '2026-01-01T10:00:00Z';
export function history(p = profile, days = 84) {
    return Array.from({length: days}, (_, i) => i).filter(i => i % 2 === 0).map(i => normalizeActivity({
        id: `ride-${i}`, start: `${addDays(start, -i)}T09:00:00Z`,
        duration: 3600, normalizedPower: 165, averagePower: 160, averageHeartRate: 130, rpe: 4,
    }, p));
}
export const state = (p = profile, activities = history(p), asOf = start) => estimateState(activities, p, asOf);
export function memoryStorage() {
    const values = new Map();
    return {getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value)};
}
