/*
 * demands.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * models training load, planning logic, and adaptation rules used to generate and explain workouts.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { GOALS, CAPABILITIES, sum, metric } from './domain.js';

export function modelGoalDemand(goal, registry = GOALS) {
    const weights = registry[goal.type];
    if(!weights || weights.length !== CAPABILITIES.length || weights.some(v => !Number.isFinite(v) || v < 0) || !sum(weights)) {
        throw new Error('Goal type needs five nonnegative capability weights.');
    }
    const adjusted = [...weights];
    if(goal.expectedDurationMinutes >= 240 || goal.distanceKm >= 150) adjusted[4] += 2;
    if(goal.elevationM >= 2000 || goal.terrain === 'mountainous') adjusted[1] += 2;
    return {
        capabilities: Object.fromEntries(CAPABILITIES.map((key, i) => [key, adjusted[i] / sum(adjusted)])),
        durationMinutes: goal.expectedDurationMinutes ?? goal.finishTimeMinutes ?? null,
        targets: {ftp: goal.targetFTP ?? null, power: goal.targetPower ?? null, wKg: goal.targetWKg ?? null,
            completion: goal.completionObjective ?? null},
        rationale: `${goal.type}: demands weighted by event type, declared duration, distance and terrain; no invented finish-time prediction.`,
    };
}

export function analyzeGaps(state, demand, goal) {
    const duration = demand.durationMinutes;
    const enduranceGap = duration && state.weeklyDuration != null ? Math.max(0, 1 - state.weeklyDuration / duration) : null;
    const ftpGap = goal.targetFTP && state.ftp.value ? Math.max(0, 1 - state.ftp.value / goal.targetFTP)
        : goal.targetWKg && state.wKg.value ? Math.max(0, 1 - state.wKg.value / goal.targetWKg) : null;
    const gaps = {
        endurance: metric(enduranceGap, 'low', 'Weekly duration versus declared event duration; a planning heuristic only.'),
        threshold: metric(ftpGap, state.confidence, 'Declared FTP or W/kg versus explicit target.'),
        aerobic: metric(null, 'unavailable', 'No validated aerobic-capacity target comparison.'),
        sprint: metric(null, 'unavailable', 'No validated sprint-capacity target comparison.'),
        durability: metric(null, 'unavailable', 'Observational durability is not a universal capability score.'),
    };
    const priorities = Object.keys(demand.capabilities).map(capability => ({
        capability, weight: demand.capabilities[capability],
        gap: gaps[capability], score: demand.capabilities[capability] * (1 + (gaps[capability].value ?? 0)),
    })).sort((a, b) => b.score - a.score || a.capability.localeCompare(b.capability));
    return {gaps, priorities, rationale: 'Known target gaps increase demand priority; unknown capacity is labelled, not fabricated.'};
}
