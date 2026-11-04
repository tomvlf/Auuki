/*
 * explanations.js: front-end client module.
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

export function explainPhase(type, focus) {
    const reasons = {
        assessment: 'Establish a conservative baseline without requiring a maximal test.',
        preparation: 'Reintroduce consistent, manageable riding.',
        base: 'Develop repeatable easy volume before demanding work.',
        build: 'Gradually develop the highest-priority goal capabilities.',
        specific: 'Practice demands relevant to the dated goal.',
        peak: 'Maintain specificity without adding volume.',
        taper: 'Reduce volume before the goal; do not make up missed work.',
        event: 'Goal day; event demands are not counted as prescribed training.',
        recovery: 'Planned reduction in training demand to support recovery.',
    };
    return `${reasons[type]} Focus: ${focus.join(', ')}.`;
}
export function explainWeek(week, state) {
    return `${week.phaseType}: ${week.targetMinutes} minutes, at most ${week.targetLoad} modelled power-load points. ` +
        `Based on ${Math.round(state.baselineWeeklyMinutes)} historical weekly minutes, availability and a ` +
        `${Math.round(week.rampLimit * 100)}% maximum increase over the prior four-week scheduled envelope ` +
        '(planned recovery weeks may return to that envelope). ' +
        `Confidence: ${state.confidence}. ` +
        'These are conservative planning heuristics, not physiological guarantees.';
}
export function explainWorkout(family, phaseType, level) {
    return `${family} supports ${phaseType} objectives; progression level ${level}. ` +
        'Stop or reduce the session if it feels inappropriate; missed work is never stacked into later days.';
}
export function explainAdaptation(trigger, reduction) {
    return `${trigger}: future training ${reduction < 1 ? `reduced by ${Math.round((1 - reduction) * 100)}%` : 'reviewed without automatic escalation'}. ` +
        'Past workouts remain unchanged. No catch-up sessions are added; availability, spacing and load limits are revalidated.';
}
