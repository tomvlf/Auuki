import '../../src/views/workout-list.js';
import '../../src/views/planned-list.js';
import { workoutTemplate } from '../../src/views/workout-list.js';

const PlannedList = customElements.get('planned-list');

test('renders untrusted workout metadata and IDs as inert content', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const id = 'workout-1" onmouseover="alert(1)';
    const container = document.createElement('div');
    container.innerHTML = workoutTemplate({
        id,
        selected: false,
        graph: '',
        meta: {name: attack, category: attack, description: attack},
    });

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror], [onmouseover]')).toBeNull();
    expect(container.querySelector('.workout--name').textContent).toBe(attack);
    expect(container.querySelector('.workout--type').textContent).toBe(attack);
    expect(container.querySelector('.workout--description').textContent).toBe(attack);
});

test('renders planned workout metadata and IDs as inert content', () => {
    const attack = '<img src=x onerror=alert(1)>';
    const id = 'workout-1" onmouseover="alert(1)';
    const list = new PlannedList();
    list.viewModel = {toSVG: () => ''};

    const container = document.createElement('div');
    container.innerHTML = list.toListItem({
        id,
        meta: {
            name: attack,
            category: attack,
            description: attack,
            startDateLocal: '2026-01-01',
        },
    }, 200, {});

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[onerror], [onmouseover]')).toBeNull();
    expect(container.querySelector('.workout--name').textContent).toBe(attack);
    expect(container.querySelector('.workout--type').textContent).toBe(attack);
    expect(container.querySelector('.workout--description').textContent).toBe(attack);
    expect(container.querySelector('[data-wid]').dataset.wid).toBe(id);
});
