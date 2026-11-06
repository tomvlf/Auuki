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

import { VERSION, DEFAULTS, sum, round, addDays, validateCoachingConfig } from './domain.js';
import { progressWorkout, FAMILIES } from './workouts.js';
import { prescribeWorkout } from './library.js';
import { validatePlan, rampReference } from './planner.js';
import { explainAdaptation } from './explanations.js';

export function matchWorkout(activity, workouts, explicitId = null, rules = DEFAULTS) {
    const config = validateCoachingConfig(rules);
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
    return matches[0]?.confidence >= config.automaticMatchMinimumConfidence ? matches[0]
        : {workoutId: null, confidence: matches[0]?.confidence || 0, quality: null,
            reason: 'Insufficient evidence for an automatic match; confirm a substitution explicitly.'};
}

export function adaptPlan({plan, profile, state, trigger, date, timestamp, workoutId = null,
    activity = null, match = null}) {
    if(!['completed', 'failed', 'missed', 'substituted', 'recovery', 'unplanned', 'feedback'].includes(trigger) ||
       !Number.isFinite(Date.parse(timestamp)) || date < plan.startDate || date > plan.endDate) {
        throw new Error('Invalid adaptation trigger, timestamp or date.');
    }
    const config = validateCoachingConfig(state.config ?? plan.coachingConfig);
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
    const reduceIntensity = state.readiness.status === 'caution' || trigger === 'recovery';
    // Reductions are short-term responses; sessions beyond the window keep (or regain) their planned dose.
    const windowEnd = addDays(date, config.adaptationWindowDays);
    let reduction = reduceIntensity
        ? config.readinessConservativeFactor
        : ['missed', 'failed'].includes(trigger) ||
            (match?.quality != null && match.quality < config.progressionMinimumQuality)
            ? config.outcomeReductionFactor : 1;
    if(trigger === 'unplanned' && activity && activity.duration / 60 > state.baselineWeeklyMinutes * 0.4) {
        reduction = Math.min(reduction, 0.85);
    }
    const history = [];
    const envelope = () => [plan.initialLimits, ...history].slice(-4);
    const policy = w => {
        const factor = w.date <= windowEnd ? reduction : 1;
        return {factor, easy: factor < 1 && reduceIntensity};
    };
    // A session inside an earlier reduction window keeps that reduction until the window ends;
    // a later event may only make it stricter, never undo an athlete's or the Coach's caution early.
    const held = w => w.date > date && w.status === 'scheduled' && w.original?.until >= w.date &&
        !(policy(w).factor < w.original.factor || (policy(w).easy && !w.original.easy));
    for(const week of next.weeks) {
        const members = next.workouts.filter(w => w.weekId === week.id);
        const frozen = members.filter(w => w.date <= date || w.status !== 'scheduled' || held(w));
        const future = members.filter(w => w.date > date && w.status === 'scheduled' && !held(w));
        const planned = w => w.date > date && w.status === 'scheduled' && w.original ? w.original : w;
        const originalMinutes = sum(members.map(w => planned(w).duration / 60));
        const originalLoad = sum(members.map(w => planned(w).targetLoad));
        // Plans generated before the planned dose was stored derive it from the pre-adjustment sessions.
        if(!Number.isFinite(week.plannedMinutes)) week.plannedMinutes = originalMinutes;
        if(!Number.isFinite(week.plannedLoad)) week.plannedLoad = round(originalLoad);
        const minuteCap = Math.min(originalMinutes,
            Math.max(...envelope().map(w => w.minutes)) * (1 + week.rampLimit));
        let loadCap = Math.min(originalLoad,
            Math.max(...envelope().map(w => w.load)) * (1 + week.rampLimit));
        if(['completed', 'substituted'].includes(trigger) && reduction === 1) {
            const priorEnvelope = history.length
                ? Math.max(...envelope().map(w => w.load)) * (1 + week.rampLimit)
                : plan.initialLimits.load;
            loadCap = Math.min(week.targetLoad, priorEnvelope);
        }
        // An unexpectedly long/hard ride consumes this week's remaining training budget.
        const alreadyAccounted = activity && plan.adaptations.some(a => a.observations.activityId === activity.id);
        if(activity && trigger !== 'feedback' && !alreadyAccounted &&
           activity.day >= week.startDate && activity.day <= week.endDate) {
            const actualLoad = activity.loadMetrics.power.value;
            const excess = actualLoad == null ? Math.max(0, activity.duration / 60 - (target?.duration || 0) / 60) * 0.65 ** 2 * 100 / 60
                : Math.max(0, actualLoad - (target?.targetLoad || 0));
            loadCap = Math.max(sum(frozen.map(w => w.targetLoad)), loadCap - excess);
        }
        const frozenMinutes = sum(frozen.map(w => w.duration / 60));
        const frozenLoad = sum(frozen.map(w => w.targetLoad));
        let usedMinutes = frozenMinutes, usedLoad = frozenLoad;
        const recoveryLoadPerMinute = FAMILIES.recovery.power ** 2 * 100 / 60;
        const intended = future.map(workout => {
            const baseline = workout.original ?? workout;
            const factor = workout.date <= windowEnd ? reduction : 1;
            const minutes = baseline.duration / 60 * factor;
            const easy = factor < 1 && reduceIntensity;
            return {minutes, load: easy ? minutes * recoveryLoadPerMinute : baseline.targetLoad * factor};
        });
        // Share a capped week across all remaining sessions instead of dropping or downgrading the last ones.
        const weekScale = Math.max(0, Math.min(1,
            (minuteCap - usedMinutes) / Math.max(1e-9, sum(intended.map(i => i.minutes))),
            (loadCap - usedLoad) / Math.max(1e-9, sum(intended.map(i => i.load)))));
        const pristine = future.map(w => JSON.parse(JSON.stringify(w)));
        const startWorkouts = next.workouts.slice(), startChanges = changes.length;
        const fill = scale => {
        future.forEach((w, i) => {
            Object.keys(w).forEach(key => delete w[key]);
            Object.assign(w, JSON.parse(JSON.stringify(pristine[i])));
        });
        next.workouts = startWorkouts.slice();
        changes.length = startChanges;
        usedMinutes = frozenMinutes;
        usedLoad = frozenLoad;
        for(const [futureIndex, workout] of future.entries()) {
            const previous = JSON.parse(JSON.stringify(workout));
            const baseline = workout.original ?? workout;
            const factor = workout.date <= windowEnd ? reduction : 1;
            const minutes = Math.floor(Math.min(baseline.duration / 60 * factor * scale, minuteCap - usedMinutes) + 0.000001);
            const forceEasy = factor < 1 && reduceIntensity;
            const family = forceEasy ? 'recovery' : baseline.family;
            const loadPerMinute = forceEasy ? FAMILIES.recovery.power ** 2 * 100 / 60
                : baseline.targetLoad / (baseline.duration / 60);
            const fitMinutes = Math.min(minutes, Math.floor((loadCap - usedLoad + 0.000001) / loadPerMinute));
            if(fitMinutes < config.minimumSessionMinutes) {
                next.workouts = next.workouts.filter(w => w.id !== workout.id);
                changes.push({id: workout.id, action: 'removed', previous, current: null});
                continue;
            }
            const successes = (plan.progressionBaseline?.[baseline.family] || 0) +
                next.workouts.filter(w => w.date <= date && w.family === baseline.family &&
                    ['completed', 'substituted'].includes(w.status) &&
                    w.completionQuality >= config.progressionMinimumQuality).length;
            const earnedLevel = Math.min(config.progressionMaximumLevel,
                1 + Math.floor(successes / config.progressionSuccessfulSessionsPerLevel));
            const progressionLevel = ['completed', 'substituted'].includes(trigger) && reduction === 1
                ? Math.max(baseline.progressionLevel, earnedLevel) : baseline.progressionLevel;
            const slot = {
                id: workout.id, date: workout.date, minutes: fitMinutes, family,
                level: forceEasy ? 1 : progressionLevel, phaseId: workout.phaseId,
                weekId: workout.weekId, phaseType: week.phaseType, profile, rules: config,
            };
            // Keep the planned library workout and shorten it rather than swapping the session.
            const unchanged = fitMinutes * 60 === workout.duration && family === workout.family &&
                progressionLevel === workout.progressionLevel;
            const sessionBudget = loadCap - usedLoad - sum(intended.slice(futureIndex + 1).map(i => i.load)) * scale;
            let modified = unchanged ? {...workout} : prescribeWorkout(slot, {
                history: next.workouts.filter(w => w.date < workout.date),
                prefer: baseline.libraryWorkoutId ?? workout.libraryWorkoutId, rules: config,
                maxLoad: Math.max(sessionBudget, fitMinutes * recoveryLoadPerMinute),
            });
            // Prefer a shorter session of the planned family over downgrading it to recovery.
            for(let shorter = fitMinutes - 5; !forceEasy && family !== 'recovery' &&
                usedLoad + modified.targetLoad > loadCap + 0.01 && shorter >= config.minimumSessionMinutes; shorter -= 5) {
                modified = prescribeWorkout({...slot, minutes: shorter}, {
                    history: next.workouts.filter(w => w.date < workout.date),
                    prefer: baseline.libraryWorkoutId ?? workout.libraryWorkoutId, rules: config,
                    maxLoad: Math.min(loadCap - usedLoad, baseline.targetLoad),
                });
            }
            if(usedLoad + modified.targetLoad > loadCap + 0.01) {
                let recoveryMinutes = Math.min(fitMinutes,
                    Math.floor((loadCap - usedLoad + 0.000001) / recoveryLoadPerMinute));
                if(recoveryMinutes < config.minimumSessionMinutes) {
                    next.workouts = next.workouts.filter(w => w.id !== workout.id);
                    changes.push({id: workout.id, action: 'removed', previous, current: null});
                    continue;
                }
                modified = progressWorkout({...slot, minutes: recoveryMinutes, family: 'recovery', level: 1});
                while(recoveryMinutes >= config.minimumSessionMinutes &&
                      usedLoad + modified.targetLoad > loadCap + 0.01) {
                    recoveryMinutes--;
                    if(recoveryMinutes < config.minimumSessionMinutes) break;
                    modified = progressWorkout({...slot, minutes: recoveryMinutes, family: 'recovery', level: 1});
                }
                if(recoveryMinutes < config.minimumSessionMinutes) {
                    next.workouts = next.workouts.filter(w => w.id !== workout.id);
                    changes.push({id: workout.id, action: 'removed', previous, current: null});
                    continue;
                }
            }
            const reservedLoad = sum(future.slice(futureIndex + 1).map(w => w.targetLoad));
            const progressionHeadroom = Math.max(0, loadCap - usedLoad - workout.targetLoad - reservedLoad);
            if(progressionLevel > baseline.progressionLevel &&
               (modified.targetLoad - workout.targetLoad > progressionHeadroom + 0.01 ||
                JSON.stringify(modified.steps) === JSON.stringify(workout.steps))) {
                modified = prescribeWorkout({...slot, level: baseline.progressionLevel}, {
                    history: next.workouts.filter(w => w.date < workout.date),
                    prefer: baseline.libraryWorkoutId ?? workout.libraryWorkoutId, rules: config,
                });
            }
            const restored = !forceEasy && factor === 1 && modified.family === baseline.family &&
                modified.duration === baseline.duration;
            if(restored) delete modified.original;
            else {
                const {until: _until, factor: _factor, easy: _easy, ...base} = workout.original ?? {
                    family: workout.family, duration: workout.duration, targetLoad: workout.targetLoad,
                    progressionLevel: workout.progressionLevel, libraryWorkoutId: workout.libraryWorkoutId ?? null};
                modified.original = factor < 1 ? {...base, until: windowEnd, factor, easy: forceEasy} : base;
            }
            modified.adaptationNotes = [...workout.adaptationNotes];
            const progressed = modified.progressionLevel > baseline.progressionLevel;
            const changed = modified.duration !== workout.duration || modified.family !== workout.family ||
                modified.progressionLevel !== workout.progressionLevel ||
                JSON.stringify(modified.steps) !== JSON.stringify(workout.steps);
            if(changed) {
                modified.adaptationNotes.push(progressed
                    ? `Progressed after ${successes} successful ${baseline.family} sessions, within the remaining weekly load budget.`
                    : restored && workout.original ? 'Restored to the planned session after the short-term adjustment ended.'
                        : explainAdaptation(trigger, reduction));
                Object.assign(workout, modified);
                if(restored) delete workout.original;
                changes.push({id: workout.id, action: 'modified', previous, current: {...workout}});
            } else if(restored) {
                delete workout.original;
            } else if(workout.original || factor < 1) {
                // Same dose, but the reduction window/strictness metadata must still be current.
                workout.original = modified.original;
            }
            usedMinutes += workout.duration / 60;
            usedLoad += workout.targetLoad;
        }
        return {
            load: usedLoad,
            downgraded: future.filter((w, i) => next.workouts.includes(w) && w.family !== pristine[i].family &&
                !(w.date <= windowEnd && reduceIntensity)).length + future.filter(w => !next.workouts.includes(w)).length,
        };
        };
        // Shortened templates often carry less load than a proportional cut; use the week's remaining
        // budget so one reduction does not compound through every later ramp check.
        let best = {scale: weekScale, ...fill(weekScale)};
        for(let scale = weekScale * 1.04; weekScale < 1 && best.load < loadCap * 0.98 && scale > 0 && scale < 1.25; scale *= 1.04) {
            const result = fill(Math.min(1, scale));
            if(result.downgraded <= best.downgraded && result.load > best.load + 0.01) best = {scale: Math.min(1, scale), ...result};
            if(scale >= 1) break;
        }
        fill(best.scale);
        week.scheduledMinutes = usedMinutes;
        week.scheduledLoad = round(usedLoad);
        history.push(rampReference(week, usedMinutes, usedLoad));
    }
    next.revision++;
    next.sourceSnapshot = state.id;
    next.validationWarnings = validatePlan(next, profile, config);
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
