/*
 * planner.js: front-end client module.
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

import { VERSION, GOALS, addDays, daysBetween, weekday, sum, round,
    validateProfile, validateGoal, validateCoachingConfig } from './domain.js';
import { modelGoalDemand, analyzeGaps } from './demands.js';
import { progressWorkout, FAMILIES, stepLoad } from './workouts.js';
import { prescribeWorkout } from './library.js';
import { explainPhase, explainWeek } from './explanations.js';

/**
 * Splits the goal timeline into training phases with a clear purpose and focus.
 *
 * The periodisation logic groups a goal into preparation, build, specific, peak, taper,
 * and recovery blocks so that the scheduler can allocate training stress thoughtfully.
 *
 * @param {string} startDate - Plan start date in YYYY-MM-DD format.
 * @param {object} goal - Active athlete goal and objective data.
 * @param {object} state - Derived athlete state used for readiness and capacity decisions.
 * @param {object} gaps - Capability priorities and weaknesses discovered from recent state analysis.
 * @returns {Array<object>} Period blocks that define the time-based plan structure.
 */
export function periodise(startDate, goal, state, gaps) {
    const total = daysBetween(startDate, goal.date);
    const focus = gaps.priorities.slice(0, 2).map(p => p.capability);
    const days = [];
    for(let i = 0; i <= total; i++) {
        const remaining = total - i;
        const fraction = i / total;
        let type;
        if(remaining === 0) type = 'event';
        else if(remaining <= (goal.priority === 'A' ? state.config.taperDaysPriorityA
            : goal.priority === 'B' ? state.config.taperDaysPriorityB : state.config.taperDaysPriorityC)) type = 'taper';
        else if(total < 21) type = 'preparation';
        else if(i < 7 && state.sufficiency !== 'supported') type = 'assessment';
        else if(Math.floor(i / 7) % state.config.recoveryWeekInterval === state.config.recoveryWeekOffset) type = 'recovery';
        else if(fraction < state.config.basePhaseEndFraction) type = 'base';
        else if(fraction < state.config.buildPhaseEndFraction) type = 'build';
        else if(remaining > state.config.specificPhaseMinimumDays) type = 'specific';
        else type = 'peak';
        const day = addDays(startDate, i);
        const previous = days.at(-1);
        if(previous?.type === type) previous.endDate = day;
        else days.push({id: `phase-${days.length + 1}`, type, startDate: day, endDate: day,
            primaryCapabilities: focus, secondaryCapabilities: gaps.priorities.slice(2).map(p => p.capability),
            targetVolumeRange: [0, 0], targetLoadRange: [0, 0],
            targetIntensityDistribution: {easy: 0.8, moderate: 0.15, hard: 0.05},
            rationale: explainPhase(type, focus)});
    }
    return days;
}

/**
 * Builds the weekly target envelope for each week in the plan.
 *
 * This keeps the schedule within realistic training capacity while allowing controlled
 * ramping. The model uses recent load and athlete readiness to prevent over-ambitious
 * increases in minutes and load.
 *
 * @param {string} startDate - Plan start date.
 * @param {object} goal - Goal metadata and priority.
 * @param {object} state - Estimated athlete state.
 * @param {object} profile - Session availability and weekly capacity limits.
 * @param {Array<object>} phases - Period blocks for the plan.
 * @returns {Array<object>} Weekly target objects with minutes, load, phase, and rationale.
 */
export function weeklyTargets(startDate, goal, state, profile, phases) {
    const config = validateCoachingConfig(state.config);
    const capacity = Math.min(profile.maxWeeklyHours * 60, profile.typicalWeeklyHours * 60,
        sum(profile.availableDays.map(d => profile.maxSessionMinutes[d])));
    const ramp = state.confidence === 'medium' && state.readiness.status !== 'caution'
        ? config.maxRamp : config.lowDataRamp;
    const sufficient = state.confidence === 'medium';
    const historical = state.baselineWeeklyMinutes > 0
        ? Math.min(state.baselineWeeklyMinutes, state.weeklyDuration || config.initialMinutes)
        : config.initialMinutes;
    // Insufficient history (e.g. one short test ride) must not start below the no-history default.
    let previous = Math.min(capacity, sufficient ? historical : Math.max(historical, config.initialMinutes));
    if(state.readiness.status === 'caution') previous *= config.readinessVolumeFactor;
    let previousLoad = previous / 60 * config.initialLoadPower ** 2 * 100;
    if(sufficient && state.loadSource === 'power' && state.activityCount) {
        const baseline = sum(state.dailyLoad.slice(-state.config.mediumDays).map(d => d.load)) / (state.config.mediumDays / 7);
        previousLoad = Math.min(previousLoad, baseline, state.weeklyLoad);
    }
    const weeks = [];
    for(let offset = 0; offset < daysBetween(startDate, goal.date); offset += 7) {
        const start = addDays(startDate, offset);
        const end = addDays(start, Math.min(6, daysBetween(start, goal.date) - 1));
        const phase = phases.find(p => p.startDate <= start && p.endDate >= start);
        const available = Array.from({length: daysBetween(start, end) + 1}, (_, i) => addDays(start, i))
            .filter(d => profile.availableDays.includes(weekday(d)));
        const minutesCap = Math.min(capacity, sum(available.map(d => profile.maxSessionMinutes[weekday(d)])));
        const taper = daysBetween(end, goal.date) <= (goal.priority === 'A' ? config.taperDaysPriorityA
            : goal.priority === 'B' ? config.taperDaysPriorityB : config.taperDaysPriorityC);
        const recovery = phase.type === 'recovery';
        const factor = taper ? config.taperFactor : recovery ? config.recoveryFactor : weeks.length ? 1 + ramp : 1;
        // A planned deload can return to the last four weeks' envelope, not exceed it abruptly.
        const referenceMinutes = Math.max(previous, ...weeks.slice(-4).map(w => w.targetMinutes));
        const referenceLoad = Math.max(previousLoad, ...weeks.slice(-4).map(w => w.targetLoad));
        const targetMinutes = Math.floor(Math.min(minutesCap, referenceMinutes * factor));
        const targetLoad = round(Math.min(targetMinutes / 60 * config.weeklyPlanningLoadPower ** 2 * 100,
            referenceLoad * factor));
        const week = {id: `week-${weeks.length + 1}`, startDate: start, endDate: end,
            phaseId: phase.id, phaseType: taper ? 'taper' : phase.type,
            targetMinutes, targetLoad, rampLimit: ramp, focus: phase.primaryCapabilities,
            targetIntensityDistribution: {easy: 0.8, moderate: 0.15, hard: 0.05},
            scheduledMinutes: 0, scheduledLoad: 0, rationale: ''};
        week.rationale = explainWeek(week, state);
        weeks.push(week);
        previous = targetMinutes;
        previousLoad = targetLoad;
    }
    return weeks;
}

/**
 * Turns weekly targets and training phases into concrete workout slots.
 *
 * The scheduler allocates minutes to available training days, chooses workout families
 * based on the active phase and athlete readiness, and keeps a realistic rhythm so the
 * plan remains actionable instead of becoming an impossible stress curve.
 *
 * @param {Array<object>} weeks - Weekly target objects.
 * @param {Array<object>} phases - Period blocks in the plan.
 * @param {object} profile - Athlete availability and session constraints.
 * @param {object} state - Athlete readiness and training state.
 * @param {object} gaps - Capability and objective gaps that shape workout types.
 * @param {string} planId - Unique plan identifier used when building workout IDs.
 * @returns {Array<object>} The concrete workout schedule for the full plan.
 */
export function scheduleWorkouts(weeks, phases, profile, state, gaps, planId) {
    const config = validateCoachingConfig(state.config);
    const workouts = [];
    let lastHard = null;
    const scheduledHistory = [];
    for(const week of weeks) {
        const available = Array.from({length: daysBetween(week.startDate, week.endDate) + 1}, (_, i) =>
            addDays(week.startDate, i)).filter(d => profile.availableDays.includes(weekday(d)));
        // Allocate long-ride capacity first, then spread remaining minutes across other days.
        const ordered = [...available].sort((a, b) =>
            Number(weekday(b) === profile.longRideDay) - Number(weekday(a) === profile.longRideDay) || a.localeCompare(b));
        let budget = Math.min(week.targetMinutes,
            !scheduledHistory.length ? Infinity : Math.floor(Math.max(...scheduledHistory.slice(-4).map(w => w.minutes)) * (1 + week.rampLimit)));
        const loadBudget = Math.min(week.targetLoad,
            !scheduledHistory.length ? Infinity : Math.max(...scheduledHistory.slice(-4).map(w => w.load)) * (1 + week.rampLimit));
        const allocations = new Map();
        ordered.forEach((day, i) => {
            const long = weekday(day) === profile.longRideDay;
            const share = long && ordered.length > 1
                ? Math.ceil(budget * config.longRideAllocationShare) : Math.floor(budget / (ordered.length - i));
            const minutes = Math.min(profile.maxSessionMinutes[weekday(day)], share);
            allocations.set(day, minutes >= config.minimumSessionMinutes ? minutes : 0);
            budget -= minutes >= config.minimumSessionMinutes ? minutes : 0;
        });
        let hardCount = 0, weekLoad = 0;
        const maxHard = state.sufficiency === 'supported' && state.readiness.status !== 'caution'
            ? profile.experience === 'beginner' ? config.beginnerHardSessionsPerWeek
                : config.experiencedHardSessionsPerWeek : 0;
        for(const day of available) {
            const minutes = allocations.get(day);
            if(!minutes) continue;
            const phase = phases.find(p => p.startDate <= day && p.endDate >= day);
            const canHard = ['build', 'specific', 'peak'].includes(phase.type) &&
                hardCount < maxHard && minutes >= config.minimumHardSessionMinutes &&
                (lastHard == null || daysBetween(lastHard, day) >= config.minimumHardSeparationDays) &&
                weekday(day) !== profile.longRideDay;
            const focus = gaps.priorities.find(p => FAMILIES[p.capability]?.hard)?.capability || 'threshold';
            const family = phase.type === 'recovery' || phase.type === 'taper' || state.readiness.status === 'caution'
                ? 'recovery' : canHard ? focus : weekday(day) === profile.longRideDay ? 'durability' : 'endurance';
            const successful = state.successfulSessionsByFamily?.[family] || 0;
            const level = Math.min(config.progressionMaximumLevel,
                1 + Math.floor(successful / config.progressionSuccessfulSessionsPerLevel));
            const slot = {id: `${planId}:${day}`, date: day, minutes, family, level,
                phaseId: phase.id, weekId: week.id, phaseType: phase.type, profile, rules: config};
            let workout = prescribeWorkout(slot, {history: workouts, rules: config, allowTechnique: true});
            // First use a lighter version of the same session, then reduce intensity, then duration;
            // never force the target into an unavailable day.
            if(weekLoad + workout.targetLoad > loadBudget && workout.libraryWorkoutId) {
                workout = progressWorkout(slot);
            }
            if(weekLoad + workout.targetLoad > loadBudget) {
                workout = prescribeWorkout({...slot, family: 'recovery', level: 1}, {history: workouts, rules: config});
            }
            if(weekLoad + workout.targetLoad > loadBudget && workout.libraryWorkoutId) {
                workout = progressWorkout({...slot, family: 'recovery', level: 1});
            }
            if(weekLoad + workout.targetLoad > loadBudget) {
                const fitMinutes = Math.floor((loadBudget - weekLoad) /
                    (FAMILIES.recovery.power ** 2 * 100) * 60);
                if(fitMinutes < config.minimumSessionMinutes) continue;
                workout = progressWorkout({id: workout.id, date: day, minutes: Math.min(minutes, fitMinutes),
                    family: 'recovery', phaseId: phase.id, weekId: week.id, phaseType: phase.type, profile,
                    rules: config});
            }
            if(FAMILIES[workout.family].hard) {
                hardCount++;
                lastHard = day;
            }
            workouts.push(workout);
            weekLoad += workout.targetLoad;
        }
        const scheduled = workouts.filter(w => w.weekId === week.id);
        week.scheduledMinutes = sum(scheduled.map(w => w.duration / 60));
        week.scheduledLoad = round(sum(scheduled.map(w => w.targetLoad)));
        scheduledHistory.push({minutes: week.scheduledMinutes, load: week.scheduledLoad});
    }
    return workouts;
}

/**
 * Ramp reference for a week: what was scheduled, or the originally validated dose when a
 * short-term adaptation scheduled less. Returning to the validated plan after a temporary
 * reduction is treated like returning from a recovery week, never as growth beyond it.
 *
 * @param {object} week - Plan week, optionally with `plannedMinutes`/`plannedLoad`.
 * @param {number} minutes - Minutes currently scheduled in the week.
 * @param {number} load - Load currently scheduled in the week.
 * @returns {{minutes: number, load: number}} Reference used by the next weeks' ramp ceiling.
 */
export function rampReference(week, minutes, load) {
    const planned = (value, target) => Number.isFinite(value) ? Math.min(value, target) : 0;
    return {
        minutes: Math.max(minutes, planned(week.plannedMinutes, week.targetMinutes)),
        load: Math.max(load, planned(week.plannedLoad, week.targetLoad)),
    };
}

export function validatePlan(plan, profile, rules = plan.coachingConfig) {
    const config = validateCoachingConfig(rules);
    validateProfile(profile);
    const errors = [], warnings = [];
    if(plan.startDate >= plan.endDate || !plan.phases.length || !plan.weeks.length ||
       plan.phases[0].startDate !== plan.startDate || plan.phases.at(-1).endDate !== plan.endDate ||
       plan.phases.at(-1).type !== 'event' ||
       plan.phases.some((p, i) => p.startDate > p.endDate ||
           (i > 0 && p.startDate !== addDays(plan.phases[i - 1].endDate, 1)))) {
        errors.push('Invalid phase coverage.');
    }
    const ids = new Set(), dates = new Set();
    const hard = [];
    for(const w of plan.workouts) {
        if(ids.has(w.id) || dates.has(w.date)) errors.push('Duplicate workout identity or date.');
        ids.add(w.id); dates.add(w.date);
        if(w.date < plan.startDate || w.date >= plan.endDate) errors.push('Workout outside training dates.');
        const phase = plan.phases.find(p => p.id === w.phaseId);
        const week = plan.weeks.find(p => p.id === w.weekId);
        if(!phase || w.date < phase.startDate || w.date > phase.endDate ||
           !week || w.date < week.startDate || w.date > week.endDate) errors.push('Invalid phase/week relationship.');
        if(!profile.availableDays.includes(weekday(w.date)) ||
           w.duration / 60 > profile.maxSessionMinutes[weekday(w.date)]) errors.push('Workout exceeds daily availability.');
        if(!FAMILIES[w.family] || !['scheduled', 'completed', 'missed', 'failed', 'substituted'].includes(w.status) ||
           !Number.isFinite(w.duration) || w.duration < config.minimumSessionMinutes * 60 || !w.steps.length ||
           w.steps.some(s => !Number.isInteger(s.duration) || s.duration <= 0 ||
               !Number.isFinite(s.power) ||                s.power < 0 || s.power > config.libraryMaximumPower) ||
           sum(w.steps.map(s => s.duration)) !== w.duration ||
           !Number.isFinite(w.targetIntensity) ||
           Math.abs(w.targetIntensity - Math.sqrt(stepLoad(w.steps) / (w.duration / 3600 * 100))) > 0.001 ||
           Math.abs(stepLoad(w.steps) - w.targetLoad) > 0.02) errors.push('Invalid workout steps or target load.');
        if(FAMILIES[w.family]?.hard) hard.push(w);
    }
    hard.sort((a, b) => a.date.localeCompare(b.date));
    if(hard.some((w, i) => i && daysBetween(hard[i - 1].date, w.date) < config.minimumHardSeparationDays)) errors.push('Hard workouts need an easy/rest day between.');
    const history = [];
    for(const week of plan.weeks) {
        const workouts = plan.workouts.filter(w => w.weekId === week.id);
        const minutes = sum(workouts.map(w => w.duration / 60));
        const load = sum(workouts.map(w => w.targetLoad));
        if(!Number.isFinite(week.targetMinutes) || week.targetMinutes < 0 ||
           !Number.isFinite(week.targetLoad) || week.targetLoad < 0 ||
           !Number.isFinite(week.rampLimit) || week.rampLimit < 0 || week.rampLimit > config.maxRamp ||
           minutes > profile.maxWeeklyHours * 60 || minutes > profile.typicalWeeklyHours * 60 ||
           minutes > week.targetMinutes + 0.01 || load > week.targetLoad + 0.05) errors.push('Weekly target or availability exceeded.');
        if(workouts.filter(w => FAMILIES[w.family]?.hard).length >
           (profile.experience === 'beginner' ? config.beginnerHardSessionsPerWeek : config.experiencedHardSessionsPerWeek)) errors.push('Too many hard workouts.');
        const hardSeconds = sum(workouts.flatMap(w => w.steps.filter(s => s.power > config.hardPowerThreshold)).map(s => s.duration));
        if(hardSeconds > minutes * 60 * config.weeklyHardTimeShare) errors.push('Weekly demanding interval time exceeded.');
        if(history.length) {
            // The pre-plan envelope stays a reference, so a short early reduction cannot cap the whole plan.
            const reference = [plan.initialLimits, ...history].slice(-4);
            const minuteCeiling = Math.max(...reference.map(w => w.minutes)) * (1 + week.rampLimit) + 0.01;
            const loadCeiling = Math.max(...reference.map(w => w.load)) * (1 + week.rampLimit) + 0.05;
            if(minutes > minuteCeiling || load > loadCeiling) {
                errors.push(`${week.id}: abrupt weekly progression exceeded (minutes ${round(minutes)}/${round(minuteCeiling)}, load ${round(load)}/${round(loadCeiling)}).`);
            }
        }
        if(!history.length && (minutes > plan.initialLimits.minutes + 0.01 ||
            load > plan.initialLimits.load + 0.05)) errors.push('Initial historical load envelope exceeded.');
        if(minutes < week.targetMinutes * 0.8) warnings.push(`${week.id}: target reduced to fit safe sessions and load.`);
        history.push(rampReference(week, minutes, load));
    }
    if(!plan.workouts.length) warnings.push('No safe session fits the supplied dates and availability.');
    if(daysBetween(plan.startDate, plan.endDate) < 21) warnings.push('Short lead time: preparation and taper only, no accelerated build.');
    if(errors.length) throw new Error(`Unsafe plan: ${[...new Set(errors)].join(' ')}`);
    return [...new Set(warnings)];
}

export function generatePlan({profile, goal, state, startDate, generatedAt, registry = GOALS}) {
    validateProfile(profile);
    const config = validateCoachingConfig(state.config);
    validateGoal(goal, startDate, registry, config);
    if(state.date !== startDate || state.athleteId !== profile.id || !Number.isFinite(Date.parse(generatedAt))) {
        throw new Error('Plan requires a state snapshot for its start date and an explicit generation timestamp.');
    }
    const demand = modelGoalDemand(goal, registry, config), gaps = analyzeGaps(state, demand, goal);
    const id = `${profile.id}:${goal.id}:${startDate}:${state.id}`;
    const phases = periodise(startDate, goal, state, gaps);
    const weeks = weeklyTargets(startDate, goal, state, profile, phases);
    const workouts = scheduleWorkouts(weeks, phases, profile, state, gaps, id);
    for(const week of weeks) {
        week.plannedMinutes = week.scheduledMinutes;
        week.plannedLoad = week.scheduledLoad;
    }
    for(const phase of phases) {
        const members = workouts.filter(w => w.phaseId === phase.id);
        phase.targetVolumeRange = [0, sum(members.map(w => w.duration / 60))];
        phase.targetLoadRange = [0, round(sum(members.map(w => w.targetLoad)))];
    }
    const plan = {
        id, athleteId: profile.id, goalId: goal.id, startDate, endDate: goal.date, status: 'active',
        goalDefinition: JSON.parse(JSON.stringify(goal)),
        plannerVersion: VERSION, generatedAt, sourceSnapshot: state.id, revision: 1,
        coachingConfig: JSON.parse(JSON.stringify(config)),
        progressionBaseline: JSON.parse(JSON.stringify(state.successfulSessionsByFamily || {})),
        rationale: `${demand.rationale} ${gaps.rationale} Training decision support, not medical advice.`,
        demand, gaps, phases, weeks, workouts, adaptations: [], validationWarnings: [],
        initialLimits: {minutes: weeks[0].targetMinutes, load: weeks[0].targetLoad},
    };
    plan.validationWarnings = validatePlan(plan, profile, config);
    return plan;
}
