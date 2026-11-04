/*
 * domain.js: front-end client module.
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

export const VERSION = 'coaching-1';
export const DAY = 86400000;
export const DEFAULTS = Object.freeze({
    shortDays: 7, mediumDays: 28, longDays: 84,
    chronicDays: 42, acuteDays: 7, maxRamp: 0.05, lowDataRamp: 0.025,
    recoveryFactor: 0.7, taperFactor: 0.55, initialMinutes: 90,
    maxPlanDays: 366, powerZones: Object.freeze([0.55, 0.75, 0.9, 1.05, 1.2, 1.5]),
    heartRateZones: Object.freeze([0.6, 0.7, 0.8, 0.9]),
});
export const GOALS = Object.freeze({
    general_fitness: [5, 2, 1, 1, 1],
    ftp_improvement: [2, 5, 3, 1, 1],
    gran_fondo: [5, 3, 2, 1, 4],
    climbing: [3, 5, 3, 1, 3],
    time_trial: [3, 5, 2, 1, 2],
    road_race: [3, 3, 4, 3, 3],
    criterium: [2, 3, 4, 5, 1],
    sprint: [1, 1, 2, 5, 1],
    long_distance_completion: [5, 2, 1, 1, 5],
});
export const CAPABILITIES = ['endurance', 'threshold', 'aerobic', 'sprint', 'durability'];
export const sum = values => values.reduce((a, b) => a + b, 0);
export const mean = values => values.length ? sum(values) / values.length : null;
export const positive = value => Number.isFinite(value) && value > 0;
export const round = value => Math.round(value * 100) / 100;
/**
 * Validates a date string and ensures it is an actual date in ISO YYYY-MM-DD format.
 *
 * This is a strict helper because the planner and calendar operate on comparable dates,
 * and even a single invalid date can offset a full training week or cause misalignment
 * with imported activities.
 *
 * @param {string} value - Raw date value to validate.
 * @returns {string} The same valid date string.
 */
export function date(value) {
    if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
       !Number.isFinite(Date.parse(`${value}T00:00:00Z`)) ||
       new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) !== value) {
        throw new Error('Expected a valid YYYY-MM-DD date.');
    }
    return value;
}
/**
 * Adds a number of calendar days to an ISO date while preserving the date's timezone semantics.
 *
 * @param {string} value - Base date in YYYY-MM-DD format.
 * @param {number} days - Positive or negative day offset.
 * @returns {string} The shifted date in YYYY-MM-DD format.
 */
export const addDays = (value, days) => new Date(Date.parse(`${date(value)}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
export const daysBetween = (a, b) => (Date.parse(date(b)) - Date.parse(date(a))) / DAY;
export const weekday = value => new Date(`${date(value)}T00:00:00Z`).getUTCDay();
/**
 * Returns the local calendar day for a timestamp in a specific time zone.
 *
 * @param {number|string} timestamp - UTC timestamp or ISO date value.
 * @param {string} timeZone - IANA time zone such as Europe/Amsterdam.
 * @returns {string} The rider-local date in YYYY-MM-DD format.
 */
export function localDay(timestamp, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(timestamp));
    const part = name => parts.find(p => p.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}
/**
 * Validates an athlete configuration before it is accepted by the planner.
 *
 * The coaching engine relies on the profile being internally consistent: training time,
 * weekday availability, FTP, and any heart-rate thresholds must all align or the plan
 * can become misleading or impossible to execute.
 *
 * @param {object} profile - Athlete profile and availability.
 * @returns {object} The validated profile.
 */
export function validateProfile(profile) {
    if(!profile.id || !positive(profile.weight) || (profile.ftp != null && !positive(profile.ftp)) ||
       !['beginner', 'intermediate', 'advanced'].includes(profile.experience) ||
       !positive(profile.typicalWeeklyHours) || !positive(profile.maxWeeklyHours) ||
       profile.typicalWeeklyHours > profile.maxWeeklyHours) {
        throw new Error('Invalid athlete profile, FTP, body mass or weekly availability.');
    }
    new Intl.DateTimeFormat('en', {timeZone: profile.timeZone}).format();
    if(!profile.timeZone || !Array.isArray(profile.availableDays) || !profile.availableDays.length ||
       new Set(profile.availableDays).size !== profile.availableDays.length ||
       profile.availableDays.some(day => !Number.isInteger(day) || day < 0 || day > 6 ||
           !positive(profile.maxSessionMinutes?.[day]) || profile.maxSessionMinutes[day] > 1440)) {
        throw new Error('Specify unique available weekdays and positive session limits in minutes.');
    }
    if(profile.longRideDay != null && !profile.availableDays.includes(profile.longRideDay)) {
        throw new Error('The long-ride day must be available.');
    }
    if(profile.unitSystem != null && !['metric', 'imperial'].includes(profile.unitSystem)) throw new Error('Invalid unit system.');
    for(const key of ['maxHeartRate', 'thresholdHeartRate', 'restingHeartRate']) {
        if(profile[key] != null && (!positive(profile[key]) || profile[key] > 255)) throw new Error(`Invalid ${key}.`);
    }
    if(profile.maxHeartRate != null &&
       (profile.restingHeartRate >= profile.maxHeartRate || profile.thresholdHeartRate > profile.maxHeartRate)) {
        throw new Error('Heart-rate thresholds contradict maximum heart rate.');
    }
    for(const key of ['powerMeter', 'heartRateMonitor', 'smartTrainer']) {
        if(profile[key] != null && typeof profile[key] !== 'boolean') throw new Error(`Invalid ${key}.`);
    }
    if(Object.values(profile.dayPreferences || {}).some(v => !['indoor', 'outdoor', 'either'].includes(v))) {
        throw new Error('Invalid indoor/outdoor day preference.');
    }
    return profile;
}
/**
 * Validates a training goal before it can generate a plan.
 *
 * @param {object} goal - Goal metadata and target values.
 * @param {string} startDate - Plan start date in YYYY-MM-DD format.
 * @param {Record<string, number[]>} [registry=GOALS] - Supported goal archetypes.
 * @returns {object} The validated goal.
 */
export function validateGoal(goal, startDate, registry = GOALS) {
    date(startDate);
    date(goal.date);
    if(!goal.id || !goal.name || !registry[goal.type] || !['A', 'B', 'C'].includes(goal.priority) ||
       goal.active === false || daysBetween(startDate, goal.date) < 1 ||
       daysBetween(startDate, goal.date) > DEFAULTS.maxPlanDays) {
        throw new Error('An active supported goal must be dated 1-366 days after plan start.');
    }
    for(const key of ['distanceKm', 'elevationM', 'expectedDurationMinutes', 'targetPower',
        'targetFTP', 'targetWKg', 'finishTimeMinutes']) {
        if(goal[key] != null && !positive(goal[key])) throw new Error(`Invalid goal ${key}.`);
    }
    return goal;
}
export function metric(value, confidence, reason, inputs = {}) {
    return {value, confidence: value == null ? 'unavailable' : confidence, reason,
        source: 'derived', version: VERSION, inputs};
}
