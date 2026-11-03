/** @jest-environment jsdom */

import { localDate, TrainingCalendar } from '../../src/views/training-calendar.js';

describe('training calendar', () => {
    test('formats local dates without shifting to the previous day', () => {
        expect(localDate(2024, 1, 29)).toBe('2024-02-29');
    });

    test('renders every day in a leap-year month', () => {
        const calendar = new TrainingCalendar();
        calendar.displayMonth = new Date(2024, 1, 1);
        calendar.selectedDate = '2024-02-29';
        calendar.entries = [];

        const container = document.createElement('div');
        container.innerHTML = calendar.renderMonth();

        const dates = [...container.querySelectorAll('[data-date]')]
            .map((day) => day.dataset.date);
        expect(dates).toHaveLength(29);
        expect(dates[0]).toBe('2024-02-01');
        expect(dates.at(-1)).toBe('2024-02-29');
        expect(container.querySelector('[aria-pressed="true"]').dataset.date)
            .toBe('2024-02-29');
    });

    test('escapes workout names displayed in calendar cells', () => {
        const calendar = new TrainingCalendar();
        calendar.displayMonth = new Date(2026, 10, 1);
        calendar.selectedDate = '2026-11-03';
        calendar.entries = [{
            date: '2026-11-03',
            name: '<img src=x onerror=alert(1)>',
            workout: {},
        }];

        const container = document.createElement('div');
        container.innerHTML = calendar.renderMonth();

        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('[data-date="2026-11-03"]').textContent)
            .toContain('<img src=x onerror=alert(1)>');
    });
});
