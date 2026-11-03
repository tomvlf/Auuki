/** @jest-environment jsdom */
import { WorkoutGraph } from '../../src/views/workout-graph.js';

const workout = {meta: {duration: 120}, intervals: [
    {duration: 60, steps: [{duration: 60, power: .5}]},
    {duration: 60, steps: [{duration: 60, power: 1}]},
]};

test('hidden legacy graph tolerates live interval updates before its first visible render', () => {
    const graph = new WorkoutGraph();
    document.body.append(graph);
    graph.onWorkout(workout);
    expect(() => graph.onIntervalIndex(0)).not.toThrow();
    expect(() => graph.onLapTime(45)).not.toThrow();
    expect(() => graph.onMouseOut()).not.toThrow();
    graph.remove();
});

test('graph renders and updates progress after being revealed by the new player', () => {
    const graph = new WorkoutGraph();
    document.body.append(graph);
    graph.onWorkout(workout);
    graph.getBoundingClientRect = () => ({left: 0, width: 600, height: 150});
    graph.onFTP(250);
    graph.onWindowResize();
    expect(graph.dom.intervals).toHaveLength(2);
    graph.dom.intervals[0].getBoundingClientRect = () => ({left: 0, width: 300});
    graph.onLapTime(30);
    expect(graph.dom.progress.style.width).toBe('150px');
    expect(() => graph.onIntervalIndex(2)).not.toThrow();
    graph.remove();
});
