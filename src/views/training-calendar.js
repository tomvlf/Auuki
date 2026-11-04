/**
 * training-calendar.js: browser-side training calendar and planned workout view.
 *
 * Why this exists:
 * Riders need one place to see their captured ride history, imported Intervals.icu
 * calendar entries, and coaching plan items without bouncing between disconnected
 * screens. This module keeps that calendar logic in one ownership boundary so it is
 * easier to reason about data flow and persistence.
 *
 * What it does:
 * It loads saved calendar entries from local storage, listens for workout and service
 * updates from the rest of the app, merges imported plan sessions into the visible month,
 * and renders interactive date selection plus import/export actions.
 */

import { xf } from '../functions.js';
import { models } from '../models/models.js';
import { isoDate } from '../utils.js';
import { coachingService, coachingData } from '../coaching/service.js';
import { toAppWorkout, exportZwo } from '../coaching/workouts.js';
import { localDay } from '../coaching/domain.js';
import { fileHandler } from '../file.js';
import { accountStorage, accountKey, hasAccountScope } from '../storage/account.js';
import { serverRequest } from '../server/client.js';

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

function monthRange(date) {
    const year = date.getFullYear();
    const month = date.getMonth();
    return {
        oldest: localDate(year, month, 1),
        newest: localDate(year, month + 1, 0),
    };
}

function parseEntries(value) {
    const entries = value ? JSON.parse(value) : [];
    if(!Array.isArray(entries)) {
        throw new Error('Stored training calendar data must be an array.');
    }

    return entries.map((entry) => {
        const workoutId = entry?.workoutId ?? entry?.workout?.id;
        if(!entry?.id || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || !workoutId) {
            throw new Error('Stored training calendar entry is invalid.');
        }

        return {
            id: String(entry.id),
            date: entry.date,
            name: String(entry.name || entry.workout?.meta?.name || 'Workout'),
            workoutId: String(workoutId),
        };
    });
}

/**
 * Displays the rider's personal calendar, imported planned workouts, and coaching events.
 *
 * This component keeps a browser-local training log and merges it with imported provider
 * workouts such as Intervals.icu so the rider sees both their stored sessions and future
 * planned work in one place.
 */
class TrainingCalendar extends HTMLElement {
    /**
     * Creates a calendar view to hold entries, workload, and planned-workout month state.
     */
    constructor() {
        super();
        this.entries = [];
        this.workouts = [];
        this.plannedWorkouts = [];
        this.plannedByMonth = new Map();
        this.intervalsConnected = null;
        this.checkingServices = false;
    }

    /**
     * Connects the calendar to storage, event subscriptions, and the initial render.
     */
    connectedCallback() {
        this.abortController = new AbortController();
        this.signal = {signal: this.abortController.signal};
        this.selectedDate = isoDate();
        this.displayMonth = new Date();
        this.workouts = [];
        this.plannedWorkouts = [];
        this.plannedByMonth = new Map();
        this.watchStatus = 'stopped';
        this.storageError = '';
        this.actionMessage = '';

        try {
            this.entries = parseEntries(accountStorage.getItem(storageKey));
        } catch(error) {
            console.error('Unable to load training calendar data:', error);
            this.entries = [];
            this.storageError = 'Calendar data could not be loaded from this browser.';
        }

        this.addEventListener('click', this.onClick.bind(this), this.signal);
        this.addEventListener('submit', this.onSubmit.bind(this), this.signal);
        window.addEventListener('storage', this.onStorage.bind(this), this.signal);
        xf.sub('db:workouts', (workouts) => {
            this.workouts = workouts;
            this.render();
        }, this.signal);
        xf.sub('db:watchStatus', (status) => {
            this.watchStatus = status;
        }, this.signal);
        xf.sub('db:services', (services) => {
            const wasConnected = this.intervalsConnected;
            this.intervalsConnected = Boolean(
                services?.services?.intervals ?? services?.intervals,
            );
            if(this.intervalsConnected && !wasConnected && !this.checkingServices) {
                this.loadPlannedMonth();
            }
        }, this.signal);
        xf.sub('action:planned', () => this.render(), this.signal);
        xf.sub('coaching:changed', () => this.render(), this.signal);
        xf.sub('action:nav', (action) => {
            if(action === 'workouts:calendar') this.loadPlannedMonth();
        }, this.signal);
        this.render();
    }

    disconnectedCallback() {
        this.abortController.abort();
    }

    /**
     * Reads the persisted calendar entries from browser storage.
     *
     * @returns {Array<object>|null} Stored entries or null when the browser data is invalid or cannot be read.
     */
    getStoredEntries() {
        try {
            return parseEntries(accountStorage.getItem(storageKey));
        } catch(error) {
            console.error('Unable to read training calendar data:', error);
            this.storageError = 'Calendar data could not be loaded from this browser.';
            this.render();
            return null;
        }
    }

    /**
     * Saves calendar changes to the account-local storage bucket.
     *
     * @param {Array<object>} entries - Calendar event list for the rider's account.
     * @returns {boolean} True when the calendar persisted successfully.
     */
    save(entries) {
        try {
            accountStorage.setItem(storageKey, JSON.stringify(entries));
            this.entries = entries;
            this.storageError = '';
            return true;
        } catch(error) {
            console.error('Unable to save training calendar data:', error);
            this.storageError = 'Calendar changes could not be saved in this browser.';
            return false;
        }
    }

    onStorage(event) {
        if(event.key !== accountKey(storageKey) && event.key !== null) return;
        if(event.storageArea && event.storageArea !== window.localStorage) return;

        try {
            this.entries = parseEntries(event.newValue);
            this.storageError = '';
        } catch(error) {
            console.error('Unable to load updated training calendar data:', error);
            this.storageError = 'Calendar data could not be loaded from this browser.';
        }
        this.render();
    }

    /**
     * Loads planned workouts for the currently displayed month from the Intervals integration.
     *
     * @returns {Promise<void>} Resolves after the month cache is updated or the request fails.
     */
    async loadPlannedMonth() {
        const monthKey = `${this.displayMonth.getFullYear()}-${this.displayMonth.getMonth()}`;
        if(this.plannedByMonth.has(monthKey)) {
            this.plannedWorkouts = this.plannedByMonth.get(monthKey);
            this.render();
            return;
        }

        try {
            if(this.intervalsConnected === null) {
                this.checkingServices = true;
                try {
                    const status = hasAccountScope()
                        ? {intervals: (await serverRequest('integrations/intervals')).connected}
                        : {intervals: false};
                    this.intervalsConnected = Boolean(
                        status?.services?.intervals ?? status?.intervals,
                    );
                } finally {
                    this.checkingServices = false;
                }
            }
            if(!this.intervalsConnected || this.signal.signal.aborted) return;

            const { oldest, newest } = monthRange(this.displayMonth);
            const workouts = await models.planned.getIntervals(oldest, newest);
            if(this.signal.signal.aborted) return;

            this.plannedByMonth.set(monthKey, workouts);
            if(monthKey === `${this.displayMonth.getFullYear()}-${this.displayMonth.getMonth()}`) {
                this.plannedWorkouts = workouts;
                this.render();
            }
        } catch(error) {
            console.error('Unable to load planned calendar workouts:', error);
            this.actionMessage = 'Planned workouts could not be loaded.';
            this.render();
        }
    }

    plannedEntries() {
        const workouts = [
            ...models.planned.list(),
            ...this.plannedWorkouts,
        ];
        const seen = new Set();

        return workouts
            .filter((workout) => workout.meta?.startDateLocal)
            .map((workout) => ({
                date: String(workout.meta.startDateLocal).slice(0, 10),
                name: workout.meta.name || 'Planned workout',
                workout,
                source: 'planned',
            }))
            .filter((entry) => {
                const id = entry.workout.intervals_id || entry.workout.id;
                const key = `${entry.date}:${id}`;
                if(seen.has(key)) return false;
                seen.add(key);
                return true;
            });
    }

    coachingEntries() {
        try {
            const plan = coachingData()?.plan;
            return (plan && plan.status !== 'archived' ? plan.workouts : []).map(workout => ({
                id: workout.id, date: workout.date, name: workout.title,
                workout: toAppWorkout(workout), coaching: workout, source: 'coaching',
            }));
        } catch(error) {
            console.error('Unable to load coaching sessions:', error);
            this.storageError = error.message;
            return [];
        }
    }

    entriesForDate(date) {
        return [
            ...this.entries.filter((entry) => entry.date === date).map((entry) => ({
                ...entry,
                workout: this.workouts.find((workout) => String(workout.id) === entry.workoutId),
                source: 'calendar',
            })),
            ...this.plannedEntries().filter((entry) => entry.date === date),
            ...this.coachingEntries().filter(entry => entry.date === date),
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

    workoutMetrics(entry) {
        const meta = entry.workout?.meta ?? {};
        const duration = typeof meta.duration === 'number' ? Math.round(meta.duration / 60) : null;
        const distance = typeof meta.distance === 'number' ? `${(meta.distance / 1000).toFixed(1)} km` : null;
        const category = meta.category || (entry.source === 'planned' ? 'Planned' : 'Workout');
        const targetLoad = entry.coaching?.targetLoad;
        const expectedRpe = entry.coaching?.expectedRpe;
        const metrics = [
            duration ? `${duration} min` : null,
            distance,
            category,
            Number.isFinite(targetLoad) ? `Load ${Math.round(targetLoad)}` : null,
            Number.isFinite(expectedRpe) ? `RPE ${expectedRpe}` : null,
        ].filter(Boolean);
        return metrics.length ? metrics : ['Workout'];
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
            ? entries.map((entry) => {
                const metrics = this.workoutMetrics(entry);
                const title = escapeHTML(entry.name || 'Workout');
                return `
                <li class="training-calendar--entry">
                    <div class="training-calendar--copy">
                        <div class="training-calendar--eyebrow">${escapeHTML(entry.source === 'planned' ? 'Intervals' : entry.source === 'coaching' ? 'Coach' : 'Plan')}</div>
                        <div class="training-calendar--name">${title}</div>
                        <div class="training-calendar--meta">
                            ${metrics.map((metric) => `<span>${escapeHTML(metric)}</span>`).join('')}
                        </div>
                    </div>
                    <div class="training-calendar--entry-actions">
                        ${entry.workout &&
                        (entry.source !== 'coaching' || this.canStartCoaching(entry.coaching))
                            ? `<button type="button" data-action="start"
                                       data-workout="${escapeHTML(entry.workout.id || '')}">Start</button>`
                            : !entry.workout && entry.source !== 'coaching'
                                ? '<span class="training-calendar--source">Workout is no longer in your library</span>'
                                : ''}
                        ${entry.source === 'coaching'
                            ? this.renderCoachingActions(entry)
                            : entry.source !== 'planned'
                            ? `<button type="button" data-action="remove" data-entry="${escapeHTML(entry.id)}">Remove</button>`
                            : '<span class="training-calendar--source">Intervals.icu</span>'}
                    </div>
                </li>`;
            }).join('')
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
                ${this.actionMessage
                    ? `<p class="training-calendar--error" role="alert">${escapeHTML(this.actionMessage)}</p>`
                    : ''}
                <ul class="training-calendar--entries">${items}</ul>
            </section>`;
    }

    renderCoachingActions(entry) {
        const workout = entry.coaching;
        const data = coachingService().data;
        const today = localDay(new Date().toISOString(), data.profile.timeZone);
        const activities = data.activities.filter(a => a.day === workout.date &&
            !data.plan.workouts.some(w => w.matchedActivity === a.id));
        return `<span>${escapeHTML(workout.status)}; ${Math.round(workout.targetLoad)} planned power-load points;
            RPE ${workout.expectedRpe}. ${escapeHTML(workout.description)}</span>
            <button type="button" data-action="coach-export" data-entry="${escapeHTML(entry.id)}">Export ZWO</button>
            ${workout.status === 'scheduled' && workout.date <= today && data.plan.status === 'active' ? `
                <button type="button" data-action="coach-missed" data-entry="${escapeHTML(entry.id)}">Missed</button>
                <button type="button" data-action="coach-failed" data-entry="${escapeHTML(entry.id)}">Not completed</button>
                ${activities.length ? `<select aria-label="Completed substitute ride" data-substitute="${escapeHTML(entry.id)}">
                    ${activities.map(a => `<option value="${escapeHTML(a.id)}">${escapeHTML(a.day)}
                        ${Math.round(a.duration / 60)} min</option>`).join('')}</select>
                    <button type="button" data-action="coach-substitute" data-entry="${escapeHTML(entry.id)}">Use substitute</button>` : ''}
            ` : ''}`;
    }

    canStartCoaching(workout) {
        const data = coachingData();
        return data.plan.status === 'active' && workout.status === 'scheduled' &&
            workout.date === localDay(new Date().toISOString(), data.profile.timeZone);
    }

    render() {
        const activeElement = this.contains(document.activeElement)
            ? document.activeElement.closest('button, select, [tabindex], navigation-action')
            : null;
        const focusedDate = activeElement?.dataset.date;
        const focusedAction = activeElement?.dataset.action;
        const focusedEntry = activeElement?.dataset.entry;
        const focusedWorkout = activeElement?.matches('[name="workout"]')
            ? activeElement.value
            : this.querySelector('[name="workout"]')?.value;

        this.innerHTML = `${this.renderMonth()}${this.renderSelectedDate()}`;

        const select = this.querySelector('[name="workout"]');
        if(select && focusedWorkout && [...select.options].some((option) => option.value === focusedWorkout)) {
            select.value = focusedWorkout;
        }

        let nextFocus;
        if(focusedDate) {
            nextFocus = [...this.querySelectorAll('[data-date]')]
                .find((element) => element.dataset.date === focusedDate);
        } else if(focusedAction) {
            nextFocus = [...this.querySelectorAll('[data-action]')].find((element) =>
                element.dataset.action === focusedAction &&
                (!focusedEntry || element.dataset.entry === focusedEntry)
            );
        } else if(activeElement?.matches('[name="workout"]')) {
            nextFocus = select;
        }
        nextFocus?.focus({preventScroll: true});
    }

    async onClick(event) {
        const day = event.target.closest('[data-date]');
        if(day && this.contains(day)) {
            this.selectedDate = day.dataset.date;
            this.actionMessage = '';
            this.render();
            return;
        }

        const action = event.target.closest('[data-action]');
        if(!action || !this.contains(action)) return;

        if(action.dataset.action.startsWith('coach-')) {
            try {
                const service = coachingService();
                const workout = service.data.plan.workouts.find(w => w.id === action.dataset.entry);
                if(!workout) throw new Error('Coaching workout not found.');
                if(action.dataset.action === 'coach-export') {
                    fileHandler.download()(exportZwo(workout), `${workout.date}-${workout.family}.zwo`, 'application/xml');
                } else {
                    const select = [...this.querySelectorAll('[data-substitute]')]
                        .find(el => el.dataset.substitute === workout.id);
                    await service.resolve({workoutId: workout.id,
                        trigger: action.dataset.action === 'coach-substitute' ? 'substituted' :
                            action.dataset.action === 'coach-failed' ? 'failed' : 'missed',
                        activityId: action.dataset.action === 'coach-substitute' ? select?.value : null});
                    xf.dispatch('coaching:changed');
                }
            } catch(error) {
                console.error('Coaching calendar action failed:', error);
                this.storageError = error.message;
            }
        } else if(action.dataset.action === 'previous') {
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
            this.plannedWorkouts = [];
            this.loadPlannedMonth();
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
            this.plannedWorkouts = [];
            this.loadPlannedMonth();
        } else if(action.dataset.action === 'today') {
            this.displayMonth = new Date();
            this.selectedDate = isoDate();
            this.plannedWorkouts = [];
            this.loadPlannedMonth();
        } else if(action.dataset.action === 'remove') {
            const entries = this.getStoredEntries();
            if(!entries) return;
            this.save(entries.filter((entry) => entry.id !== action.dataset.entry));
        } else if(action.dataset.action === 'start') {
            const entry = this.entriesForDate(this.selectedDate).find(
                (item) => String(item.workout?.id || '') === action.dataset.workout,
            );
            const workout = entry?.workout;
            if(!workout) return;
            if(this.watchStatus === 'started' || this.watchStatus === 'paused') {
                this.actionMessage = 'Stop the current ride before starting another workout.';
                this.render();
                return;
            }

            this.actionMessage = '';
            if(entry.source === 'coaching') {
                xf.dispatch('ui:coaching:select', workout);
                return;
            }
            xf.dispatch('workout', workout);
            xf.dispatch('ui:page-set', 'home');
            xf.dispatch('ui:watchStart');
            xf.dispatch('ui:workoutStart');
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

        const entries = this.getStoredEntries();
        if(!entries) return;
        const nextEntries = [...entries, {
            id: `calendar-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            date: this.selectedDate,
            name: workout.meta?.name || 'Workout',
            workoutId: String(workout.id),
        }];
        this.save(nextEntries);
        this.render();
    }
}

customElements.define('training-calendar', TrainingCalendar);

export { TrainingCalendar, localDate };
