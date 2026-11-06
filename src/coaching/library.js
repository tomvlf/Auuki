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
import { FAMILIES, buildWorkout, progressWorkout, stepLoad } from './workouts.js';
import { explainWorkout } from './explanations.js';
import { DEFAULTS, validateCoachingConfig } from './domain.js';

const CATEGORY_FAMILIES = {
    'VO2 Max': ['aerobic'], HIIT: ['aerobic'], Threshold: ['threshold'], 'Sweet Spot': ['threshold'],
    Sprint: ['sprint'], Base: ['endurance', 'durability'], Recovery: ['recovery'],
};
export const TEMPLATE_RULES = Object.freeze({});
const total = steps => steps.reduce((sum, s) => sum + s.duration, 0);
const hardSeconds = (steps, rules) => total(steps.filter(s => s.power > rules.libraryHardPowerThreshold));
const efforts = (steps, rules) => steps.filter(s => s.power >= rules.libraryEffortPowerThreshold).length;
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
 * @returns {{steps: Array<object>|null, reason: string|null}} The expanded steps or an unsupported reason.
 */
export function zwoTemplate(zwo, rules = DEFAULTS) {
    const config = validateCoachingConfig(rules);
    const steps = [];
    let intervalBlock = 0;
    for(const [, tag, rest] of text(zwo, 'workout').matchAll(/<(\w+)\b([^>]*?)\/?>/g)) {
        if(tag.toLowerCase() === 'textevent') continue;
        const a = attributes(rest);
        for(const key of ['Cadence', 'CadenceResting']) {
            if(a[key] != null && (!Number.isInteger(Number(a[key])) || Number(a[key]) < 0)) {
                return {steps: null, reason: `Invalid ${key} target.`};
            }
        }
        const cadence = a.Cadence == null ? {} : {cadence: Number(a.Cadence)};
        const restingCadence = a.CadenceResting == null ? {} : {cadence: Number(a.CadenceResting)};
        const duration = Math.round(Number(a.Duration));
        if(tag === 'SteadyState') {
            const power = Number(a.Power);
            if(!Number.isInteger(duration) || duration <= 0 || !Number.isFinite(power)) {
                return {steps: null, reason: 'Missing or invalid steady-state duration/power.'};
            }
            steps.push({duration, power, ...cadence, role: power >= config.libraryEffortPowerThreshold ? 'effort' : 'steady'});
        } else if(['Warmup', 'Cooldown', 'Ramp'].includes(tag)) {
            if(!Number.isInteger(duration) || duration <= 0 ||
               !Number.isFinite(Number(a.PowerLow)) || !Number.isFinite(Number(a.PowerHigh))) {
                return {steps: null, reason: `Missing or invalid ${tag} duration/power.`};
            }
            steps.push(...ramp(duration, Number(a.PowerLow), Number(a.PowerHigh))
                .map(step => ({...step, ...cadence, role: tag === 'Warmup' ? 'warmup' : tag === 'Cooldown' ? 'cooldown' : 'ramp', protected: true})));
        } else if(tag === 'IntervalsT') {
            const repeat = Number(a.Repeat), onDuration = Number(a.OnDuration), offDuration = Number(a.OffDuration);
            const onPower = Number(a.OnPower), offPower = Number(a.OffPower);
            if(!Number.isInteger(repeat) || repeat < 1 ||
               !Number.isInteger(onDuration) || onDuration <= 0 ||
               !Number.isInteger(offDuration) || offDuration <= 0 ||
               !Number.isFinite(onPower) || !Number.isFinite(offPower)) {
                return {steps: null, reason: 'Missing or invalid interval repetition/duration/power.'};
            }
            const block = intervalBlock++;
            for(let i = 0; i < repeat; i++) {
                const repetitionId = `${block}:${i}`;
                steps.push({duration: onDuration, power: onPower, ...cadence,
                    role: 'effort', repetitionId},
                {duration: offDuration, power: offPower, ...restingCadence,
                    role: 'interval-recovery', repetitionId, protected: true});
            }
        } else {
            return {steps: null, reason: `Unsupported workout element: ${tag}.`};
        }
    }
    const valid = steps.length && steps.every(s => Number.isInteger(s.duration) && s.duration > 0 &&
        Number.isFinite(s.power) && s.power >= 0 && s.power <= config.libraryMaximumPower);
    return {steps: valid ? steps : null, reason: valid ? null : 'Invalid or out-of-range workout step.'};
}

export function zwoSteps(zwo, rules = DEFAULTS) {
    return zwoTemplate(zwo, rules).steps?.map(({duration, power}) => ({duration, power})) ?? null;
}

/**
 * Builds the catalogue of library workouts the Coach may prescribe.
 *
 * @param {Array<string>} source - ZWO workouts; ids follow the built-in library (`builtin-<index>`).
 * @returns {Array<object>} Usable entries with name, description, steps and matching families.
 */
export function coachCatalogue(source = builtIn, rules = DEFAULTS, templateRules = {}) {
    const config = validateCoachingConfig(rules);
    return source.flatMap((zwo, index) => {
        const category = text(zwo, 'category');
        const {steps} = zwoTemplate(zwo, config);
        if(!steps || !CATEGORY_FAMILIES[category]) return [];
        const name = text(zwo, 'name');
        const template = templateRules[index] || templateRules[name] || {};
        const minimumEfforts = template.minimumEfforts ?? config.libraryMinimumEfforts;
        const minimumWarmupSeconds = template.minimumWarmupSeconds ?? 0;
        const minimumCooldownSeconds = template.minimumCooldownSeconds ?? 0;
        if(!Number.isInteger(minimumEfforts) || minimumEfforts < 1 || minimumEfforts > 20 ||
           !Number.isInteger(minimumWarmupSeconds) || minimumWarmupSeconds < 0 ||
           !Number.isInteger(minimumCooldownSeconds) || minimumCooldownSeconds < 0) {
            throw new Error(`Invalid minimum repetition count for library workout "${name}".`);
        }
        const peak = Math.max(...steps.map(s => s.power));
        const families = CATEGORY_FAMILIES[category].filter(family => peak <=
            (family === 'recovery' ? config.libraryRecoveryMaximumPower
                : ['endurance', 'durability'].includes(family) ? config.libraryEnduranceMaximumPower
                    : config.libraryMaximumPower));
        if(!families.length) return [];
        return [{id: `builtin-${index}`, name, category, families,
            description: text(zwo, 'description').replace(/\\'/g, "'"), steps,
            minimumEfforts, minimumWarmupSeconds, minimumCooldownSeconds}];
    });
}

function dropLastEffort(steps, rules) {
    const index = steps.findLastIndex(s => s.power >= rules.libraryEffortPowerThreshold);
    const repetitionId = steps[index]?.repetitionId;
    if(repetitionId != null) return steps.filter(s => s.repetitionId !== repetitionId);
    const start = index > 0 && steps[index - 1].power < rules.libraryEffortPowerThreshold &&
        !steps[index - 1].protected ? index - 1 : index;
    return [...steps.slice(0, start), ...steps.slice(index + 1)];
}

function shrinkEasy(steps, seconds, rules) {
    const excess = total(steps) - seconds;
    if(excess <= 0) return steps;
    const first = steps.findIndex(s => s.power >= rules.libraryEffortPowerThreshold);
    const last = steps.findLastIndex(s => s.power >= rules.libraryEffortPowerThreshold);
    // Recoveries between efforts belong to the interval set and are never shortened.
    const flexible = (s, i) => !s.protected && s.power < rules.easyPower && (first < 0 || i < first || i > last);
    const slack = steps.map((s, i) => flexible(s, i)
        ? Math.max(0, s.duration - rules.libraryMinimumEasyStepSeconds) : 0);
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
    const cooldown = result.findIndex(s => s.role === 'cooldown');
    const at = cooldown < 0 ? result.length : cooldown;
    result.splice(at, 0, {duration: missing,
        power: family === 'recovery' ? FAMILIES.recovery.power : FAMILIES.endurance.power, role: 'added-easy'});
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
export function fitWorkout(entry, {seconds, family, level = 1}, rules = DEFAULTS) {
    const config = validateCoachingConfig(rules);
    if(!Number.isInteger(seconds) || seconds < config.minimumSessionMinutes * 60 ||
       !Number.isInteger(level) || level < 1 || level > config.progressionMaximumLevel) return null;
    if(!entry.families.includes(family)) return null;
    const original = entry.steps.map(s => ({...s}));
    if(total(original.filter(s => s.role === 'warmup')) < (entry.minimumWarmupSeconds || 0) ||
       total(original.filter(s => s.role === 'cooldown')) < (entry.minimumCooldownSeconds || 0)) return null;
    const count = efforts(original, config);
    const minEfforts = Math.min(count, entry.minimumEfforts ?? config.libraryMinimumEfforts);
    // Progression: early sessions use part of the set, later sessions the full set.
    const allowed = count ? Math.max(minEfforts, Math.ceil(count * Math.min(1,
        config.libraryProgressionBaseShare + config.libraryProgressionIncrement * (level - 1)))) : 0;
    let steps = original;
    while(efforts(steps, config) > allowed) steps = dropLastEffort(steps, config);
    let fitted;
    for(;;) {
        fitted = hardSeconds(steps, config) <= seconds * config.libraryMaximumHardTimeShare
            ? shrinkEasy(steps, seconds, config) : null;
        if(fitted) break;
        if(efforts(steps, config) <= minEfforts) return null;
        steps = dropLastEffort(steps, config);
    }
    const kept = efforts(fitted, config);
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
 * @param {object} [options] - `history` of scheduled workouts, `prefer` library id, `catalogue`
 *   and an optional `maxLoad` budget that every candidate must stay within.
 * @returns {object|null} `{entry, steps, adjustments}` or null when no library workout fits.
 */
export function chooseLibraryWorkout(slot, {history = [], prefer = null,
    catalogue = defaultCatalogue(), rules = DEFAULTS, maxLoad = Infinity} = {}) {
    const config = validateCoachingConfig(rules);
    const uses = new Map();
    history.forEach(w => w.libraryWorkoutId && uses.set(w.libraryWorkoutId, (uses.get(w.libraryWorkoutId) || 0) + 1));
    const previous = history.filter(w => w.family === slot.family).at(-1)?.libraryWorkoutId;
    const candidates = [];
    for(const entry of catalogue) {
        const fit = fitWorkout(entry, slot, config);
        if(!fit || stepLoad(fit.steps) > maxLoad + 0.01) continue;
        candidates.push({entry, ...fit});
    }
    if(!candidates.length) return null;
    const bestFit = Math.min(...candidates.map(candidate => candidate.score));
    const preserved = candidates.find(candidate => candidate.entry.id === prefer);
    const shortlist = preserved ? [preserved] : candidates.filter(candidate => candidate.score <= bestFit + 0.05);
    shortlist.sort((a, b) => (uses.get(a.entry.id) || 0) - (uses.get(b.entry.id) || 0) ||
        Number(a.entry.id === previous) - Number(b.entry.id === previous) ||
        a.score - b.score || a.entry.name.localeCompare(b.entry.name));
    return shortlist[0];
}

const catalogues = new Map();
function defaultCatalogue(rules = DEFAULTS) {
    const key = JSON.stringify(rules);
    if(!catalogues.has(key)) catalogues.set(key, coachCatalogue(builtIn, rules, TEMPLATE_RULES));
    return catalogues.get(key);
}

/**
 * Prescribes a session from the library, adjusted to the slot, or a generated session when no
 * library workout fits safely.
 *
 * @param {object} args - The same slot arguments as `progressWorkout`.
 * @param {object} [options] - `history`, `prefer`, `catalogue`, `maxLoad`, and `library: false` to skip the library.
 * @returns {object} A scheduled coaching workout.
 */
export function prescribeWorkout(args, {history = [], prefer = null, catalogue, library = true,
    rules = DEFAULTS, maxLoad = Infinity} = {}) {
    const config = validateCoachingConfig(rules);
    const level = args.level ?? 1;
    const family = FAMILIES[args.family]?.hard && args.minutes < 25 ? 'endurance' : args.family;
    const choice = library && Number.isInteger(args.minutes) && args.minutes >= 10 &&
        chooseLibraryWorkout({seconds: args.minutes * 60, family, level}, {
            history, prefer, maxLoad, catalogue: catalogue ?? defaultCatalogue(config), rules: config});
    if(!choice) {
        const generated = progressWorkout(args);
        if(library) {
            generated.libraryRationale = `No safe, fitting library template was available for this ${generated.family} slot; the Coach generated a conservative session instead.`;
            generated.description = `${generated.description} ${generated.libraryRationale}`;
        }
        return generated;
    }
    const {entry, steps, adjustments} = choice;
    const rationale = `Selected from ${entry.category} after checking dose fit and safety; variety is only used to break near-equal fits.`;
    const note = adjustments.length ? ` Adjusted by the Coach: ${adjustments.join(', ')}.` : '';
    return buildWorkout({...args, family, level, steps, title: entry.name,
        description: `${explainWorkout(family, args.phaseType, level)} ${rationale} ${entry.description}${note}`.trim(),
        library: {id: entry.id, name: entry.name, adjustments, rationale}});
}
