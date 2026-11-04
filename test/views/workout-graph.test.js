/*
 * workout-graph.test.js: test coverage module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * documents the expected behavior of the application and prevents regressions during development.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

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
