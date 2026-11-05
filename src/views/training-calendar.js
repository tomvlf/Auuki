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
import { estimateState } from '../coaching/state.js';
import { fileHandler } from '../file.js';
import { accountStorage, accountKey, hasAccountScope } from '../storage/account.js';
import { serverRequest } from '../server/client.js';
import { renderPowerProfile } from './power-profile.js';
import { activityIcon, activityTypeLabel } from './activity-icon.js';
import { renderActivityDetails } from './activity-details.js';

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

function weekNumber(date) {
    const thursday = new Date(`${date}T00:00:00Z`);
    thursday.setUTCDate(thursday.getUTCDate() + 4 - (thursday.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 1));
    return Math.ceil(((thursday - yearStart) / 86400000 + 1) / 7);
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
        this.plannedByRange = new Map();
        this.localActivities = [];
        this.intervalsConnected = null;
        this.checkingServices = false;
        this.ftp = 200;
        this.view = 'month';
        this.weekStateSource = null;
        this.weekStates = new Map();
        this.weekStateError = '';
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
        this.plannedByRange = new Map();
        this.watchStatus = 'stopped';
        this.storageError = '';
        this.actionMessage = '';
        this.view = 'month';

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
        xf.sub('activity:restore', () => this.loadRecordedActivities(), this.signal);
        xf.sub('activity:add', (activity) => {
            this.localActivities = [activity, ...this.localActivities.filter(item => item.id !== activity.id)];
            this.render();
        }, this.signal);
        xf.sub('db:workouts', (workouts) => {
            this.workouts = workouts;
            this.render();
        }, this.signal);
        xf.sub('db:ftp', (ftp) => {
            if(Number.isFinite(ftp) && ftp > 0) {
                this.ftp = ftp;
                this.render();
            }
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

    async loadRecordedActivities() {
        try {
            this.localActivities = await models.activity.restore();
            if(!this.signal.signal.aborted) this.render();
        } catch(error) {
            console.error('Unable to load recorded calendar activities:', error);
            this.actionMessage = 'Recorded rides could not be loaded.';
            this.render();
        }
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

    plannedRange() {
        const dates = this.view === 'week' ? this.weekDates() : this.monthDates();
        return {oldest: dates[0], newest: dates[dates.length - 1]};
    }

    /**
     * Loads planned workouts for the visible week or month from the Intervals integration.
     *
     * @returns {Promise<void>} Resolves after the visible range cache is updated or the request fails.
     */
    async loadPlannedMonth() {
        const range = this.plannedRange();
        const rangeKey = `${range.oldest}:${range.newest}`;
        if(this.plannedByRange.has(rangeKey)) {
            this.plannedWorkouts = this.plannedByRange.get(rangeKey);
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

            const workouts = await models.planned.getIntervals(range.oldest, range.newest);
            if(this.signal.signal.aborted) return;

            this.plannedByRange.set(rangeKey, workouts);
            const currentRange = this.plannedRange();
            if(`${currentRange.oldest}:${currentRange.newest}` === rangeKey) {
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
            const activities = coachingData()?.activities || [];
            return (plan && plan.status !== 'archived' ? plan.workouts : [])
                .filter(workout => !(workout.status === 'completed' &&
                    activities.some(activity => activity.id === workout.matchedActivity)))
                .map(workout => ({
                id: workout.id, date: workout.date, name: workout.title,
                workout: toAppWorkout(workout), coaching: workout, source: 'coaching',
            }));
        } catch(error) {
            console.error('Unable to load coaching sessions:', error);
            this.storageError = error.message;
            return [];
        }
    }

    calendarEntries() {
        return [
            ...this.entries.map((entry) => ({
                ...entry,
                workout: this.workouts.find((workout) => String(workout.id) === entry.workoutId),
                source: 'calendar',
            })),
            ...this.plannedEntries(),
            ...this.coachingEntries(),
        ];
    }

    entriesForDate(date, calendarEntries = this.calendarEntries()) {
        return [
            ...calendarEntries.filter(entry => entry.date === date),
            ...this.activityEntriesForDate(date),
        ];
    }

    monthDates() {
        const year = this.displayMonth.getFullYear();
        const month = this.displayMonth.getMonth();
        const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
        const dayCount = new Date(year, month + 1, 0).getDate();
        const cellCount = Math.ceil((firstWeekday + dayCount) / 7) * 7;
        return Array.from({length: cellCount}, (_, index) =>
            localDate(year, month, 1 - firstWeekday + index),
        );
    }

    renderMonth() {
        const dates = this.monthDates();
        const weeks = [];
        for(let index = 0; index < dates.length; index += 7) {
            weeks.push(dates.slice(index, index + 7));
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
                    <button type="button" data-action="week">Week</button>
                </div>
            </header>
            ${this.renderCalendarTable(weeks.reverse(), heading, this.displayMonth.getMonth())}`;
    }

    renderCalendarTable(weeks, heading, displayMonth = null) {
        const today = isoDate();
        const calendarEntries = this.calendarEntries();
        const entriesByDate = new Map(weeks.flat().map(date =>
            [date, this.entriesForDate(date, calendarEntries)],
        ));
        const rows = weeks.map(dates => {
            const cells = dates.map(date => {
                const day = new Date(`${date}T12:00:00`);
                const entries = entriesByDate.get(date);
                const dateLabel = day.toLocaleDateString(undefined, {
                    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
                });
                const classes = [
                    'calendar-day',
                    date === this.selectedDate ? 'selected' : '',
                    date === today ? 'today' : '',
                    displayMonth !== null && day.getMonth() !== displayMonth ? 'outside-month' : '',
                ].filter(Boolean).join(' ');
                return `<td class="${classes}">
                    <button type="button" class="calendar-day--select" data-date="${date}"
                            aria-label="${escapeHTML(dateLabel)}, ${entries.length} ${entries.length === 1 ? 'session' : 'sessions'}"
                            aria-pressed="${date === this.selectedDate}"${date === today ? ' aria-current="date"' : ''}>
                        <span class="calendar-day--number">${day.getDate()}</span>
                        <span class="calendar-day--month">${day.toLocaleDateString(undefined, {month: 'short'})}</span>
                    </button>
                    ${entries.length ? `<ul class="calendar-day--events">${entries.map((entry, index) =>
                        this.renderCalendarPreview(entry, date, index)).join('')}</ul>` : ''}
                </td>`;
            }).join('');
            return `<tr data-week-start="${dates[0]}">
                <th scope="row" class="calendar-week">${this.weekSummary(dates, entriesByDate)}</th>
                ${cells}
            </tr>`;
        }).join('');
        return `
            <p class="training-calendar--scroll-hint">Scroll sideways to see the full week.</p>
            <div class="training-calendar--grid-wrap" role="region"
                 aria-label="${escapeHTML(heading)} calendar" tabindex="0">
                <table class="training-calendar--grid" aria-label="${escapeHTML(heading)}">
                    <colgroup><col class="calendar-week--column"><col span="7"></colgroup>
                    <thead><tr><th scope="col">Week</th>
                        ${weekdayNames.map(day => `<th scope="col">${day}</th>`).join('')}
                    </tr></thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>`;
    }

    renderCalendarPreview(entry, date, index) {
        const source = entry.source === 'activity' ? this.activityLabel(entry.activity)
            : entry.source === 'coaching' ? 'Coach'
                : entry.source === 'planned' ? 'Intervals' : 'Planned';
        const metrics = this.workoutMetrics(entry);
        return `<li class="calendar-event ${entry.source === 'activity' ? 'is-activity' : ''}">
            <button type="button" class="calendar-event--select" data-date="${date}"
                    data-card-index="${index}" aria-label="View ${escapeHTML(entry.name || 'Workout')} on ${date}">
                <span class="calendar-event--source">${entry.source === 'activity'
                    ? activityIcon(entry.activity) : ''}${escapeHTML(source)}</span>
                <strong class="calendar-event--name">${escapeHTML(entry.name || 'Workout')}</strong>
                <span class="calendar-event--metrics">${metrics.map(metric =>
                    `<span>${escapeHTML(metric)}</span>`).join('')}</span>
            </button>
            ${this.renderEntryProfile(entry)}
        </li>`;
    }

    activityLabel(activity) {
        return activityTypeLabel(activity?.activityType, activity?.sport || 'cycling');
    }

    workoutMetrics(entry) {
        if(entry.source === 'activity') {
            const activity = entry.activity;
            const load = activity.loadMetrics?.power?.value ?? activity.load;
            const metrics = [
                activity.duration ? `${Math.round(activity.duration / 60)} min` : null,
                activity.distance ? `${(activity.distance / 1000).toFixed(1)} km` : null,
                activity.averagePower ? `${Math.round(activity.averagePower)} W` : null,
                activity.averageHeartRate ? `${Math.round(activity.averageHeartRate)} bpm` : null,
                load != null ? `Load ${Math.round(load)}` : null,
                activity.rpe != null ? `RPE ${activity.rpe}` : null,
            ].filter(Boolean);
            return metrics.length ? metrics : ['Completed'];
        }
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

    renderEntryProfile(entry) {
        return entry.source === 'activity'
            ? renderPowerProfile({
                samples: entry.activity.powerProfile || entry.activity.streams?.power || [],
                ftp: this.ftp,
                label: entry.name,
            })
            : renderPowerProfile({
                intervals: entry.workout?.intervals || [],
                ftp: this.ftp,
                label: entry.name,
            });
    }

    renderEntry(entry) {
        const title = escapeHTML(entry.name || 'Workout');
        const metrics = this.workoutMetrics(entry);
        const source = entry.source === 'planned' ? 'Intervals'
            : entry.source === 'coaching' ? 'Coach'
                : entry.source === 'activity' ? `Completed ${this.activityLabel(entry.activity).toLowerCase()}` : 'Plan';
        const profile = this.renderEntryProfile(entry);
        const details = entry.source === 'activity' ? renderActivityDetails(entry.activity) : '';

        return `
            <li class="training-calendar--entry ${entry.source === 'activity' ? 'is-activity' : ''}">
                <div class="training-calendar--copy">
                    <div class="training-calendar--eyebrow">${entry.source === 'activity'
                        ? activityIcon(entry.activity) : ''}${escapeHTML(source)}</div>
                    <div class="training-calendar--name">${title}</div>
                    <div class="training-calendar--meta">
                        ${metrics.map(metric => `<span>${escapeHTML(metric)}</span>`).join('')}
                    </div>
                    ${profile}
                    ${details}
                </div>
                <div class="training-calendar--entry-actions">
                    ${entry.workout &&
                    (entry.source !== 'coaching' || this.canStartCoaching(entry.coaching))
                        ? `<button type="button" data-action="start"
                                   data-entry-date="${escapeHTML(entry.date || this.selectedDate)}"
                                   data-workout="${escapeHTML(entry.workout.id || '')}">Start</button>`
                        : !entry.workout && entry.source !== 'coaching' && entry.source !== 'activity'
                            ? '<span class="training-calendar--source">Workout is no longer in your library</span>'
                            : ''}
                    ${entry.source === 'coaching'
                        ? this.renderCoachingActions(entry)
                        : entry.source !== 'planned' && entry.source !== 'activity'
                            ? `<button type="button" data-action="remove" data-entry="${escapeHTML(entry.id)}">Remove</button>`
                            : entry.source === 'planned'
                                ? '<span class="training-calendar--source">Intervals.icu</span>' : ''}
                </div>
            </li>`;
    }

    activityEntriesForDate(date) {
        const externalActivities = (coachingData()?.activities || [])
            .filter(activity => activity.day === date)
            .map(activity => ({
                id: activity.id,
                date,
                name: activity.name || activity.original?.name || 'Activity',
                source: 'activity',
                activity,
            }));
        const externalIds = new Set(externalActivities.map(entry => String(entry.id)));
        const localActivities = this.localActivities
            .filter(activity => isoDate(new Date(activity.start ?? activity.timestamp)) === date &&
                !externalIds.has(String(activity.id)))
            .map(activity => ({
                id: activity.id,
                date,
                name: activity.name || 'Ride',
                source: 'activity',
                activity,
            }));
        return [...externalActivities, ...localActivities];
    }

    weekDates() {
        const [year, month, day] = this.selectedDate.split('-').map(Number);
        const selected = new Date(year, month - 1, day);
        const mondayOffset = (selected.getDay() + 6) % 7;
        return Array.from({length: 7}, (_, index) =>
            localDate(year, month - 1, day - mondayOffset + index),
        );
    }

    weeklyState(dates) {
        const data = coachingData();
        if(this.weekStateSource !== data) {
            this.weekStateSource = data;
            this.weekStates.clear();
            this.weekStateError = '';
        }
        const history = data?.activities || [];
        const profile = data?.profile;
        if(!profile || !history.length) return null;

        try {
            const today = localDay(new Date().toISOString(), profile.timeZone);
            if(dates[0] > today) return null;
            const asOf = dates[6] < today ? dates[6] : today;
            if(!history.some(activity => activity.sport === 'cycling' && activity.day <= asOf)) return null;
            if(!this.weekStates.has(asOf)) {
                const {chronicLoad, acuteLoad, formBalance, loadSource} = estimateState(history, profile, asOf);
                this.weekStates.set(asOf, Number.isFinite(chronicLoad)
                    ? {chronicLoad, acuteLoad, formBalance, loadSource}
                    : null);
            }
            return this.weekStates.get(asOf);
        } catch(error) {
            if(!this.weekStateError) {
                console.error('Unable to calculate weekly calendar training metrics:', error);
            }
            this.weekStateError = 'Weekly training metrics could not be calculated.';
            return null;
        }
    }

    weekSummary(dates, entriesByDate) {
        const activities = dates.flatMap(date => (entriesByDate?.get(date) || this.activityEntriesForDate(date))
            .filter(entry => entry.source === 'activity')
            .map(entry => entry.activity));
        const duration = activities.reduce((sum, activity) => sum + Number(activity.duration || 0), 0);
        const distance = activities.reduce((sum, activity) => sum + Number(activity.distance || 0), 0);
        const loadMetrics = activities.map(activity => activity.loadMetrics?.power?.value ?? activity.load)
            .filter(Number.isFinite);
        const state = this.weeklyState(dates);
        const minutes = Math.round(duration / 60);
        const durationText = `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
        const metrics = [
            ['Activities', activities.length],
            ['Time', durationText],
            ['Distance', `${(distance / 1000).toFixed(1)} km`],
            loadMetrics.length ? [loadMetrics.length === activities.length ? 'Load' : 'Known load',
                Math.round(loadMetrics.reduce((sum, value) => sum + value, 0))] : null,
            Number.isFinite(state?.chronicLoad) ? ['Fitness', Math.round(state.chronicLoad)] : null,
            Number.isFinite(state?.acuteLoad) ? ['Fatigue', Math.round(state.acuteLoad)] : null,
            Number.isFinite(state?.formBalance) ? ['Form', Math.round(state.formBalance)] : null,
        ].filter(Boolean);
        const source = {power: 'power', sessionRpe: 'session RPE', heartRate: 'heart rate', duration: 'duration'};
        return `<div class="training-calendar--week-summary" aria-label="Week ${weekNumber(dates[0])} training metrics">
            <h3>Week ${weekNumber(dates[0])}</h3>
            ${metrics.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}
            ${state ? `<p>Model: ${source[state.loadSource]}</p>` : ''}
        </div>`;
    }

    renderWeek() {
        const dates = this.weekDates();
        const startDate = new Date(`${dates[0]}T12:00:00`);
        const endDate = new Date(`${dates[6]}T12:00:00`);
        const sameMonth = startDate.getMonth() === endDate.getMonth();
        const heading = sameMonth
            ? `${startDate.toLocaleDateString(undefined, {month: 'long'})} ${startDate.getDate()}–${endDate.getDate()}, ${endDate.getFullYear()}`
            : `${startDate.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})} – ${endDate.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'})}`;
        return `
            <header class="training-calendar--header">
                <div>
                    <h2 class="list--sub-heading">Training calendar</h2>
                    <p class="training-calendar--week-label">${escapeHTML(heading)}</p>
                </div>
                <div class="training-calendar--navigation">
                    <button type="button" data-action="week-previous" aria-label="Previous week">‹</button>
                    <button type="button" data-action="week-today">Today</button>
                    <button type="button" data-action="week-next" aria-label="Next week">›</button>
                    <button type="button" data-action="month">Month</button>
                </div>
            </header>
            ${this.renderCalendarTable([dates], heading)}`;
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
            ? entries.map(entry => this.renderEntry(entry)).join('')
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
                ${this.weekStateError
                    ? `<p class="training-calendar--error" role="alert">${escapeHTML(this.weekStateError)}</p>`
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
        const focusedCardIndex = activeElement?.dataset.cardIndex;
        const focusedAction = activeElement?.dataset.action;
        const focusedEntry = activeElement?.dataset.entry;
        const gridHadFocus = activeElement?.classList.contains('training-calendar--grid-wrap');
        const gridScrollLeft = this.querySelector('.training-calendar--grid-wrap')?.scrollLeft || 0;
        const focusedWorkout = activeElement?.matches('[name="workout"]')
            ? activeElement.value
            : this.querySelector('[name="workout"]')?.value;

        this.innerHTML = `${this.view === 'month' ? this.renderMonth() : this.renderWeek()}${this.renderSelectedDate()}`;

        const grid = this.querySelector('.training-calendar--grid-wrap');
        if(grid) grid.scrollLeft = gridScrollLeft;

        const select = this.querySelector('[name="workout"]');
        if(select && focusedWorkout && [...select.options].some((option) => option.value === focusedWorkout)) {
            select.value = focusedWorkout;
        }

        let nextFocus;
        if(focusedDate) {
            nextFocus = [...this.querySelectorAll('[data-date]')]
                .find((element) => element.dataset.date === focusedDate &&
                    element.dataset.cardIndex === focusedCardIndex);
        } else if(focusedAction) {
            nextFocus = [...this.querySelectorAll('[data-action]')].find((element) =>
                element.dataset.action === focusedAction &&
                (!focusedEntry || element.dataset.entry === focusedEntry)
            );
        } else if(activeElement?.matches('[name="workout"]')) {
            nextFocus = select;
        } else if(gridHadFocus) {
            nextFocus = grid;
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
        } else if(action.dataset.action === 'week-previous' ||
                  action.dataset.action === 'week-next' ||
                  action.dataset.action === 'week-today') {
            if(action.dataset.action === 'week-today') {
                this.selectedDate = isoDate();
            } else {
                const [year, month, day] = this.selectedDate.split('-').map(Number);
                const selected = new Date(year, month - 1, day);
                selected.setDate(selected.getDate() +
                    (action.dataset.action === 'week-previous' ? -7 : 7));
                this.selectedDate = isoDate(selected);
            }
            this.displayMonth = new Date(`${this.selectedDate}T12:00:00`);
            this.plannedWorkouts = [];
            this.loadPlannedMonth();
        } else if(action.dataset.action === 'month') {
            this.view = 'month';
            this.displayMonth = new Date(`${this.selectedDate}T12:00:00`);
            this.plannedWorkouts = [];
            this.render();
            this.loadPlannedMonth();
        } else if(action.dataset.action === 'week') {
            this.view = 'week';
            this.plannedWorkouts = [];
            this.render();
            this.loadPlannedMonth();
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
            const entry = this.entriesForDate(action.dataset.entryDate || this.selectedDate).find(
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
