import { VERSION, sum, round } from './domain.js';
import { explainWorkout } from './explanations.js';
import { powerAccumulator } from './power.js';

export const FAMILIES = Object.freeze({
    endurance: {power: 0.65, rpe: 3, hard: false},
    recovery: {power: 0.5, rpe: 2, hard: false},
    threshold: {power: 0.95, rpe: 7, hard: true},
    aerobic: {power: 1.1, rpe: 8, hard: true},
    sprint: {power: 1.3, rpe: 8, hard: true},
    durability: {power: 0.65, rpe: 4, hard: false},
});

export function stepLoad(steps) {
    const calculation = powerAccumulator();
    steps.forEach(step => calculation.add(step.power, step.duration));
    const expectedIntensity = calculation.value();
    if(expectedIntensity == null) throw new Error('At least 30 prescribed seconds are required to estimate power load.');
    return sum(steps.map(s => s.duration)) / 3600 * expectedIntensity ** 2 * 100;
}

export function progressWorkout({id, date, minutes, family, level = 1, phaseId, weekId, phaseType, profile}) {
    const spec = FAMILIES[family];
    if(!spec || !Number.isInteger(minutes) || minutes < 10 || !Number.isInteger(level) || level < 1 || level > 5) {
        throw new Error('Invalid workout family, duration or progression level.');
    }
    const seconds = minutes * 60;
    let steps;
    if(spec.hard && minutes >= 25) {
        const repetitions = 3;
        const on = family === 'sprint' ? 10 + (level - 1) * 5
            : Math.min(family === 'aerobic' ? 180 : 300, 60 + (level - 1) * 30, Math.floor(seconds * 0.18 / repetitions));
        const off = 120;
        steps = [{duration: 300, power: 0.5}];
        for(let i = 0; i < repetitions; i++) {
            steps.push({duration: on, power: spec.power}, {duration: off, power: 0.5});
        }
        steps.push({duration: seconds - sum(steps.map(s => s.duration)) - 300, power: 0.65},
            {duration: 300, power: 0.5});
        steps = steps.filter(s => s.duration > 0);
    } else {
        family = spec.hard ? 'endurance' : family;
        steps = [{duration: seconds, power: FAMILIES[family].power}];
    }
    const actualSpec = FAMILIES[family];
    const title = `${family[0].toUpperCase()}${family.slice(1)} ${minutes} min`;
    return {
        id, externalId: id, date, family, type: actualSpec.hard ? 'intervals' : 'steady',
        title, description: explainWorkout(family, phaseType, level),
        purpose: family, duration: seconds, targetLoad: round(stepLoad(steps)),
        targetIntensity: Math.sqrt(stepLoad(steps) / (seconds / 3600 * 100)),
        steps, suitability: ['indoor', 'outdoor'],
        environment: profile.dayPreferences?.[new Date(`${date}T00:00:00Z`).getUTCDay()] || 'either',
        priority: actualSpec.hard || family === 'durability' ? 'high' : 'normal',
        required: actualSpec.hard || family === 'durability',
        phaseId, weekId, progressionLevel: level, expectedRpe: actualSpec.rpe,
        status: 'scheduled', matchedActivity: null, matchConfidence: null, completionQuality: null,
        adaptationNotes: [], plannerVersion: VERSION,
    };
}

export function toAppWorkout(workout) {
    return {
        id: workout.id, coachingWorkoutId: workout.id,
        meta: {name: workout.title, description: workout.description, author: 'Auuki deterministic coach',
            category: workout.family, startDateLocal: workout.date, duration: workout.duration},
        intervals: workout.steps.map(step => ({duration: step.duration, steps: [{...step}]})),
    };
}

export function exportZwo(workout) {
    const escape = value => String(value).replace(/[&<>"']/g, c =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'}[c]));
    return `<?xml version="1.0" encoding="UTF-8"?>\n<workout_file><author>Auuki</author>` +
        `<name>${escape(workout.title)}</name><description>${escape(workout.description)}</description>` +
        `<sportType>bike</sportType><workout>` +
        workout.steps.map(s => `<SteadyState Duration="${s.duration}" Power="${s.power}"/>`).join('') +
        '</workout></workout_file>';
}
