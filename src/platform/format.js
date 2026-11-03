import { addDays, localDay } from '../coaching/domain.js';

export const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export const minutes = seconds => `${Math.round(seconds / 60)} min`;
export const number = (value, digits = 0) => Number.isFinite(value)
    ? value.toLocaleString(undefined, {maximumFractionDigits: digits}) : '--';
export const time = seconds => {
    if(!Number.isFinite(seconds)) return '--:--';
    const value = Math.max(0, Math.floor(seconds));
    return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};
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
    if(!steps.length) return '<p class="muted">Free ride or course-based workout</p>';
    return `<div class="profile-graph" role="img" aria-label="Workout target power profile">
        ${steps.map(step => `<span style="flex-grow:${Number(step.duration) || 1};
            height:${Math.max(8, Math.min(100, (Number(step.power) || 0) < 9
                ? (Number(step.power) || 0) * 62 : Number(step.power) / 5))}%;
            --bar:${Number(step.power) > 1 ? '#f5ad65' : Number(step.power) > 0.75 ? '#9a99ff' : '#52d9b2'}"></span>`).join('')}</div>`;
}
