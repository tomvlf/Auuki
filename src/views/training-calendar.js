import { xf } from '../functions.js';
import { models } from '../models/models.js';
import { isoDate } from '../utils.js';

const storageKey = 'training-calendar';
const weekdayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function escapeHTML(value = '') {
    return String(value).replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function localDate(year, month, day) {
    return isoDate(new Date(year, month, day));
}

class TrainingCalendar extends HTMLElement {
    connectedCallback() {
        this.abortController = new AbortController();
        this.signal = {signal: this.abortController.signal};
        this.selectedDate = isoDate();
        this.displayMonth = new Date();
        this.workouts = [];

        try {
            const stored = window.localStorage.getItem(storageKey);
            this.entries = stored ? JSON.parse(stored) : [];
            if(!Array.isArray(this.entries)) {
                throw new Error('Stored training calendar data must be an array.');
            }
        } catch(error) {
            console.error('Unable to load training calendar data:', error);
            this.entries = [];
            this.storageError = 'Calendar data could not be loaded from this browser.';
        }

        this.addEventListener('click', this.onClick.bind(this), this.signal);
        this.addEventListener('submit', this.onSubmit.bind(this), this.signal);
        xf.sub('db:workouts', (workouts) => {
            this.workouts = workouts;
            this.render();
        }, this.signal);
        xf.sub('action:planned', () => this.render(), this.signal);
        this.render();
    }

    disconnectedCallback() {
        this.abortController.abort();
    }

    save() {
        try {
            window.localStorage.setItem(storageKey, JSON.stringify(this.entries));
            this.storageError = '';
        } catch(error) {
            console.error('Unable to save training calendar data:', error);
            this.storageError = 'Calendar changes could not be saved in this browser.';
        }
    }

    plannedEntries() {
        return models.planned.list()
            .filter((workout) => workout.meta?.startDateLocal)
            .map((workout) => ({
                date: String(workout.meta.startDateLocal).slice(0, 10),
                name: workout.meta.name || 'Planned workout',
                workout,
                source: 'planned',
            }));
    }

    entriesForDate(date) {
        return [
            ...this.entries.filter((entry) => entry.date === date),
            ...this.plannedEntries().filter((entry) => entry.date === date),
        ];
    }

    renderMonth() {
        const year = this.displayMonth.getFullYear();
        const month = this.displayMonth.getMonth();
        const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
        const dayCount = new Date(year, month + 1, 0).getDate();
        const cellCount = Math.ceil((firstWeekday + dayCount) / 7) * 7;
        const today = isoDate();
        const cells = [];

        for(let index = 0; index < cellCount; index += 1) {
            const day = index - firstWeekday + 1;
            if(day < 1 || day > dayCount) {
                cells.push('<div class="calendar-day empty" aria-hidden="true"></div>');
                continue;
            }

            const date = localDate(year, month, day);
            const entries = this.entriesForDate(date);
            const preview = entries.slice(0, 2).map((entry) =>
                `<span class="calendar-day--event">${escapeHTML(entry.name)}</span>`
            ).join('');
            const more = entries.length > 2
                ? `<span class="calendar-day--more">+${entries.length - 2} more</span>`
                : '';
            const classes = [
                'calendar-day',
                date === this.selectedDate ? 'selected' : '',
                date === today ? 'today' : '',
                entries.length ? 'has-events' : '',
            ].filter(Boolean).join(' ');

            cells.push(`
                <button type="button" class="${classes}" data-date="${date}"
                        aria-label="${date}, ${entries.length} planned workouts"
                        aria-pressed="${date === this.selectedDate}">
                    <span class="calendar-day--number">${day}</span>
                    ${preview}${more}
                </button>`);
        }

        const heading = this.displayMonth.toLocaleDateString(undefined, {
            month: 'long',
            year: 'numeric',
        });

        return `
            <header class="training-calendar--header">
                <h2 class="list--sub-heading">${heading}</h2>
                <div class="training-calendar--navigation">
                    <button type="button" data-action="previous" aria-label="Previous month">‹</button>
                    <button type="button" data-action="today">Today</button>
                    <button type="button" data-action="next" aria-label="Next month">›</button>
                </div>
            </header>
            <div class="training-calendar--grid" role="grid" aria-label="${heading}">
                ${weekdayNames.map((day) => `<div class="calendar-weekday" role="columnheader">${day}</div>`).join('')}
                ${cells.join('')}
            </div>`;
    }

    renderSelectedDate() {
        const entries = this.entriesForDate(this.selectedDate);
        const heading = new Date(`${this.selectedDate}T00:00:00`).toLocaleDateString(undefined, {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
            year: 'numeric',
        });
        const options = this.workouts.map((workout) =>
            `<option value="${escapeHTML(workout.id)}">${escapeHTML(workout.meta?.name || 'Workout')}</option>`
        ).join('');
        const items = entries.length
            ? entries.map((entry) => `
                <li class="training-calendar--entry">
                    <span>${escapeHTML(entry.name)}</span>
                    <div class="training-calendar--entry-actions">
                        <button type="button" data-action="start"
                                data-workout="${escapeHTML(entry.workout.id || '')}">Start</button>
                        ${entry.source !== 'planned'
                            ? `<button type="button" data-action="remove" data-entry="${escapeHTML(entry.id)}">Remove</button>`
                            : '<span class="training-calendar--source">Intervals.icu</span>'}
                    </div>
                </li>`).join('')
            : '<li class="training-calendar--empty">No workouts planned for this day.</li>';

        return `
            <section class="training-calendar--day" aria-label="Workouts for ${heading}">
                <h3>${heading}</h3>
                ${this.workouts.length
                    ? `<form class="training-calendar--form">
                           <label for="training-calendar-workout">Add a workout</label>
                           <select id="training-calendar-workout" name="workout" required>
                               <option value="">Choose from your library</option>${options}
                           </select>
                           <button type="submit">Schedule</button>
                       </form>`
                    : '<p class="training-calendar--empty">Your workout library is still loading.</p>'}
                ${this.storageError
                    ? `<p class="training-calendar--error" role="alert">${escapeHTML(this.storageError)}</p>`
                    : ''}
                <ul class="training-calendar--entries">${items}</ul>
            </section>`;
    }

    render() {
        this.innerHTML = `${this.renderMonth()}${this.renderSelectedDate()}`;
    }

    onClick(event) {
        const day = event.target.closest('[data-date]');
        if(day && this.contains(day)) {
            this.selectedDate = day.dataset.date;
            this.render();
            return;
        }

        const action = event.target.closest('[data-action]');
        if(!action || !this.contains(action)) return;

        if(action.dataset.action === 'previous') {
            this.displayMonth = new Date(
                this.displayMonth.getFullYear(),
                this.displayMonth.getMonth() - 1,
                1,
            );
            this.selectedDate = localDate(
                this.displayMonth.getFullYear(),
                this.displayMonth.getMonth(),
                1,
            );
        } else if(action.dataset.action === 'next') {
            this.displayMonth = new Date(
                this.displayMonth.getFullYear(),
                this.displayMonth.getMonth() + 1,
                1,
            );
            this.selectedDate = localDate(
                this.displayMonth.getFullYear(),
                this.displayMonth.getMonth(),
                1,
            );
        } else if(action.dataset.action === 'today') {
            this.displayMonth = new Date();
            this.selectedDate = isoDate();
        } else if(action.dataset.action === 'remove') {
            this.entries = this.entries.filter((entry) => entry.id !== action.dataset.entry);
            this.save();
        } else if(action.dataset.action === 'start') {
            const entry = this.entriesForDate(this.selectedDate)
                .find((item) => String(item.workout.id || '') === action.dataset.workout);
            if(entry) {
                xf.dispatch('workout', entry.workout);
                xf.dispatch('ui:page-set', 'home');
            }
            return;
        } else {
            return;
        }

        this.render();
    }

    onSubmit(event) {
        if(!event.target.matches('.training-calendar--form')) return;
        event.preventDefault();

        const workoutId = new FormData(event.target).get('workout');
        const workout = this.workouts.find((item) => String(item.id) === workoutId);
        if(!workout) return;

        const scheduledWorkout = JSON.parse(JSON.stringify(workout));
        scheduledWorkout.meta = {...scheduledWorkout.meta, startDateLocal: this.selectedDate};
        this.entries.push({
            id: `calendar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            date: this.selectedDate,
            name: scheduledWorkout.meta.name || 'Workout',
            workout: scheduledWorkout,
        });
        this.save();
        this.render();
    }
}

customElements.define('training-calendar', TrainingCalendar);

export { TrainingCalendar, localDate };
