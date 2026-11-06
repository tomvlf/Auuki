/** @jest-environment jsdom */
import { filterWorkouts, initialLibraryFilters, renderLibrary } from '../../src/platform/library.js';

const workouts = [
    {id: 'short', meta: {name: 'Tempo', category: 'Tempo', duration: 1800},
        intervals: [{steps: [{duration: 1800, power: .8}]}]},
    {id: 'medium', meta: {name: 'Base', category: 'Endurance', duration: 1801},
        intervals: [{steps: [{duration: 1801, power: .6}]}]},
    {id: 'hour', meta: {name: 'Steady', category: 'Endurance', duration: 3600},
        intervals: [{steps: [{duration: 3600, power: .7}]}]},
    {id: 'long', meta: {name: 'Long ride', category: 'Endurance', duration: 3601},
        intervals: [{steps: [{duration: 3601, power: .7}]}]},
    {id: 'climb', meta: {name: 'Climb', category: 'Course', distance: 12500},
        points: [{x: 0, y: 100}, {x: 12500, y: 300}]},
    {id: 'flat', meta: {name: 'Flat', category: 'Course', distance: 2000},
        points: [{x: 0, y: 20}, {x: 2000, y: 20}]},
];
const ids = result => result.map(workout => workout.id);
const filtered = overrides => filterWorkouts(workouts, {...initialLibraryFilters(), ...overrides});

test('search and filters combine using actual categories, workout type and duration boundaries', () => {
    expect(ids(filtered({search: 'ENDURANCE'}))).toEqual(['medium', 'hour', 'long']);
    expect(ids(filtered({search: 'ba', category: 'Endurance'}))).toEqual(['medium']);
    expect(ids(filtered({type: 'course'}))).toEqual(['climb', 'flat']);
    expect(ids(filtered({type: 'workout', category: 'Endurance'}))).toEqual(['medium', 'hour', 'long']);
    expect(ids(filtered({duration: 'short'}))).toEqual(['short']);
    expect(ids(filtered({duration: 'medium'}))).toEqual(['medium', 'hour']);
    expect(ids(filtered({duration: 'long'}))).toEqual(['long']);
    expect(filtered({type: 'course', duration: 'short'})).toEqual([]);
});

test('sorts without mutating library order and keeps missing metrics last', () => {
    expect(ids(filtered({sort: 'name'}))).toEqual(['medium', 'climb', 'flat', 'long', 'hour', 'short']);
    expect(ids(filtered({sort: 'duration'}))).toEqual(['short', 'medium', 'hour', 'long', 'climb', 'flat']);
    expect(ids(filtered({sort: 'distance'}))).toEqual(['climb', 'flat', 'short', 'medium', 'hour', 'long']);
    expect(ids(workouts)).toEqual(['short', 'medium', 'hour', 'long', 'climb', 'flat']);
});

test('renders accessible cards, actual profiles and safe user-supplied names and categories', () => {
    const unsafe = {id: 'custom/"<id>', meta: {name: '<img src=x onerror=alert(1)>', category: '"<script>'},
        intervals: [{steps: [{duration: 120, power: 1.1}]}]};
    const container = document.createElement('div');
    container.innerHTML = renderLibrary([...workouts, unsafe], initialLibraryFilters());
    const layout = container.querySelector('.library-layout');
    expect(layout.firstElementChild.matches('aside.library-filters')).toBe(true);
    expect(layout.lastElementChild.id).toBe('library-results');
    expect(container.querySelector('.library-count').textContent).toBe('Showing 7 of 7 workouts');
    expect(container.querySelectorAll('.workout-card')).toHaveLength(7);
    expect(container.querySelector('[aria-label="Workout target power profile"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Course elevation profile"]')).not.toBeNull();
    const card = container.querySelectorAll('.workout-card')[6];
    expect(card.querySelector('h2').textContent).toBe(unsafe.meta.name);
    expect(card.querySelector('a').getAttribute('href')).toBe(`#/workout/${encodeURIComponent(unsafe.id)}`);
    expect(container.querySelectorAll('img, script')).toHaveLength(0);
    expect([...container.querySelector('#workout-category').options].some(item => item.value === unsafe.meta.category)).toBe(true);
});

test('distinguishes an empty library from no matching results', () => {
    expect(renderLibrary([], initialLibraryFilters())).toContain('Your workout library is empty.');
    expect(renderLibrary(workouts, {...initialLibraryFilters(), search: 'unmatched'}))
        .toContain('No workouts match your search.');
});

test('shows cadence targets and explicitly marks unprescribed portions', () => {
    const drill = {id: 'drill', meta: {name: 'Drill', category: 'Technique', duration: 1800},
        intervals: [{steps: [{duration: 300, power: .5}, {duration: 60, power: .6, cadence: 95},
            {duration: 120, power: .5, cadence: 80}]}]};
    const container = document.createElement('div');
    container.innerHTML = renderLibrary([drill, workouts[0], workouts[4]], initialLibraryFilters());
    const cards = container.querySelectorAll('.workout-card');
    expect(cards[0].textContent).toContain('80–95 rpm / self-selected');
    expect(cards[1].textContent).toContain('CadenceSelf-selected');
    expect(cards[2].textContent).not.toContain('Cadence');
});
