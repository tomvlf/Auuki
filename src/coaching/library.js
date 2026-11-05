/*
 * library.js: lets the Coach prescribe sessions from the built-in workout library.
 *
 * The planner decides what kind of session a day needs (family), how long it may be and how
 * much hard work fits. This module picks the library workout that best matches that need and
 * adjusts it to fit: fewer interval repetitions, shorter easy riding or extra endurance riding.
 * Workouts the Coach cannot follow safely (free-ride sections, targets above the planner's
 * power ceiling, tests and technique sessions) are never prescribed.
 */

import { workouts as builtIn } from '../workouts/workouts.js';
import { FAMILIES, buildWorkout, progressWorkout } from './workouts.js';
import { explainWorkout } from './explanations.js';

const CATEGORY_FAMILIES = {
    'VO2 Max': ['aerobic'], HIIT: ['aerobic'], Threshold: ['threshold'], 'Sweet Spot': ['threshold'],
    Sprint: ['sprint'], Base: ['endurance', 'durability'], Recovery: ['recovery'],
};
// Highest target allowed for each family, so an "easy" slot never receives hidden intensity.
const MAX_POWER = {endurance: 0.8, durability: 0.8, recovery: 0.65, threshold: 1.5, aerobic: 1.5, sprint: 1.5};
const EFFORT = 0.88;
const HARD = 0.9;
const MAX_POWER_TARGET = 1.5;
const HARD_SHARE = 0.18;
const MIN_EASY_STEP = 60;

const total = steps => steps.reduce((sum, s) => sum + s.duration, 0);
const hardSeconds = steps => total(steps.filter(s => s.power > HARD));
const efforts = steps => steps.filter(s => s.power >= EFFORT).length;
const round2 = value => Math.round(value * 100) / 100;
const attributes = source => Object.fromEntries([...source.matchAll(/(\w+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));
const text = (zwo, tag) => zwo.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '';

function ramp(duration, from, to) {
    const count = Math.max(1, Math.round(duration / 120));
    const base = Math.floor(duration / count);
    return Array.from({length: count}, (_, i) => ({
        duration: i === count - 1 ? duration - base * (count - 1) : base,
        power: round2(from + (to - from) * (i + 0.5) / count),
    }));
}

/**
 * Converts a ZWO workout into constant-power steps, or returns null when the Coach cannot use it.
 *
 * @param {string} zwo - ZWO XML text.
 * @returns {Array<{duration: number, power: number}>|null} Steps as FTP fractions.
 */
export function zwoSteps(zwo) {
    const steps = [];
    for(const [, tag, rest] of text(zwo, 'workout').matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
        if(tag.toLowerCase() === 'textevent') continue;
        const a = attributes(rest);
        const duration = Math.round(Number(a.Duration));
        if(tag === 'SteadyState') {
            steps.push({duration, power: Number(a.Power)});
        } else if(['Warmup', 'Cooldown', 'Ramp'].includes(tag)) {
            steps.push(...ramp(duration, Number(a.PowerLow), Number(a.PowerHigh)));
        } else if(tag === 'IntervalsT') {
            for(let i = 0; i < Number(a.Repeat); i++) {
                steps.push({duration: Math.round(Number(a.OnDuration)), power: Number(a.OnPower)},
                    {duration: Math.round(Number(a.OffDuration)), power: Number(a.OffPower)});
            }
        } else {
            return null;
        }
    }
    const valid = steps.length && steps.every(s => Number.isInteger(s.duration) && s.duration > 0 &&
        Number.isFinite(s.power) && s.power >= 0 && s.power <= MAX_POWER_TARGET);
    return valid ? steps : null;
}

/**
 * Builds the catalogue of library workouts the Coach may prescribe.
 *
 * @param {Array<string>} source - ZWO workouts; ids follow the built-in library (`builtin-<index>`).
 * @returns {Array<object>} Usable entries with name, description, steps and matching families.
 */
export function coachCatalogue(source = builtIn) {
    return source.flatMap((zwo, index) => {
        const category = text(zwo, 'category');
        const steps = zwoSteps(zwo);
        if(!steps || !CATEGORY_FAMILIES[category]) return [];
        const peak = Math.max(...steps.map(s => s.power));
        const families = CATEGORY_FAMILIES[category].filter(family => peak <= MAX_POWER[family]);
        if(!families.length) return [];
        return [{id: `builtin-${index}`, name: text(zwo, 'name'), category, families,
            description: text(zwo, 'description').replace(/\\'/g, "'"), steps}];
    });
}

function dropLastEffort(steps) {
    const index = steps.findLastIndex(s => s.power >= EFFORT);
    const start = index > 0 && steps[index - 1].power < EFFORT ? index - 1 : index;
    return [...steps.slice(0, start), ...steps.slice(index + 1)];
}

function shrinkEasy(steps, seconds) {
    const excess = total(steps) - seconds;
    if(excess <= 0) return steps;
    const first = steps.findIndex(s => s.power >= EFFORT);
    const last = steps.findLastIndex(s => s.power >= EFFORT);
    // Recoveries between efforts belong to the interval set and are never shortened.
    const flexible = (s, i) => s.power < 0.75 && (first < 0 || i < first || i > last);
    const slack = steps.map((s, i) => flexible(s, i) ? Math.max(0, s.duration - MIN_EASY_STEP) : 0);
    const available = slack.reduce((a, b) => a + b, 0);
    if(available < excess) return null;
    let remaining = excess;
    const result = steps.map((s, i) => {
        const cut = Math.min(slack[i], Math.floor(excess * slack[i] / available));
        remaining -= cut;
        return {...s, duration: s.duration - cut};
    });
    for(let i = result.length - 1; remaining > 0 && i >= 0; i--) {
        const cut = Math.min(remaining, slack[i] - (steps[i].duration - result[i].duration));
        result[i].duration -= cut;
        remaining -= cut;
    }
    return result;
}

function pad(steps, seconds, family) {
    const missing = seconds - total(steps);
    if(missing <= 0) return steps;
    const result = steps.map(s => ({...s}));
    if(missing < 120) {
        result.at(-1).duration += missing;
        return result;
    }
    // Extra riding goes before the cool-down, the same place a coach would add it.
    let at = result.length;
    while(at > 1 && result[at - 1].power < 0.6) at--;
    result.splice(at, 0, {duration: missing, power: family === 'recovery' ? 0.5 : 0.65});
    return result;
}

const minutes = seconds => `${Math.round(seconds / 60)} min`;

/**
 * Fits a library workout into a session slot.
 *
 * @param {object} entry - Catalogue entry.
 * @param {object} slot - `{seconds, family, level}` for the planned session.
 * @returns {{steps: Array<object>, adjustments: Array<string>, score: number}|null} The fitted workout or null.
 */
export function fitWorkout(entry, {seconds, family, level = 1}) {
    if(!entry.families.includes(family)) return null;
    const original = entry.steps.map(s => ({...s}));
    const count = efforts(original);
    const minEfforts = Math.min(count, 2);
    // Progression: early sessions use part of the set, later sessions the full set.
    const allowed = count ? Math.max(minEfforts, Math.ceil(count * Math.min(1, 0.4 + 0.15 * (level - 1)))) : 0;
    let steps = original;
    while(efforts(steps) > allowed) steps = dropLastEffort(steps);
    let fitted;
    for(;;) {
        fitted = hardSeconds(steps) <= seconds * HARD_SHARE ? shrinkEasy(steps, seconds) : null;
        if(fitted) break;
        if(efforts(steps) <= minEfforts) return null;
        steps = dropLastEffort(steps);
    }
    const kept = efforts(fitted);
    const shortened = total(steps) - total(fitted);
    const added = seconds - total(fitted);
    const adjustments = [];
    if(kept < count) adjustments.push(`${kept} of ${count} hard efforts`);
    if(shortened >= 60) {
        adjustments.push(kept === count && !count ? `shortened from ${minutes(total(entry.steps))} to ${minutes(seconds)}`
            : `easy riding shortened by ${minutes(shortened)}`);
    }
    if(added >= 120) adjustments.push(`${minutes(added)} of extra ${family === 'recovery' ? 'easy' : 'endurance'} riding`);
    const fittedSteps = pad(fitted, seconds, family);
    const score = (allowed ? (allowed - kept) / allowed : 0) * 2 + added / seconds +
        shortened / seconds + (family === 'durability' ? Math.max(0, seconds - total(entry.steps)) / seconds : 0);
    return {steps: fittedSteps, adjustments, score};
}

/**
 * Picks the most fitting library workout for a session, preferring variety and the workout
 * already planned for that day when the plan is adjusted.
 *
 * @param {object} slot - `{seconds, family, level}`.
 * @param {object} [options] - `history` of scheduled workouts, `prefer` library id and `catalogue`.
 * @returns {object|null} `{entry, steps, adjustments}` or null when no library workout fits.
 */
export function chooseLibraryWorkout(slot, {history = [], prefer = null, catalogue = defaultCatalogue()} = {}) {
    const uses = new Map();
    history.forEach(w => w.libraryWorkoutId && uses.set(w.libraryWorkoutId, (uses.get(w.libraryWorkoutId) || 0) + 1));
    const previous = history.filter(w => w.family === slot.family).at(-1)?.libraryWorkoutId;
    let best = null;
    for(const entry of catalogue) {
        const fit = fitWorkout(entry, slot);
        if(!fit) continue;
        const score = fit.score + 0.35 * (uses.get(entry.id) || 0) + (entry.id === previous ? 1 : 0) -
            (entry.id === prefer ? 3 : 0);
        if(!best || score < best.score) best = {entry, ...fit, score};
    }
    return best;
}

let cached;
function defaultCatalogue() {
    cached ??= coachCatalogue();
    return cached;
}

/**
 * Prescribes a session from the library, adjusted to the slot, or a generated session when no
 * library workout fits safely.
 *
 * @param {object} args - The same slot arguments as `progressWorkout`.
 * @param {object} [options] - `history`, `prefer`, `catalogue`, and `library: false` to skip the library.
 * @returns {object} A scheduled coaching workout.
 */
export function prescribeWorkout(args, {history = [], prefer = null, catalogue, library = true} = {}) {
    const level = args.level ?? 1;
    const family = FAMILIES[args.family]?.hard && args.minutes < 25 ? 'endurance' : args.family;
    const choice = library && Number.isInteger(args.minutes) && args.minutes >= 10 &&
        chooseLibraryWorkout({seconds: args.minutes * 60, family, level}, {history, prefer, catalogue: catalogue ?? defaultCatalogue()});
    if(!choice) return progressWorkout(args);
    const {entry, steps, adjustments} = choice;
    const note = adjustments.length ? ` Adjusted by the Coach: ${adjustments.join(', ')}.` : '';
    return buildWorkout({...args, family, level, steps, title: entry.name,
        description: `${explainWorkout(family, args.phaseType, level)} ${entry.description}${note}`.trim(),
        library: {id: entry.id, name: entry.name, adjustments}});
}
