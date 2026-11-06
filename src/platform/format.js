/*
 * format.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { addDays, localDay } from '../coaching/domain.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const mobileDetails = (id, title, body) => `<details class="mobile-details" data-mobile-details="${escape(id)}" open>
    <summary>${escape(title)}</summary><div class="mobile-details-body">${body}</div></details>`;
export const minutes = seconds => `${Math.round(seconds / 60)} min`;
export const number = (value, digits = 0) => Number.isFinite(value)
    ? value.toLocaleString(undefined, {maximumFractionDigits: digits}) : '--';
export const time = seconds => {
    if(!Number.isFinite(seconds)) return '--:--';
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
export function cadenceSummary(steps) {
    const targets = steps.map(step => step.cadence).filter(value => Number.isFinite(value) && value > 0);
    if(!targets.length) return 'Self-selected';
    const min = Math.min(...targets), max = Math.max(...targets);
    const range = min === max ? `${number(min)} rpm` : `${number(min)}–${number(max)} rpm`;
    return targets.length < steps.length ? `${range} / self-selected` : range;
}
export const today = data => localDay(new Date().toISOString(),
    data?.profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone);

export function trainingSummary(data, day = today(data)) {
    const rides = (data?.activities || []).filter(a => a.sport === 'cycling' && a.day <= day);
    const week = rides.filter(a => a.day > addDays(day, -7));
    const plan = data?.plan?.status === 'archived' ? null : data?.plan;
    const due = (plan?.workouts || []).filter(w => w.date <= day);
    const completed = due.filter(w => ['completed', 'substituted'].includes(w.status));
    return {
        rides, week, seconds: week.reduce((total, a) => total + a.duration, 0),
        adherence: due.length ? completed.length / due.length : null,
        completed: completed.length, due: due.length,
        upcoming: (plan?.workouts || []).filter(w => w.status === 'scheduled' && w.date >= day),
        days: Array.from({length: 7}, (_, index) => {
            const date = addDays(day, index - 6);
            return {date, seconds: week.filter(a => a.day === date).reduce((total, a) => total + a.duration, 0)};
        }),
    };
}

export function profileGraph(workout) {
    const steps = (workout.intervals || []).flatMap(interval => interval.steps || []);
    if(!steps.length) {
        const source = Array.isArray(workout.pointsSimplified) && workout.pointsSimplified.length
            ? workout.pointsSimplified : Array.isArray(workout.points) ? workout.points : [];
        const points = source.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.y));
        if(points.length < 2) return '<p class="muted">Free ride or course-based workout</p>';
        const bounds = points.reduce((range, point) => ({
            min: Math.min(range.min, point.y), max: Math.max(range.max, point.y),
        }), {min: points[0].y, max: points[0].y});
        const count = Math.min(points.length, 128);
        const firstX = points[0].x, distance = points[points.length - 1].x - firstX;
        const coordinates = Array.from({length: count}, (_, index) => {
            const point = points[Math.round(index * (points.length - 1) / (count - 1))];
            const x = distance > 0 ? Math.max(0, Math.min(100, (point.x - firstX) / distance * 100)) :
                index * 100 / (count - 1);
            const y = bounds.max === bounds.min ? 24 : 44 - (point.y - bounds.min) / (bounds.max - bounds.min) * 36;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
        }).join(' ');
        return `<div class="course-profile" role="img" aria-label="Course elevation profile">
            <svg viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
                <polygon points="0,48 ${coordinates} 100,48"></polygon><polyline points="${coordinates}"></polyline>
            </svg></div>`;
    }
    return `<div class="profile-graph" role="img" aria-label="Workout target power profile">
        ${steps.map(step => `<span style="flex-grow:${Number(step.duration) || 1};
            height:${Math.max(8, Math.min(100, (Number(step.power) || 0) < 9
                ? (Number(step.power) || 0) * 62 : Number(step.power) / 5))}%;
            --bar:${Number(step.power) > 1 ? '#f5ad65' : Number(step.power) > 0.75 ? '#9a99ff' : '#52d9b2'}"></span>`).join('')}</div>`;
}
