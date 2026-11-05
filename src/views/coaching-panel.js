/*
 * coaching-panel.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * renders the screen, controls, and UI panels that let a rider interact with the app.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf } from '../functions.js';
import { db } from '../db.js';
import { coachingService, coachingData } from '../coaching/service.js';
import { GOALS, localDay, addDays } from '../coaching/domain.js';
import { fileHandler } from '../file.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DEFAULT_LIMITS = {2: 60, 4: 60, 6: 120};
const label = value => String(value ?? '').replaceAll('_', ' ').replace(/^./, c => c.toUpperCase());
const PRIORITIES = {A: 'A - main goal of the season', B: 'B - important', C: 'C - secondary / training event'};
const EXPERIENCE = {beginner: 'Beginner (less than 1 year structured)', intermediate: 'Intermediate (1-3 years)', advanced: 'Advanced (3+ years)'};
const PHASES = {
    assessment: 'Baseline - getting to know you', preparation: 'Preparation', base: 'Base - building endurance',
    build: 'Build - raising intensity', specific: 'Event-specific', peak: 'Peak', taper: 'Taper - freshening up',
    recovery: 'Recovery week', event: 'Event day',
};
const STATUS = {scheduled: 'Planned', completed: 'Done', substituted: 'Done (substitute)', missed: 'Missed', failed: 'Not completed'};
const DATA_QUALITY = {
    supported: 'Enough recent ride history for personalised targets.',
    limited: 'Limited ride history, so targets are kept conservative.',
    insufficient: 'No ride history yet, so the plan starts with easy baseline rides.',
};
const FEELINGS = [
    ['legFreshness', 'How fresh did your legs feel?', ['Very heavy', 'Heavy', 'Normal', 'Fresh', 'Very fresh']],
    ['sleepQuality', 'How did you sleep?', ['Very poorly', 'Poorly', 'OK', 'Well', 'Very well']],
    ['muscleSoreness', 'How sore are your muscles?', ['Not sore', 'Slightly', 'Moderately', 'Very', 'Extremely']],
    ['stress', 'How stressed do you feel?', ['Not at all', 'A little', 'Moderately', 'Very', 'Extremely']],
];
const RPE = ['Rest', 'Very, very easy', 'Very easy', 'Easy', 'Moderate', 'Somewhat hard', 'Hard', 'Very hard',
    'Very, very hard', 'Near maximal', 'Maximal'];
const HEART_RATE = [['maxHeartRate', 'Maximum heart rate'], ['thresholdHeartRate', 'Threshold heart rate'],
    ['restingHeartRate', 'Resting heart rate']];
const EQUIPMENT = [['powerMeter', 'Power meter'], ['heartRateMonitor', 'Heart-rate monitor'], ['smartTrainer', 'Smart trainer']];
const GOAL_NUMBERS = [['distanceKm', 'Distance', 'km', '0.1'], ['elevationM', 'Climbing', 'm', '1'],
    ['expectedDurationMinutes', 'Expected duration', 'min', '1'], ['finishTimeMinutes', 'Target finish time', 'min', '1'],
    ['targetPower', 'Target power', 'W', '1'], ['targetFTP', 'Target FTP', 'W', '1'], ['targetWKg', 'Target W/kg', 'W/kg', '0.1']];
const TERRAIN = ['', 'flat', 'rolling', 'hilly', 'mountainous'];
const HORIZONS = [[42, 'In about 6 weeks'], [91, 'Within 3 months'], [182, 'Within 6 months'], [365, 'Within a year']];

const dayLabel = (day, options = {weekday: 'short', day: 'numeric', month: 'short'}) =>
    new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {...options, timeZone: 'UTC'});
const minutes = seconds => `${Math.round(seconds / 60)} min`;
const optional = value => value === '' || value == null ? undefined : Number(value);
const selected = condition => condition ? 'selected' : '';

class CoachingPanel extends HTMLElement {
    connectedCallback() {
        this.controller = new AbortController();
        const options = {signal: this.controller.signal};
        this.addEventListener('submit', event => this.submit(event), options);
        this.addEventListener('click', event => this.click(event), options);
        xf.sub('coaching:changed', () => this.render(), options);
        xf.sub('db:ftp', () => this.render(), options);
        xf.sub('db:weight', () => this.render(), options);
        xf.sub('coaching:error', message => { this.error = message; this.render(); }, options);
        this.render();
    }
    disconnectedCallback() { this.controller.abort(); }
    render({keepInput = false} = {}) {
        const fields = keepInput ? [...this.querySelectorAll('[data-coach-form] [name]')]
            .map(el => [el.form?.dataset.coachForm, el.name, el.value]) : [];
        const open = new Set([...this.querySelectorAll('details[open] > summary')].map(el => el.textContent));
        try {
            const data = coachingData();
            if(!data) {
                this.innerHTML = `<p role="${this.error ? 'alert' : 'status'}">${escape(this.error || 'Loading coaching history...')}</p>`;
                return;
            }
            const plan = data.plan?.status === 'active' ? data.plan : null;
            this.innerHTML = `
                ${this.error ? `<p class="coach-alert" role="alert">${escape(this.error)}</p>` : ''}
                ${this.notice ? `<p class="coach-notice" role="status">${escape(this.notice)}</p>` : ''}
                ${plan ? this.planView(data, plan) : this.setupForm(data)}
                <p class="coach-disclaimer">Training decision support, not medical advice. Recommendations are
                    conservative, deterministic rules, not guarantees.</p>`;
            this.notice = '';
            for(const [form, name, value] of fields) {
                const el = this.querySelector(`[data-coach-form="${form}"] [name="${name}"]`);
                if(el && el.type !== 'submit') el.value = value;
            }
            for(const summary of this.querySelectorAll('details > summary')) {
                if(open.has(summary.textContent)) summary.parentElement.open = true;
            }
        } catch(error) {
            console.error('Unable to render coaching:', error);
            this.innerHTML = `<p role="alert">Coaching unavailable: ${escape(error.message)}</p>`;
        }
    }
    planView(data, plan) {
        const profile = data.profile, state = data.snapshots.at(-1), goal = plan.goalDefinition || data.goal || {};
        const today = localDay(new Date().toISOString(), profile.timeZone);
        const ftpChanged = profile.ftp !== (db.ftp || null);
        const workouts = [...plan.workouts].sort((a, b) => a.date.localeCompare(b.date));
        const upcoming = workouts.filter(w => w.status === 'scheduled' && w.date >= today);
        const overdue = workouts.filter(w => w.status === 'scheduled' && w.date < today).length;
        const done = workouts.filter(w => ['completed', 'substituted'].includes(w.status)).length;
        const phase = plan.phases.find(p => p.startDate <= today && today <= p.endDate) || plan.phases[0];
        const week = plan.weeks.filter(w => w.startDate <= today).at(-1) || plan.weeks[0];
        const daysLeft = Math.max(0, Math.round((Date.parse(goal.date || plan.endDate) - Date.parse(today)) / 86400000));
        const progress = workouts.length ? Math.round(done / workouts.length * 100) : 0;
        const next = upcoming[0];
        return `
            <header class="coach-hero">
                <div>
                    <p class="eyebrow">Your goal</p>
                    <h2>${escape(goal.name || 'Training plan')}</h2>
                    <p class="muted">${escape(label(goal.type))} · ${escape(dayLabel(goal.date || plan.endDate,
                        {weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'}))}</p>
                </div>
                <div class="coach-stats">
                    <div><strong>${daysLeft}</strong><span>days to go</span></div>
                    <div><strong>${done}/${workouts.length}</strong><span>sessions done</span></div>
                    <div><strong>${week ? Math.round(week.scheduledMinutes) : 0}</strong><span>min this week</span></div>
                </div>
                <div class="coach-progress" role="progressbar" aria-label="Plan progress" aria-valuemin="0"
                    aria-valuemax="100" aria-valuenow="${progress}"><i style="width: ${progress}%"></i></div>
                ${phase ? `<p class="coach-phase"><span class="coach-badge">${escape(PHASES[phase.type] || label(phase.type))}</span>
                    until ${escape(dayLabel(phase.endDate))}</p>` : ''}
            </header>
            ${ftpChanged ? `<p class="coach-alert" role="alert">Your profile FTP has changed (plan: ${escape(profile.ftp ?? 'none')} W,
                profile: ${escape(db.ftp ?? 'none')} W). Archive and regenerate this plan before starting its workouts.</p>` : ''}
            ${!plan.workouts.length ? '<p class="coach-alert" role="status">No sessions fit the current training-load and availability limits. Review the warnings below and check your history and profile before archiving and regenerating.</p>' : ''}
            ${overdue ? `<div class="coach-callout">
                <p><strong>${overdue} past session${overdue === 1 ? '' : 's'} not yet resolved.</strong>
                    Rides you recorded are matched automatically. Review the rest so the coach can adapt; missed training is never made up.</p>
                <button type="button" data-coach="review">Review missed sessions</button></div>` : ''}
            <div class="coach-grid">
                <section class="coach-card">
                    <h3>Next session</h3>
                    ${next ? `
                        <p class="coach-next-date">${next.date === today ? 'Today' : escape(dayLabel(next.date, {weekday: 'long', day: 'numeric', month: 'long'}))}</p>
                        <p class="coach-next-title">${escape(next.title)}</p>
                        <p class="muted">${minutes(next.duration)} · Effort ${escape(next.expectedRpe)}/10 (${escape(RPE[next.expectedRpe] || '')})</p>
                        <p>${escape(String(next.description ?? "").replace(/^./, c => c.toUpperCase()))}</p>
                        <a class="button" href="#/calendar">${next.date === today ? 'Start from calendar' : 'Open calendar'}</a>`
                        : '<p class="muted">No more sessions are planned. Archive this plan and set a new goal to continue.</p>'}
                </section>
                <section class="coach-card">
                    <h3>Coming up</h3>
                    ${upcoming.length > 1 ? `<ol class="coach-upcoming">${upcoming.slice(1, 7).map(w => `
                        <li><span>${escape(dayLabel(w.date))}</span><strong>${escape(w.title)}</strong>
                            <span class="muted">Effort ${escape(w.expectedRpe)}/10</span></li>`).join('')}</ol>
                        <a href="#/calendar">See full calendar</a>`
                        : '<p class="muted">Nothing else scheduled.</p>'}
                </section>
            </div>
            ${this.feedbackForm(data)}
            <section class="coach-card">
                <h3>Adjust your plan</h3>
                <div class="coach-actions">
                    <div><button type="button" class="secondary" data-coach="recovery">Make upcoming training easier</button>
                        <p class="muted">Feeling tired, ill or short on time? Future sessions are reduced; nothing is made up later.</p></div>
                    ${overdue ? '' : `<div><button type="button" class="secondary" data-coach="review">Review missed sessions</button>
                        <p class="muted">Marks past, unmatched sessions as missed and adapts the plan.</p></div>`}
                    <div>${this.confirmArchive ? `<button type="button" class="danger" data-coach="archive">Yes, archive this plan</button>
                        <button type="button" class="secondary" data-coach="cancel-archive">Cancel</button>`
                        : '<button type="button" class="secondary" data-coach="confirm-archive">Archive plan and start over</button>'}
                        <p class="muted">Needed after changing FTP, availability or your goal. History is kept.</p></div>
                </div>
            </section>
            <details class="coach-card">
                <summary>Why this plan? <span class="muted">Revision ${plan.revision}</span></summary>
                <p>${escape(plan.rationale)}</p>
                <p><strong>Ride data:</strong> ${escape(DATA_QUALITY[state?.sufficiency] || state?.sufficiency)}
                    Load is measured by ${escape(state?.loadSource)}. ${escape(state?.readiness.reason)}</p>
                <h4>Phases</h4>
                <ul>${plan.phases.map(p => `<li>${escape(dayLabel(p.startDate))} - ${escape(dayLabel(p.endDate))}:
                    <strong>${escape(PHASES[p.type] || label(p.type))}</strong>. ${escape(p.rationale)}</li>`).join('')}</ul>
                <h4>Weeks</h4>
                <ul>${plan.weeks.map(w => `<li>Week of ${escape(dayLabel(w.startDate))}: ${Math.round(w.scheduledMinutes)} min.
                    ${escape(w.rationale)}</li>`).join('')}</ul>
                ${[...plan.validationWarnings, ...(state?.warnings || [])].length ? `<h4>Warnings</h4>
                    <ul>${[...plan.validationWarnings, ...(state?.warnings || [])].map(w => `<li>${escape(w)}</li>`).join('')}</ul>` : ''}
                ${plan.adaptations.length ? `<h4>Recent changes</h4>
                    <ul>${plan.adaptations.slice(-5).map(a => `<li>${escape(new Date(a.timestamp).toLocaleString())}:
                        ${escape(a.reasoning)}</li>`).join('')}</ul>` : ''}
                <p class="muted">Session status: ${Object.entries(STATUS).map(([key, text]) =>
                    `${text} ${workouts.filter(w => w.status === key).length}`).join(' · ')}</p>
            </details>
            ${this.historyTools()}`;
    }
    feedbackForm(data) {
        const rides = [...data.activities].reverse().slice(0, 20);
        return `<details class="coach-card" ${rides.length ? '' : 'hidden'}>
            <summary>How did your last ride feel?</summary>
            <p class="muted">Optional. Your answers help the coach decide whether to ease off. Leave anything blank to skip it.</p>
            <form data-coach-form="feedback">
                <label>Ride<select name="activity" required>
                    ${rides.map(a => `<option value="${escape(a.id)}">${escape(dayLabel(a.day))} - ${Math.round(a.duration / 60)} min</option>`).join('')}
                </select></label>
                <div class="coach-fields">
                    <label>How hard was it overall?<select name="rpe"><option value="">Skip</option>
                        ${RPE.map((text, value) => `<option value="${value}">${value} - ${text}</option>`).join('')}</select></label>
                    ${FEELINGS.map(([name, question, answers]) => `<label>${question}<select name="${name}"><option value="">Skip</option>
                        ${answers.map((text, index) => `<option value="${index + 1}">${text}</option>`).join('')}</select></label>`).join('')}
                </div>
                <button type="submit">Save feedback</button>
            </form>
        </details>`;
    }
    historyTools() {
        return `<details class="coach-card">
            <summary>Ride history and backup</summary>
            <p class="muted">Rides you record in Athlima are added automatically. For better targets, connect
                Intervals.icu in <a href="#/settings">Settings</a>, or paste rides in the documented JSON format below
                (duration in seconds, ISO start time with offset).</p>
            <form data-coach-form="import"><label>Rides JSON
                <textarea name="rides" required rows="5">[]</textarea></label>
                <button type="submit" class="secondary">Import rides</button></form>
            <button type="button" class="secondary" data-coach="export">Download coaching history</button>
        </details>`;
    }
    setupForm(data) {
        const profile = data.profile, goal = data.goal;
        const timeZone = profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const today = localDay(new Date().toISOString(), timeZone);
        const limits = profile?.maxSessionMinutes || DEFAULT_LIMITS;
        const hasHistory = data.plan && data.plan.status !== 'active';
        const ready = db.weight > 0;
        return `
            <header class="coach-intro">
                <h2>${hasHistory ? 'Set up your next plan' : 'Create your training plan'}</h2>
                <p>Answer a few questions and the coach builds a day-by-day plan towards your goal. It fits your
                    schedule and adapts automatically after every ride. Takes about two minutes.</p>
                ${hasHistory ? `<p class="muted">Your previous plan ended (${escape(data.plan.status)}). Its history is kept.</p>` : ''}
            </header>
            <form data-coach-form="setup" class="coach-setup">
                <section class="coach-step">
                    <h3><span class="coach-step-number">1</span>Check your rider profile</h3>
                    <ul class="coach-checklist">
                        <li class="${db.ftp ? 'ok' : 'warn'}">FTP: <strong>${db.ftp ? `${escape(db.ftp)} W` : 'not set'}</strong>
                            ${db.ftp ? '' : '<span class="muted">- sessions will use effort (RPE) guidance instead of watts</span>'}</li>
                        <li class="${ready ? 'ok' : 'warn'}">Body weight: <strong>${ready ? `${escape(db.weight)} kg` : 'not set (required)'}</strong></li>
                    </ul>
                    <p class="muted">Not right? Update them in <a href="#/settings">Settings</a> first; the plan uses these values.</p>
                </section>

                <section class="coach-step">
                    <h3><span class="coach-step-number">2</span>What are you training for?</h3>
                    <div class="coach-fields">
                        <label>Goal name<input name="name" value="${escape(goal?.name || 'My cycling goal')}" required
                            placeholder="e.g. Marmotte, first 100 km, higher FTP"></label>
                        <label>Goal type<select name="type">${Object.keys(GOALS).map(v =>
                            `<option value="${v}" ${selected(v === (goal?.type || 'general_fitness'))}>${escape(label(v))}</option>`).join('')}</select></label>
                        <label>When do you want to reach it?<select name="horizon">${HORIZONS.map(([days, text]) =>
                            `<option value="${days}" ${selected(days === 91)}>${text}</option>`).join('')}</select>
                            <small>The plan builds up to the end of this period.</small></label>
                        <label>How important is it?<select name="priority">${Object.entries(PRIORITIES).map(([v, text]) =>
                            `<option value="${v}" ${selected(v === (goal?.priority || 'A'))}>${text}</option>`).join('')}</select></label>
                    </div>
                    <details><summary>Event details (optional)</summary>
                        <p class="muted">Adding the event's demands makes the plan more specific.</p>
                        <div class="coach-fields">
                            <label>Event date<input type="date" name="date" min="${today}">
                                <small>Have a fixed event day? It replaces the time frame above.</small></label>
                            ${GOAL_NUMBERS.map(([name, text, unit, step]) => `<label>${text} (${unit})<input type="number" name="${name}"
                                min="0" step="${step}" value="${escape(goal?.[name] ?? '')}"></label>`).join('')}
                            <label>Terrain<select name="terrain">${TERRAIN.map(v =>
                                `<option value="${v}" ${selected(v === (goal?.terrain || ''))}>${v ? label(v) : 'Not specified'}</option>`).join('')}</select></label>
                            <label>Objective<input name="completionObjective" value="${escape(goal?.completionObjective || '')}"
                                placeholder="e.g. finish comfortably"></label>
                        </div>
                    </details>
                </section>

                <section class="coach-step">
                    <h3><span class="coach-step-number">3</span>When can you ride?</h3>
                    <p class="muted">Enter the longest ride you can do on each day, in minutes. Use 0 for rest days.</p>
                    <div class="coach-days">${DAYS.map((day, index) => `
                        <div class="coach-day">
                            <label>${day.slice(0, 3)}<input name="day${index}" type="number" min="0" max="1440" step="5"
                                value="${escape(limits[index] || 0)}" aria-label="${day} minutes" required></label>
                            <select name="env${index}" aria-label="${day} indoor or outdoor">${['either', 'indoor', 'outdoor'].map(v =>
                                `<option value="${v}" ${selected(v === (profile?.dayPreferences?.[index] || 'either'))}>${label(v)}</option>`).join('')}</select>
                        </div>`).join('')}</div>
                    <div class="coach-fields">
                        <label>Long-ride day<select name="longDay"><option value="">No preference</option>${DAYS.map((day, index) =>
                            `<option value="${index}" ${selected(index === (profile ? profile.longRideDay : 6))}>${day}</option>`).join('')}</select></label>
                        <label>Hours you usually ride per week<input type="number" name="hours" min="0.5" step="0.5"
                            value="${escape(profile?.typicalWeeklyHours || 3)}" required></label>
                        <label>Most hours you could ride in a week<input type="number" name="maxHours" min="0.5" step="0.5"
                            value="${escape(profile?.maxWeeklyHours || 4)}" required></label>
                        <label>Cycling experience<select name="experience">${Object.entries(EXPERIENCE).map(([v, text]) =>
                            `<option value="${v}" ${selected(v === (profile?.experience || 'beginner'))}>${text}</option>`).join('')}</select></label>
                    </div>
                </section>

                <section class="coach-step">
                    <h3><span class="coach-step-number">4</span>Create your plan</h3>
                    <p class="muted">Rides recorded in Athlima are included automatically. For better targets, connect
                        Intervals.icu in <a href="#/settings">Settings</a> before creating the plan; you can also import rides later.</p>
                    <details><summary>More options</summary>
                        <div class="coach-fields">
                            <label>Plan start date<input type="date" name="start" value="${today}" required></label>
                            <label>Time zone<input name="timeZone" value="${escape(timeZone)}" required></label>
                            ${HEART_RATE.map(([name, text]) => `<label>${text} (bpm)<input type="number" name="${name}" min="1" max="255"
                                value="${escape(profile?.[name] ?? '')}"></label>`).join('')}
                            ${EQUIPMENT.map(([name, text]) => `<label>${text}<select name="${name}">${[['', 'Not specified'], ['yes', 'Yes'], ['no', 'No']]
                                .map(([v, t]) => `<option value="${v}" ${selected(v === (profile?.[name] == null ? '' : profile[name] ? 'yes' : 'no'))}>${t}</option>`).join('')}
                                </select></label>`).join('')}
                        </div>
                    </details>
                    <div class="coach-submit">
                        <button type="submit" name="operation" value="generate" ${ready ? '' : 'disabled'}>Create my plan</button>
                        <p class="muted">Your answers are saved with the plan. You can change them later by archiving the plan and starting over.</p>
                    </div>
                </section>
            </form>
            ${profile ? this.historyTools() : ''}`;
    }
    profileFrom(values, service) {
        const limits = Object.fromEntries(Array.from({length: 7}, (_, day) =>
            [day, Number(values.get(`day${day}`))]).filter(([, limit]) => limit > 0));
        if(!Object.keys(limits).length) throw new Error('Enter minutes for at least one day you can ride (step 3).');
        const longDay = values.get('longDay');
        if(longDay !== '' && longDay != null && !limits[longDay]) {
            throw new Error(`You chose ${DAYS[longDay]} as long-ride day but entered 0 minutes for it (step 3).`);
        }
        const hours = Number(values.get('hours')), maxHours = Number(values.get('maxHours'));
        if(hours > maxHours) throw new Error('Usual weekly hours cannot be more than the most hours you could ride (step 3).');
        const dayPreferences = Object.fromEntries(Object.keys(limits)
            .map(day => [day, values.get(`env${day}`) || 'either']).filter(([, v]) => v !== 'either'));
        const profile = {
            id: service.data.profile?.id || 'local-athlete',
            ftp: db.ftp || null, weight: db.weight, unitSystem: db.measurement,
            experience: values.get('experience'), timeZone: values.get('timeZone'),
            typicalWeeklyHours: hours, maxWeeklyHours: maxHours,
            longRideDay: longDay === '' || longDay == null ? null : Number(longDay),
            maxSessionMinutes: limits, availableDays: Object.keys(limits).map(Number),
        };
        if(Object.keys(dayPreferences).length) profile.dayPreferences = dayPreferences;
        for(const [name] of HEART_RATE) if(optional(values.get(name)) != null) profile[name] = optional(values.get(name));
        for(const [name] of EQUIPMENT) if(values.get(name)) profile[name] = values.get(name) === 'yes';
        return profile;
    }
    goalFrom(values) {
        const start = values.get('start');
        const date = values.get('date') || addDays(start, Number(values.get('horizon')) || 91);
        if(date <= start) throw new Error('The event date must be after the plan start date (step 2).');
        if(date > addDays(start, 366)) throw new Error('The event date must be within a year of the plan start (step 2).');
        const goal = {id: 'cycling-goal', name: values.get('name'), type: values.get('type'),
            priority: values.get('priority'), date, active: true};
        for(const [name] of GOAL_NUMBERS) if(optional(values.get(name)) != null) goal[name] = optional(values.get(name));
        if(values.get('terrain')) goal.terrain = values.get('terrain');
        if(values.get('completionObjective')) goal.completionObjective = values.get('completionObjective');
        return goal;
    }
    changed() {
        this.error = '';
        const notice = this.notice;
        xf.dispatch('coaching:changed');
        this.notice = notice;
        this.render();
        this.querySelector('.coach-notice')?.scrollIntoView?.({behavior: 'smooth', block: 'center'});
    }
    async submit(event) {
        const form = event.target.closest('[data-coach-form]');
        if(!form) return;
        event.preventDefault();
        try {
            const service = coachingService(), values = new FormData(form);
            if(form.dataset.coachForm === 'setup') {
                const profile = this.profileFrom(values, service), goal = this.goalFrom(values);
                await service.configure(profile, goal);
                await service.importActivities(db.activity.filter(a => a.duration > 0).map(a => ({
                    id: a.id, duration: a.duration, source: 'athlima-summary',
                    start: new Date(a.timestamp - a.duration * 1000).toISOString(),
                })));
                if(event.submitter?.value === 'generate') {
                    await service.generate(values.get('start'));
                    this.notice = 'Your plan is ready. Sessions now appear in your training calendar.';
                } else {
                    this.notice = 'Answers saved. Choose "Create my plan" when you are ready.';
                }
            } else if(form.dataset.coachForm === 'import') {
                const rides = JSON.parse(values.get('rides'));
                await service.importActivities(rides);
                this.notice = `Imported ${rides.length} ride${rides.length === 1 ? '' : 's'}.`;
            } else {
                const feedback = Object.fromEntries(['rpe', 'legFreshness', 'sleepQuality', 'muscleSoreness', 'stress']
                    .filter(key => values.get(key) !== '').map(key => [key, Number(values.get(key))]));
                await service.updateFeedback(values.get('activity'), feedback);
                this.notice = 'Thanks, feedback saved. Upcoming sessions were adapted if needed.';
            }
            this.changed();
        } catch(error) {
            console.error('Coaching action failed:', error);
            this.error = error.message || error.name || 'Coaching action failed.';
            this.render({keepInput: true});
            this.querySelector('[role=alert]')?.scrollIntoView?.({behavior: 'smooth', block: 'center'});
        }
    }
    async click(event) {
        const button = event.target.closest('[data-coach]');
        if(!button) return;
        const action = button.dataset.coach;
        if(['confirm-archive', 'cancel-archive'].includes(action)) {
            this.confirmArchive = action === 'confirm-archive';
            this.render();
            return;
        }
        try {
            const service = coachingService();
            this.confirmArchive = false;
            if(action === 'archive') {
                await service.archive();
                this.notice = 'Plan archived. Review your answers below to create a new one.';
            }
            if(action === 'review') {
                await service.advance();
                this.notice = 'Past sessions reviewed and the plan was adapted.';
            }
            if(action === 'recovery') {
                await service.resolve({trigger: 'recovery'});
                this.notice = 'Upcoming sessions were made easier.';
            }
            if(action === 'export') {
                fileHandler.download()(JSON.stringify(service.data, null, 2), 'athlima-coaching-history.json', 'application/json');
            }
            this.changed();
        } catch(error) {
            console.error('Coaching action failed:', error);
            this.error = error.message || error.name || 'Coaching action failed.';
            this.render({keepInput: true});
            this.querySelector('[role=alert]')?.scrollIntoView?.({behavior: 'smooth', block: 'center'});
        }
    }
}

customElements.define('coaching-panel', CoachingPanel);
export { CoachingPanel };
