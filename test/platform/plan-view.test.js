import { renderPlan } from '../../src/platform/plan-view.js';

const workout = (id, date, family, status = 'scheduled', weekId = 'week-1') =>
    ({id, date, family, status, weekId, title: `${family} 60 min`, duration: 3600, expectedRpe: 3});
const weeks = Array.from({length: 7}, (_, i) => {
    const start = new Date(Date.UTC(2026, 10, 2 + i * 7));
    const end = new Date(start.getTime() + 6 * 86400000);
    return {id: `week-${i + 1}`, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10),
        phaseType: i === 2 ? 'recovery' : 'base', rationale: 'base: technical week rationale'};
});
const data = {
    goal: {name: 'Spring sportive', type: 'gran_fondo', priority: 'A'},
    plan: {
        status: 'active', revision: 3, startDate: '2026-11-02', endDate: '2026-12-20', rationale: 'gran_fondo: technical planner text',
        phases: [
            {id: 'p1', type: 'base', startDate: '2026-11-02', endDate: '2026-11-15', rationale: 'Develop easy volume.'},
            {id: 'p2', type: 'recovery', startDate: '2026-11-16', endDate: '2026-11-22', rationale: 'Absorb training.'},
            {id: 'p3', type: 'base', startDate: '2026-11-23', endDate: '2026-12-19', rationale: 'Develop easy volume.'},
            {id: 'p4', type: 'event', startDate: '2026-12-20', endDate: '2026-12-20', rationale: 'Goal.'},
        ],
        weeks,
        workouts: [
            workout('a', '2026-11-03', 'endurance', 'completed'),
            workout('b', '2026-11-10', 'endurance', 'scheduled', 'week-2'),
            workout('c', '2026-11-12', 'threshold', 'scheduled', 'week-2'),
            workout('d', '2026-11-14', 'durability', 'scheduled', 'week-2'),
            ...weeks.slice(2).map((w, i) => workout(`w${i}`, w.startDate, 'endurance', 'scheduled', w.id)),
        ],
        adaptations: [{timestamp: '2026-11-04T08:00:00Z', reasoning: 'Reduced volume after a hard ride.'}],
    },
};

test('shows an inviting empty state when there is no plan', () => {
    const html = renderPlan({plan: null}, '2026-11-12');
    expect(html).toContain('No training plan yet');
    expect(html).toContain('Create your training plan');
});

test('leads with goal progress, current phase and the next session in plain language', () => {
    const html = renderPlan(data, '2026-11-12');
    expect(html).toContain('Spring sportive');
    expect(html).toContain('Gran fondo');
    expect(html).toContain('Days to go');
    expect(html).toMatch(/2<small>\/7<\/small>/);
    expect(html).toContain('Building endurance');
    expect(html).toContain('Prepare to ride');
    expect(html).toContain('href="#/workout/c"');
    expect(html).not.toContain('revision');
    expect(html.indexOf('technical planner text')).toBeGreaterThan(html.indexOf('How this plan was built'));
});

test('groups sessions by week with this week open and older weeks folded away', () => {
    const html = renderPlan(data, '2026-11-12');
    const thisWeek = html.match(/<details class="plan-week current" open>[\s\S]*?<\/details>/)[0];
    expect(thisWeek).toContain('This week');
    expect(thisWeek).toContain('Threshold intervals');
    expect(thisWeek).toContain('Long ride');
    expect(thisWeek).toContain('Key session');
    expect(thisWeek).toContain('Not yet logged');
    expect(thisWeek).toContain('3 rides');
    expect(html).toContain('Earlier weeks (1)');
    expect(html).toContain('Later weeks (1)');
    expect(html).toContain('Recovery week');
    expect(html).toContain('Recent changes to your plan (1)');
});

test('archived plans point the rider back to the Coach', () => {
    const html = renderPlan({...data, plan: {...data.plan, status: 'archived'}}, '2026-11-12');
    expect(html).toContain('This plan has been archived');
    expect(html).not.toContain('Prepare to ride');
});
