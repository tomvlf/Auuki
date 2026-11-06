import { rideTimeline, ridePosition, rideProfile } from '../../src/platform/ride.js';

const watts = (power, ftp) => power < 9 ? Math.round(power * ftp) : power;
const workout = {intervals: [
    {duration: 120, steps: [{duration: 60, power: .5, cadence: 80}, {duration: 60, power: .75, cadence: 90}]},
    {duration: 60, steps: [{duration: 60, power: 300}]},
]};

test('power timeline uses exact timed steps, absolute watts and cadence rather than sensor readings', () => {
    const timeline = rideTimeline(workout, 200, watts);
    expect(timeline.duration).toBe(180);
    expect(timeline.maximumPower).toBe(300);
    expect(timeline.intervals.map(interval => interval.start)).toEqual([0, 120]);
    expect(timeline.intervals.flatMap(interval => interval.steps.map(step => step.power))).toEqual([100, 150, 300]);
    const graph = rideProfile(timeline);
    expect(graph).toContain('1:00 / 150 W / 90 rpm');
    expect(graph).toContain('id="ride-profile-cursor"');
    expect(graph).not.toMatch(/NaN|Infinity|undefined/);
});

test('position follows the workout timeline through steps, pause, skip, recovery and completion', () => {
    const timeline = rideTimeline(workout, 200, watts);
    expect(ridePosition(timeline, {workoutStatus: 'stopped', elapsed: 900})).toBe(0);
    expect(ridePosition(timeline, {workoutStatus: 'started', intervalIndex: 0, stepIndex: 1, lapTime: 30})).toBe(90);
    expect(ridePosition(timeline, {workoutStatus: 'started', watchStatus: 'paused', intervalIndex: 0, lapTime: 30})).toBe(90);
    expect(ridePosition(timeline, {workoutStatus: 'started', intervalIndex: 1, lapTime: 60, elapsed: 5})).toBe(120);
    expect(ridePosition(timeline, {workoutStatus: 'started', intervalIndex: 1, lapTime: -5})).toBe(180);
    expect(ridePosition(timeline, {workoutStatus: 'started', intervalIndex: 1, lapTime: 100})).toBe(120);
    expect(ridePosition(timeline, {workoutStatus: 'done'})).toBe(180);
});

test('free rides and distance-based courses do not invent a timed power profile', () => {
    expect(rideTimeline({}, 200, watts)).toBeNull();
    expect(rideTimeline({intervals: [{steps: [{distance: 100, slope: 3}]}]}, 200, watts)).toBeNull();
    expect(rideTimeline({intervals: [{steps: [{duration: NaN, power: 1}]}]}, 200, watts)).toBeNull();
    expect(ridePosition(null, {})).toBe(0);
    expect(rideProfile(null)).toContain('No timed power profile');
    const withoutPower = rideTimeline({intervals: [{steps: [{duration: 60, slope: 3}]}]}, 200, watts);
    expect(rideProfile(withoutPower)).toContain('No power target');
    const unavailableFtp = rideTimeline({intervals: [{steps: [{duration: 60, power: .5}]}]}, undefined, watts);
    expect(rideProfile(unavailableFtp)).not.toMatch(/NaN|Infinity|undefined/);
});
