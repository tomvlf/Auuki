/**
 * @jest-environment jsdom
 */

import { workouts } from '../../src/workouts/workouts.js';
import { zwo } from '../../src/workouts/zwo.js';

const parsed = workouts.map(w => zwo.readToInterval(w));

test('every built-in workout parses with a name, category, description and duration', () => {
    for(const w of parsed) {
        expect(w.meta.name).toBeTruthy();
        expect(w.meta.category).toBeTruthy();
        expect(w.meta.description.trim()).toBeTruthy();
        expect(w.meta.duration).toBeGreaterThan(0);
        expect(w.intervals.length).toBeGreaterThan(0);
    }
    expect(new Set(parsed.map(w => w.meta.name)).size).toBe(parsed.length);
});

test('classic training sessions are in the library with their prescribed structure', () => {
    const find = name => parsed.find(w => w.meta.name === name);
    const work = (w, power) => w.intervals.flatMap(i => i.steps).filter(s => s.power === power)
        .reduce((total, s) => total + s.duration, 0);
    expect(work(find('2x20 Threshold'), 0.96)).toBe(2 * 1200);
    expect(work(find('Sweet Spot 3x15'), 0.9)).toBe(3 * 900);
    expect(work(find('VO2 Max 5x5'), 1.12)).toBe(5 * 300);
    expect(work(find('Ronnestad 30/15'), 1.25)).toBe(3 * 13 * 30);
    expect(work(find('Tabata'), 1.7)).toBe(2 * 8 * 20);
    expect(find('20 Minute FTP Test').intervals.some(i => i.duration === 1200 && i.steps[0].slope === 0)).toBe(true);
    for(const name of ['Over-Unders', 'Tempo 2x30', 'Seiler 4x8', 'Billat 30/30', 'Sprints 8x12s',
        'Cadence Drills', 'Endurance 90', 'Openers']) expect(find(name)).toBeDefined();
});

test('long endurance rides have the advertised multi-hour durations', () => {
    const durations = new Map(parsed.map(w => [w.meta.name, w.meta.duration]));
    expect(durations.get('Endurance 2h30')).toBe(2.5 * 60 * 60);
    expect(durations.get('Endurance 3h')).toBe(3 * 60 * 60);
    expect(durations.get('Endurance 3h30 Progressive')).toBe(3.5 * 60 * 60);
    expect(durations.get('Endurance 4h')).toBe(4 * 60 * 60);
});
