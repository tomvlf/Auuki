/*
 * adaptation.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
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

import { VERSION, sum, round } from './domain.js';
import { progressWorkout } from './workouts.js';
import { validatePlan } from './planner.js';
import { explainAdaptation } from './explanations.js';

export function matchWorkout(activity, workouts, explicitId = null) {
    if(activity.sport !== 'cycling') return {workoutId: null, confidence: 0, quality: null, reason: 'Not a cycling activity.'};
    const candidates = workouts.filter(w => w.status === 'scheduled' && w.date === activity.day);
    if(explicitId && !candidates.some(w => w.id === explicitId)) {
        return {workoutId: null, confidence: 0, quality: null, reason: 'Explicit workout is not scheduled on this local date.'};
    }
    const matches = candidates.filter(w => !explicitId || w.id === explicitId).map(w => {
        const durationQuality = Math.min(activity.duration, w.duration) / Math.max(activity.duration, w.duration);
        const powerQuality = activity.intensityFactor != null
            ? Math.max(0, 1 - Math.abs(activity.intensityFactor - w.targetIntensity)) : null;
        const quality = powerQuality == null ? durationQuality : (durationQuality + powerQuality) / 2;
        const confidence = explicitId ? 1 : durationQuality * (powerQuality == null ? 0.6 : 0.85 * powerQuality);
        return {workoutId: w.id, confidence, quality,
            reason: explicitId ? 'Explicit session identity; quality uses duration and available summary intensity.'
                : 'Same local date, duration and available intensity; interval execution is not proven.'};
    }).sort((a, b) => b.confidence - a.confidence || a.workoutId.localeCompare(b.workoutId));
    return matches[0]?.confidence >= 0.65 ? matches[0]
        : {workoutId: null, confidence: matches[0]?.confidence || 0, quality: null,
            reason: 'Insufficient evidence for an automatic match; confirm a substitution explicitly.'};
}

export function adaptPlan({plan, profile, state, trigger, date, timestamp, workoutId = null,
    activity = null, match = null}) {
    if(!['completed', 'failed', 'missed', 'substituted', 'recovery', 'unplanned', 'feedback'].includes(trigger) ||
       !Number.isFinite(Date.parse(timestamp)) || date < plan.startDate || date > plan.endDate) {
        throw new Error('Invalid adaptation trigger, timestamp or date.');
    }
    const next = JSON.parse(JSON.stringify(plan));
    const changes = [];
    const target = workoutId ? next.workouts.find(w => w.id === workoutId) : null;
    if(workoutId && (!target || target.date > date || target.status !== 'scheduled')) {
        throw new Error('Only an unresolved workout on or before the adaptation date may be resolved.');
    }
    if(['completed', 'failed', 'substituted', 'missed'].includes(trigger) && !target) {
        throw new Error('Workout outcome requires a scheduled workout.');
    }
    if(['completed', 'substituted'].includes(trigger) && (!activity || !match)) {
        throw new Error('Completed and substituted workouts require activity evidence.');
    }
    if(target) {
        const previous = {...target};
        target.status = trigger;
        target.matchedActivity = activity?.id ?? null;
        target.matchConfidence = match?.confidence ?? null;
        target.completionQuality = match?.quality ?? null;
        changes.push({id: target.id, action: 'resolved', previous, current: {...target}});
    }
    let reduction = state.readiness.status === 'caution' || trigger === 'recovery' ? 0.7
        : ['missed', 'failed'].includes(trigger) || (match?.quality != null && match.quality < 0.8) ? 0.85 : 1;
    if(trigger === 'unplanned' && activity && activity.duration / 60 > state.baselineWeeklyMinutes * 0.4) {
        reduction = Math.min(reduction, 0.85);
    }
    const history = [];
    for(const week of next.weeks) {
        const members = next.workouts.filter(w => w.weekId === week.id);
        const frozen = members.filter(w => w.date <= date || w.status !== 'scheduled');
        const future = members.filter(w => w.date > date && w.status === 'scheduled');
        const originalMinutes = sum(members.map(w => w.duration / 60));
        const originalLoad = sum(members.map(w => w.targetLoad));
        const minuteCap = Math.min(originalMinutes,
            !history.length ? Infinity : Math.max(...history.slice(-4).map(w => w.minutes)) * (1 + week.rampLimit));
        let loadCap = Math.min(originalLoad,
            !history.length ? Infinity : Math.max(...history.slice(-4).map(w => w.load)) * (1 + week.rampLimit));
        // An unexpectedly long/hard ride consumes this week's remaining training budget.
        const alreadyAccounted = activity && plan.adaptations.some(a => a.observations.activityId === activity.id);
        if(activity && trigger !== 'feedback' && !alreadyAccounted &&
           activity.day >= week.startDate && activity.day <= week.endDate) {
            const actualLoad = activity.loadMetrics.power.value;
            const excess = actualLoad == null ? Math.max(0, activity.duration / 60 - (target?.duration || 0) / 60) * 0.65 ** 2 * 100 / 60
                : Math.max(0, actualLoad - (target?.targetLoad || 0));
            loadCap = Math.max(sum(frozen.map(w => w.targetLoad)), loadCap - excess);
        }
        let usedMinutes = sum(frozen.map(w => w.duration / 60));
        let usedLoad = sum(frozen.map(w => w.targetLoad));
        for(const workout of future) {
            const previous = JSON.parse(JSON.stringify(workout));
            const minutes = Math.floor(Math.min(workout.duration / 60 * reduction, minuteCap - usedMinutes));
            const forceEasy = reduction < 1;
            const family = forceEasy ? 'recovery' : workout.family;
            const loadPerMinute = forceEasy ? 0.5 ** 2 * 100 / 60 : workout.targetLoad / (workout.duration / 60);
            const fitMinutes = Math.min(minutes, Math.floor((loadCap - usedLoad + 0.000001) / loadPerMinute));
            if(fitMinutes < 10) {
                next.workouts = next.workouts.filter(w => w.id !== workout.id);
                changes.push({id: workout.id, action: 'removed', previous, current: null});
                continue;
            }
            const modified = progressWorkout({
                id: workout.id, date: workout.date, minutes: fitMinutes, family,
                level: forceEasy ? 1 : workout.progressionLevel, phaseId: workout.phaseId,
                weekId: workout.weekId, phaseType: week.phaseType, profile,
            });
            // Same interval family can have a slightly larger relative dose in a shorter session.
            if(usedLoad + modified.targetLoad > loadCap + 0.01) {
                modified.family = 'recovery';
                Object.assign(modified, progressWorkout({id: workout.id, date: workout.date,
                    minutes: fitMinutes, family: 'recovery', phaseId: workout.phaseId,
                    weekId: workout.weekId, phaseType: week.phaseType, profile}));
            }
            modified.adaptationNotes = [...workout.adaptationNotes];
            if(modified.duration !== workout.duration || modified.family !== workout.family) {
                modified.adaptationNotes.push(explainAdaptation(trigger, reduction));
                Object.assign(workout, modified);
                changes.push({id: workout.id, action: 'modified', previous, current: {...workout}});
            }
            usedMinutes += workout.duration / 60;
            usedLoad += workout.targetLoad;
        }
        week.scheduledMinutes = usedMinutes;
        week.scheduledLoad = round(usedLoad);
        history.push({minutes: usedMinutes, load: usedLoad});
    }
    next.revision++;
    next.sourceSnapshot = state.id;
    next.validationWarnings = validatePlan(next, profile);
    next.adaptations.push({
        trigger, previousRevision: plan.revision, newRevision: next.revision,
        observations: {snapshotId: state.id, readiness: state.readiness, activityId: activity?.id ?? null,
            match, date},
        changes, loadChange: round(sum(next.workouts.map(w => w.targetLoad)) - sum(plan.workouts.map(w => w.targetLoad))),
        reasoning: explainAdaptation(trigger, reduction), validationWarnings: next.validationWarnings,
        timestamp, plannerVersion: VERSION,
    });
    if(date >= next.endDate) next.status = 'finished';
    return next;
}
