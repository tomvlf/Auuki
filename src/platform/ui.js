/*
 * ui.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf } from '../functions.js';
import intervals from '../models/intervals.js';
import { coachingData, coachingService } from '../coaching/service.js';
import { toAppWorkout } from '../coaching/workouts.js';
import { addDays } from '../coaching/domain.js';
import { cadenceSummary, escape, minutes, number, time, today, trainingSummary, profileGraph, mobileDetails } from './format.js';
import { activityLists, historyActivityRow, localActivityRow, renderActivityOverview, renderActivityStreamData } from './activities.js';
import { initialLibraryFilters, renderLibrary } from './library.js';
import { renderPlan } from './plan-view.js';
import { rideTimeline, ridePosition, rideProfile } from './ride.js';
import { mountVersions, versionMarkup } from './version.js';

const routes = {
    dashboard: ['Overview', 'Your training, in focus'],
    calendar: ['Training calendar', 'Make room for progress'],
    plan: ['Training plan', 'A purposeful path to your goal'],
    coach: ['Coach', 'Guidance grounded in your training'],
    library: ['Workout library', 'Find your next session'],
    workout: ['Workout details', 'Know the work ahead'],
    player: ['Ride', 'One interval at a time'],
    activities: ['Activities', 'Every ride is part of the story'],
    progress: ['Progress', 'Consistency, made visible'],
    devices: ['Devices', 'Connected and ready to ride'],
    settings: ['Settings', 'Your profile and integrations'],
};
const devices = {
    controllable: 'Smart trainer', heartRateMonitor: 'Heart rate',
    powerMeter: 'Power meter', speedCadenceSensor: 'Speed / cadence',
};
const card = (title, body, className = '', compact = false) => `<section class="panel ${className}">${compact
    ? mobileDetails(title, title, `<h2 class="desktop-section-title">${title}</h2>${body}`)
    : `<h2>${title}</h2>${body}`}</section>`;
const link = (route, text, className = '') => `<a class="${className}" href="#/${route}">${text}</a>`;
const empty = (text, route = 'library', action = 'Browse workouts') =>
    `<div class="empty-state"><p>${text}</p>${link(route, action, 'button secondary')}</div>`;
const stat = (label, value, unit = '') => `<div class="stat"><span>${label}</span><strong>${value}<small>${unit}</small></strong></div>`;

/**
 * Launches the main training platform shell and hosts the navigation routing logic.
 *
 * This is the app-level UI entry point: it creates the side navigation, bootstraps the
 * current route, and then lets other modules render the dashboard, calendar, plan, and
 * settings views into the same shell.
 *
 * @param {Element} root - Root DOM element that will receive the platform markup.
 * @returns {Promise<void>} Resolves after the platform shell and route plumbing are ready.
 */
export async function launchPlatform(root) {
    root.removeAttribute('role');
    let mobile = window.innerWidth <= 700;
    document.body.classList.add('platform-app');
    document.body.classList.toggle('mobile-app', mobile);
    const navigation = () => (mobile
        ? ['dashboard', 'player', 'devices', 'activities', 'settings']
        : Object.keys(routes).filter(r => r !== 'workout'))
        .map(route => link(route, routes[route][0])).join('');
    root.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a>
        <aside class="sidebar"><a class="brand" href="${mobile ? '/mobile' : '/'}">Athlima<span> / training</span></a>
            <nav aria-label="Main navigation">${navigation()}</nav>
            <div class="sidebar-bottom"><span>Train with intention.</span></div>
            ${mobile ? '' : versionMarkup({showRevision: false})}
        </aside>
        <main id="main-content" tabindex="-1"><header class="platform-header">
            <div><p class="eyebrow" id="route-subtitle"></p><h1 id="route-title" tabindex="-1"></h1></div>
        </header><div id="platform-message" role="status" aria-live="polite"></div>
        <div id="platform-content"><p role="status">Loading your training...</p></div>
        <div id="legacy-slot"></div></main>`;
    if(!mobile) mountVersions(root);
    const legacy = document.querySelector('.wrapper');
    root.querySelector('#legacy-slot').append(legacy);
    const deviceSettings = legacy.querySelector('#view--settings-settings');
    if(deviceSettings) {
        const secondaryDevices = [...deviceSettings.querySelectorAll(':scope > .device-card')].slice(1);
        const options = deviceSettings.querySelector(':scope > .list--sub-section');
        const about = deviceSettings.querySelector(':scope > div > .page--heading')?.parentElement;
        for(const [index, section] of [...secondaryDevices, options, about].filter(Boolean).entries()) {
            const title = section.querySelector('.device-card--header--label, h2')?.textContent.trim();
            if(!title) continue;
            section.insertAdjacentHTML('beforebegin', mobileDetails(`device-options-${index}`, title, ''));
            const disclosure = section.previousElementSibling;
            disclosure.open = !mobile;
            disclosure.querySelector('.mobile-details-body').append(section);
        }
    }
    const content = root.querySelector('#platform-content');
    const message = root.querySelector('#platform-message');
    let db;
    let engineModels;
    const targetPower = (value, ftp) => engineModels.ftp.toAbsolute(value, ftp);
    let route = 'dashboard';
    let selectedId = '';
    let integration;
    let integrationLoading = false;
    const activityDataCache = new Map();
    let busy = false;
    let ready = false;
    const mobileSections = new Map();
    const updateMobileSections = () => {
        root.querySelectorAll('[data-mobile-details]').forEach(section => {
            section.open = !mobile || Boolean(section.querySelector('[role="alert"]')) ||
                (mobileSections.get(section.dataset.mobileDetails) ?? false);
        });
    };
    root.addEventListener('toggle', event => {
        if(ready && mobile && event.target.matches('[data-mobile-details]')) {
            mobileSections.set(event.target.dataset.mobileDetails, event.target.open);
        }
    }, true);
    window.addEventListener('resize', () => {
        const nextMobile = window.innerWidth <= 700;
        if(nextMobile === mobile) return;
        mobile = nextMobile;
        document.body.classList.toggle('mobile-app', mobile);
        root.querySelector('.sidebar nav').innerHTML = navigation();
        root.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current',
            a.getAttribute('href') === `#/${route}` ? 'page' : 'false'));
        const sidebar = root.querySelector('.sidebar');
        let versions = sidebar.querySelector('.app-versions');
        if(!mobile && !versions) {
            sidebar.insertAdjacentHTML('beforeend', versionMarkup({showRevision: false}));
            versions = sidebar.querySelector('.app-versions');
            mountVersions(sidebar);
        }
        if(versions) versions.hidden = mobile;
        updateMobileSections();
        if(ready && ['dashboard', 'library'].includes(route)) render();
    });
    let coachingError = '';
    let profileSyncError = '';
    let lastRide;
    let savingRide = false;
    let timeline;
    let state;
    let stateVersion = 0;
    const sensorStatus = {};
    const requestedDevices = new Set();
    const report = (text, error = false) => {
        message.textContent = text;
        message.setAttribute('role', error ? 'alert' : 'status');
        message.classList.toggle('error', error);
    };
    const run = async action => {
        if(busy) return;
        busy = true;
        root.setAttribute('aria-busy', 'true');
        try { await action(); }
        catch(error) { report(error.message || 'This action could not be completed.', true); }
        finally { busy = false; root.removeAttribute('aria-busy'); }
    };
    const refresh = async () => {
        if(coachingService().syncPending) return;
        await coachingService().advance();
        xf.dispatch('coaching:changed');
    };
    const deviceButtons = () => `<div class="device-buttons">${Object.entries(devices).map(([id, name]) =>
        `<button class="secondary" data-device="${id}">${name}<span data-sensor="${id}">${escape(sensorStatus[id] || 'Not connected')}</span></button>`).join('')}</div>`;
    const workoutRow = workout => `<li class="session-row"><div><span class="eyebrow">${escape(workout.date)} / ${escape(workout.family)}</span>
        <strong>${escape(workout.title)}</strong><span>${minutes(workout.duration)} &middot; ${escape(workout.status)}</span></div>
        ${link(`workout/${encodeURIComponent(workout.id)}`, 'View session', 'button secondary')}</li>`;
    const recommendation = data => data?.plan?.adaptations?.at(-1)?.reasoning ||
        state?.readiness?.reason || data?.plan?.rationale ||
        'Set your availability and a dated goal to build a plan around your life.';

    function dashboard(data) {
        if(!data) return card('Training data unavailable', `<p>${escape(coachingError || 'Your local training data has not loaded.')}</p>
            <button data-action="reload">Reload training data</button><p class="muted">Your local workout library and ride controls remain available.</p>`);
        const summary = trainingSummary(data);
        const calendar = legacy.querySelector('training-calendar');
        const extras = calendar ? calendar.entriesForDate(today(data)).filter(entry => entry.source !== 'coaching' && entry.workout)
            .map(entry => ({id: entry.workout.id, family: entry.source === 'planned' ? 'Intervals.icu' : 'Calendar',
                title: entry.name, description: entry.workout.meta.description, duration: entry.workout.meta.duration,
                date: entry.date, status: 'scheduled', appWorkout: entry.workout})) : [];
        const sessions = [...summary.upcoming.filter(w => w.date === today(data)), ...extras];
        const next = [...summary.upcoming.filter(w => w.date > today(data))];
        if(calendar) {
            for(let offset = 1; offset <= 14; offset++) {
                for(const entry of calendar.entriesForDate(addDays(today(data), offset))) {
                    if(entry.source === 'coaching' || !entry.workout) continue;
                    next.push({id: entry.workout.id, date: entry.date, title: entry.name, family: entry.source,
                        status: 'scheduled', duration: entry.workout.meta.duration || 0});
                }
            }
            next.sort((a, b) => a.date.localeCompare(b.date));
        }
        const todayBody = sessions.length ? sessions.map(workout => `<p class="eyebrow">${escape(workout.family)} / ${minutes(workout.duration)}</p>
            <h2 class="hero-title">${escape(workout.title)}</h2><p>${escape(workout.description)}</p>
            ${profileGraph(workout.appWorkout || toAppWorkout(workout))}${link(`workout/${encodeURIComponent(workout.id)}`, 'Prepare to ride', 'button')}`).join('')
            : `<h2 class="hero-title">${data?.plan?.status === 'active' ? 'Space to recover.' : 'Your next ride starts here.'}</h2>
                <p>${data?.plan?.status === 'active' ? 'No Coach session scheduled today. Follow your recovery guidance, or choose a ride.' : 'Build a training plan or choose a session from your library.'}</p>
                ${link(data?.plan ? 'library' : 'coach', data?.plan ? 'Choose a workout' : 'Set up your Coach', 'button')}`;
        if(mobile) return `<section class="mobile-today panel hero"><p class="eyebrow">Today / ${escape(today(data))}</p>${todayBody}</section>
            ${db.elapsed > 0 ? card('Ride recovery', `<p>A ${time(db.elapsed)} ride is saved on this device. Reconnect your trainer before resuming.</p>${link('player', 'Return to ride', 'button')}`) : ''}
            ${card('Connect & ride', `<div class="button-row">${link('player', 'Open ride controls', 'button')}${link('library', 'Choose a workout', 'button secondary')}</div>${mobileDetails('dashboard-devices', 'Trainer & sensors', deviceButtons())}`)}
            ${card('Up next', next.length ? `<ul class="session-list">${next.slice(0, 2).map(workoutRow).join('')}</ul>` : '<p>No upcoming sessions.</p>', '', true)}`;
        return `<div class="dashboard-grid"><section class="panel hero"><p class="eyebrow">Today / ${escape(today(data))}</p>${todayBody}</section>
            ${card('This week', `<div class="stats">${stat('Ride time', number(summary.seconds / 3600, 1), 'h')}${stat('Rides', summary.week.length)}
                ${stat('Plan completed to date', summary.adherence == null ? '--' : `${Math.round(summary.adherence * 100)}%`)}</div>
                <p class="muted">${summary.due ? `${summary.completed} of ${summary.due} scheduled sessions through today completed or substituted.` : 'No plan sessions due yet.'}</p>
                ${weekChart(summary)}${link('progress', 'Explore your progress')}`)}
            ${card('From your Coach', `<p class="coach-note">${escape(recommendation(data))}</p><p class="muted">Conservative, deterministic guidance. Not medical advice.</p>${link('coach', 'Review guidance')}`)}
            ${card('Coming next', next.length ? `<ul class="session-list">${next.slice(0, 3).map(workoutRow).join('')}</ul>${link('calendar', 'Open calendar')}` :
                empty('No future Coach sessions scheduled.', 'coach', 'Build a plan'))}</div>`;
    }
    function weekChart(summary) {
        const maximum = Math.max(3600, ...summary.days.map(day => day.seconds));
        return `<div class="week-chart" role="img" aria-label="Ride duration in minutes for the last seven days">${summary.days.map(day =>
            `<div><span>${Math.round(day.seconds / 60)}</span><i style="height:${Math.max(2, day.seconds / maximum * 100)}px"></i>
                <small>${escape(new Date(`${day.date}T12:00:00`).toLocaleDateString(undefined, {weekday: 'short'}))}</small></div>`).join('')}</div>`;
    }
    function selectedWorkout(data) {
        const planned = data?.plan?.workouts.find(workout => workout.id === selectedId);
        const external = legacy.querySelector('training-calendar')?.plannedWorkouts.find(workout => workout.id === selectedId);
        return planned ? toAppWorkout(planned) : db.workouts.find(workout => workout.id === selectedId) || external;
    }
    function details(data) {
        const workout = selectedWorkout(data);
        if(!workout) return empty('This workout is not available on this device.');
        const planned = data?.plan?.workouts.find(w => w.id === selectedId);
        const canStart = !planned || (data.plan.status === 'active' && planned.date === today(data) && planned.status === 'scheduled');
        return card(escape(workout.meta.name), `<p class="eyebrow">${escape(workout.meta.category)} / ${minutes(workout.meta.duration || 0)}</p>
            ${profileGraph(workout)}
            ${planned ? `<p>${escape(planned.date)} &middot; ${escape(planned.status)} &middot; Expected RPE ${planned.expectedRpe}/10</p>` : ''}
            <div class="button-row">${canStart ? '<button data-action="start-workout">Start workout</button>' :
                '<p class="muted">Coach sessions can be ridden on their scheduled date while unresolved.</p>'}${link('devices', 'Connect devices', 'button secondary')}</div>
            ${mobileDetails('workout-notes', 'Workout notes', `<p class="description">${escape(workout.meta.description || 'No description supplied.')}</p>`)}
            ${mobileDetails('workout-intervals', 'Intervals', `<ol class="interval-list">${(workout.intervals || []).flatMap(interval => interval.steps || []).map(step => `<li>
                ${time(step.duration)} &middot; ${step.power == null ? `Slope ${number(step.slope, 1)}%` : `${number(targetPower(step.power, db.ftp))} W`}
                &middot; Cadence: ${escape(cadenceSummary([step]))}</li>`).join('')}</ol>`)}`);
    }
    function plan(data) {
        return renderPlan(data, today(data));
    }
    function activities(data) {
        const lists = activityLists(data, db.activity, false);
        const timeZone = data?.profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return `${lastRide ? card('Ride saved', `<div class="stats">${stat('Duration', time(lastRide.duration))}
            ${stat('Average power', number(lastRide.averagePower), 'W')}${stat('Average HR', number(lastRide.averageHeartRate), 'bpm')}</div>
            <p>Saved on this device. No account or upload is required.
            Add session feedback in Coach to inform your next session.</p>${link('coach', 'Add feedback', 'button secondary')}`) : ''}
            ${renderActivityOverview(data, lists, state)}
            ${lists.pending.length ? card('Awaiting local coaching update', `<p>Your recordings are safely stored on this device.</p>
                <ul class="session-list">${lists.pending.map(activity => localActivityRow(activity, timeZone)).join('')}</ul><button data-action="retry-rides">Retry synchronization</button>`) : ''}
            ${lists.cached.length ? card('Device recordings', `<p>Earlier recordings are still available on this device.</p>
                <ul class="session-list">${lists.cached.map(activity => localActivityRow(activity, timeZone)).join('')}</ul>`) : ''}
            ${card('Activity history', !lists.historyAvailable ? '<p role="status">Activity history is currently unavailable.</p>' :
                lists.history.length ? `<div class="table-scroll"><table><thead><tr><th>Activity</th><th>Duration</th><th>Distance</th>
                <th>Avg power</th><th>Avg HR</th><th>Load / feedback</th><th>Source</th><th>File</th></tr></thead><tbody>${lists.history.map(activity =>
                historyActivityRow(activity, lists.localById.get(String(activity.id)), integration?.connected)).join('')}</tbody></table></div>` :
                empty('Your activities will appear here after you finish a workout or connect Intervals.icu.', 'settings', 'Connect an integration'), 'activity-history')}
            <p class="muted">Missing measurements are shown as --, not estimated. FIT downloads are retained locally for the most recent seven rides.</p>`;
    }
    function progress(data) {
        const summary = trainingSummary(data);
        return `${card('Last seven days', `<div class="stats">${stat('Ride time', number(summary.seconds / 3600, 1), 'h')}
            ${stat('Cycling activities', summary.week.length)}${stat('Plan completion to date', summary.adherence == null ? '--' : `${Math.round(summary.adherence * 100)}%`)}</div>
            ${weekChart(summary)}<p class="muted">Duration includes cycling activities in your normalized history. Plan completion is completed/substituted sessions divided by all sessions scheduled through today.</p>`)}
            ${state ? `<div class="dashboard-grid">${card('Training load', `<p class="eyebrow">Scale: ${escape(state.loadSource)} / confidence: ${escape(state.loadConfidence)}</p>
                <div class="stats">${stat('Weekly load', number(state.weeklyLoad, 1))}${stat('Chronic load', number(state.chronicLoad, 1))}
                ${stat('Acute load', number(state.acuteLoad, 1))}</div><p class="muted">${escape(state.loadExplanation)}</p>`)}
                ${card('Power profile', `<p class="muted">Best observed efforts, not necessarily maximal. Missing efforts are not evidence of decline.</p>
                <div class="table-scroll"><table><thead><tr><th>Duration</th><th>Watts</th><th>W/kg</th></tr></thead><tbody>
                ${state.powerDuration.map(effort => `<tr><td>${time(effort.seconds)}</td><td>${number(effort.watts)}</td><td>${number(effort.wKg, 2)}</td></tr>`).join('')}</tbody></table></div>`, '', true)}</div>` :
                card('Training metrics', '<p>Configure your Coach profile to calculate training-load and power metrics from your history. No inferred fitness score is shown without sufficient data.</p>')}`;
    }
    function player() {
        timeline = rideTimeline(db.workout, db.ftp, targetPower);
        return `<section class="ride-panel"><div class="ride-heading"><div><p class="eyebrow">Workout player</p><h2>${escape(db.workout?.meta?.name || 'Free ride')}</h2></div>
            <span id="ride-status" role="status"></span></div>
            <div class="ride-metrics">
                <div class="ride-metric primary"><span>Target power</span><div><strong id="ride-target">--</strong><small>W</small></div>
                    <span class="ride-reading">Actual <b id="ride-power">--</b> W</span></div>
                <div class="ride-metric"><span>Interval left</span><strong id="ride-countdown">--</strong><span id="ride-interval"></span></div>
                <div class="ride-metric"><span id="ride-cadence-label">Cadence</span><div id="ride-cadence-prescription" hidden><strong id="ride-cadence-target"></strong><small id="ride-cadence-unit">rpm</small></div>
                    <span class="ride-reading">Actual <b id="ride-cadence">--</b> rpm</span></div>
            </div>
            <div class="ride-summary"><span>Heart rate <strong id="ride-hr">--</strong> bpm</span>
                <span>Elapsed <strong id="ride-elapsed">--</strong></span><strong id="ride-remaining"></strong></div>
            <section class="ride-workout-profile" aria-labelledby="ride-profile-heading">
                <div class="ride-profile-heading"><h3 id="ride-profile-heading">Workout power profile</h3><span id="ride-position-label"></span></div>
                <div id="ride-profile" class="ride-profile" role="img" aria-label="Workout target power profile">${rideProfile(timeline)}</div>
                <progress id="ride-progress" max="1" value="0" aria-label="Workout progress" ${timeline ? '' : 'hidden'}></progress>
                <div class="interval-context"><span class="muted">Blocks: target power &middot; marker: your position</span><strong id="ride-next"></strong></div>
            </section>
            <p id="ride-instruction" class="ride-instruction" hidden></p>
            <div class="ride-actions"><button data-action="ride-toggle" id="ride-toggle">Start workout</button>
                <button class="secondary" data-action="ride-skip">Skip interval</button>
                <button class="secondary" data-action="ride-finish">Finish & save</button></div>
            <p>${link('library', 'Choose a workout')}</p>
            <section id="ride-unsaved" role="alert" hidden><h3>Recording needs saving</h3>
                <p>Keep this page open. Download your FIT file now, or retry local storage after freeing space.</p>
                <div class="button-row"><button data-action="recover-download">Download unsaved FIT</button>
                <button class="secondary" data-action="recover-save">Retry saving</button></div></section>
            <details class="ride-settings"><summary>Devices &amp; trainer settings</summary><div class="ride-sensors">${deviceButtons()}</div>
            <div class="ride-adjust"><label>Trainer mode<select id="ride-mode"><option value="erg">ERG</option>
                <option value="resistance">Resistance</option><option value="sim">Slope</option></select></label>
                <button class="secondary" data-action="target-down" aria-label="Decrease current target">-</button>
                <span id="ride-adjust-value"></span><button class="secondary" data-action="target-up" aria-label="Increase current target">+</button></div></details>
            <p class="muted" id="ride-recovery">${db.elapsed ? 'Ride recovered on this device. Reconnect sensors before resuming.' : 'Connect a trainer and sensors, then start. Your ride is recovered locally after an interruption.'}</p>
        </section>`;
    }
    function settings() {
        const locked = integration?.connected;
        return `<div class="dashboard-grid">${card('Rider profile', `<p>Settings, workouts, recordings, calendar and coaching are stored only on this device.</p>
            <form id="profile-form"><label>FTP (W)<input name="ftp" type="number" min="1" max="1500" value="${db.ftp}" required ${locked ? 'disabled' : ''}></label>
                <label>Body mass (kg)<input name="weight" type="number" min="1" max="500" step="0.1" value="${db.weight}" required ${locked ? 'disabled' : ''}></label>
                <button ${locked ? 'disabled' : ''}>Save profile</button></form>${locked ? '<p class="muted">FTP and body mass are managed by Intervals.icu and refreshed each time this app opens. Change them in Intervals.icu, or disconnect to edit locally.</p><button class="secondary" data-action="import-profile">Refresh Intervals.icu profile</button>' : ''}
                <p class="muted">After changing FTP, archive and regenerate an active plan before riding it.</p>`)}
            ${card('Intervals.icu', integrationView(), '', true)}
            ${card('Local backup', `<p>Download your coaching history, plans, workout files, recent FIT recordings, settings and calendar. Keep a backup before clearing browser data or changing devices.</p>
                <div class="button-row"><button class="secondary" data-action="backup">Download backup</button>
                <label>Restore backup<input id="restore-backup" type="file" accept=".json,application/json"></label></div>
                <p class="muted">Restore merges workout/recording files and replaces local coaching, settings and calendar. Integration API keys are not included.</p>
                <button class="secondary" data-action="export">Export local training history</button>`, '', true)}</div>`;
    }
    function integrationView() {
        if(!integration) return '<p role="status">Loading integration status...</p>';
        if(!integration.connected) return `<p>Import history directly from Intervals.icu into your local Activities, analytics and Coach. Your personal API key is stored in this browser and sent only to Intervals.icu. Anyone with access to this browser profile can use it.</p>
            <form id="intervals-connect"><label>Personal API key<input name="apiKey" type="password" required autocomplete="off" maxlength="1024"></label>
                <label>Import from<input name="oldest" type="date" value="${addDays(today(), -365)}" max="${today()}" required></label>
                <button>Test & connect</button></form><p class="muted">Personal/self-hosted connections only. Strava-origin data is not available through the Intervals.icu API.</p>`;
        const athleteIdText = integration.athleteId && integration.athleteId !== '0'
            ? `Athlete ID: ${escape(integration.athleteId)}`
            : 'Athlete ID: auto-resolved from your Intervals.icu account';
        return `<p class="eyebrow">${escape(integration.status)}</p><p>Last successful sync: ${integration.lastSuccess ? escape(new Date(integration.lastSuccess).toLocaleString()) : 'Not yet synced'}</p>
            ${integration.nextDate ? `<p>Importing ${escape(integration.nextDate)} through ${escape(integration.through)} in 31-day batches.</p>` : ''}
            ${integration.error ? `<p role="alert">${escape(integration.error)}</p>` : ''}
            ${integration.skipped?.length ? `<details class="muted"><summary>${integration.skipped.length} activit${integration.skipped.length === 1 ? 'y' : 'ies'} skipped (missing ID, start time or duration)</summary><ul>${integration.skipped.map(label => `<li>${escape(label)}</li>`).join('')}</ul></details>` : ''}
            ${integration.retryAt && integration.status === 'queued' ? `<p>Retry after ${escape(new Date(integration.retryAt).toLocaleString())}</p>` : ''}
            <p class="muted">${athleteIdText}</p>
            <div class="button-row"><button data-action="sync" ${['running', 'queued'].includes(integration.status) ? 'disabled' : ''}>${integration.lastSuccess ? 'Sync now' : 'Import history'}</button>
                <button class="secondary" data-action="test-connection">Test connection</button>
                <button class="secondary" data-action="disconnect">Disconnect</button></div>
            <p class="muted">Your API key is stored in this browser, not on an Athlima server. Disconnect removes it; imported history is retained. Sync runs while this app is open and rechecks the last seven days for updates.</p>`;
    }
    async function loadIntegration() {
        if(integrationLoading) return;
        integrationLoading = true;
        try {
            integration = intervals.status();
            xf.dispatch('services', {intervals: integration.connected});
            if(route === 'settings' && !root.querySelector('#intervals-connect:focus-within')) render();
            if(integration.error || integration.status === 'error') {
                report(integration.error || 'Intervals.icu sync failed. Retry in Settings > Integrations.', true);
            }
        } catch(error) {
            report(error.message, true);
        }
        finally { integrationLoading = false; }
    }
    async function syncIntegration({profileSynced = false} = {}) {
        if(integration?.status === 'running') return;
        integration = {...intervals.status(), status: 'running'};
        if(route === 'settings') render();
        try {
            if(!profileSynced) {
                await intervals.syncProfile();
                profileSyncError = '';
                if(route === 'settings') render();
            }
            await intervals.sync(coachingService(), current => {
                integration = current;
                if(route === 'settings') render();
                xf.dispatch('coaching:changed');
            });
            coachingService().syncPending = false;
            activityDataCache.clear();
            await refresh();
        } finally {
            integration = intervals.status();
            render();
        }
        report('Intervals.icu sync completed. Local Coach and training plan are up to date.');
    }
    let libraryFilters = initialLibraryFilters();
    let libraryPage = 0;
    function render() {
        if(!ready) return;
        const data = coachingData();
        const [title, subtitle] = routes[route] || ['Workout editor', 'Build a session'];
        root.querySelector('#route-title').textContent = mobile && route === 'dashboard' ? 'Ready to ride?' : title;
        root.querySelector('#route-subtitle').textContent = subtitle;
        root.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current',
            a.getAttribute('href') === `#/${route}` ? 'page' : 'false'));
        document.body.dataset.route = route;
        legacy.hidden = !['calendar', 'coach', 'devices', 'editor'].includes(route);
        content.innerHTML = route === 'dashboard' ? dashboard(data) : route === 'library' ? renderLibrary(db.workouts, libraryFilters,
            {page: libraryPage, pageSize: mobile ? 6 : Infinity})
            : route === 'workout' ? details(data) : route === 'plan' ? plan(data)
                : route === 'activities' ? activities(data) : route === 'progress' ? progress(data)
                    : route === 'player' ? player() : route === 'settings' ? settings()
                        : route === 'devices' ? `<p class="muted">Select your trainer and sensors below, then choose which device supplies each measurement.
                            Connections and controls use the existing BLE / ANT+ engine.</p>
                            ${!navigator.bluetooth ? '<p role="alert">Web Bluetooth is unavailable in this browser. Use Chrome/Edge on a supported platform and HTTPS or localhost. ANT+ requires Web Serial or WebUSB.</p>' : ''}`
                            : route === 'coach' ? `<p class="muted">Your on-device Coach plans around your goal, schedule and ride history.</p>` : '';
        updateMobileSections();
        if(route === 'player') updateRide();
    }
    function navigate() {
        const [name, id] = window.location.hash.replace(/^#\/?/, '').split('/');
        route = Object.hasOwn(routes, name) || name === 'editor' ? name : 'dashboard';
        try { selectedId = decodeURIComponent(id || ''); }
        catch { selectedId = ''; }
        report(profileSyncError || coachingError, Boolean(profileSyncError || coachingError));
        render();
        if(route === 'settings') void loadIntegration();
        if(route === 'calendar') void legacy.querySelector('training-calendar').loadPlannedMonth();
        root.querySelector('#route-title').focus?.();
    }
    function updateRide() {
        if(!ready || route !== 'player') return;
        const intervals = db.workout?.intervals || [];
        const current = intervals[db.intervalIndex];
        const step = current?.steps?.[db.stepIndex];
        const next = intervals[db.intervalIndex + 1];
        const nextStep = next?.steps?.[0];
        const duration = timeline?.duration;
        const position = ridePosition(timeline, db);
        const remaining = duration - position;
        const running = db.workoutStatus === 'started';
        const finished = db.workoutStatus === 'done';
        const cadence = finished ? null : running && db.cadenceTarget > 0 ? db.cadenceTarget : step?.cadence;
        const cadenceTarget = Number.isFinite(cadence) && cadence > 0 ? cadence : null;
        const connected = metric => !db.connectedDevices || db.connectedDevices[db.sources?.[metric]] === true;
        const values = {
            power: connected('power') ? number(db.power1s) : '--',
            target: finished ? '--' : number(running ? db.powerTarget
                : step?.power == null ? null : targetPower(step.power, db.ftp)),
            countdown: time(finished ? 0 : running || !timeline ? db.lapTime : timeline.intervals[db.intervalIndex]?.duration),
            cadence: connected('cadence') ? number(db.cadence) : '--',
            'cadence-label': cadenceTarget == null ? 'Cadence' : 'Cadence target',
            'cadence-target': cadenceTarget == null ? '' : number(cadenceTarget),
            'cadence-unit': cadenceTarget == null ? '' : 'rpm',
            hr: connected('heartRate') && db.heartRate > 0 ? number(db.heartRate) : '--', elapsed: time(db.elapsed),
            interval: intervals.length ? `Interval ${Math.min(intervals.length, db.intervalIndex + 1)} / ${intervals.length}` : 'Free ride',
            next: !finished && nextStep ? `Next: ${time(next.duration)} / ${nextStep.power == null ? 'No power target' : `${number(targetPower(nextStep.power, db.ftp))} W`}${nextStep.cadence > 0 ? ` / ${number(nextStep.cadence)} rpm` : ''}` : 'No next interval',
            remaining: duration ? `${time(remaining)} remaining` : '',
            'position-label': duration ? `${time(position)} / ${time(duration)}` : 'Free ride',
            status: db.workoutStatus === 'done' ? 'Workout complete - finish to save' : db.watchStatus,
            toggle: db.watchStatus === 'started' ? 'Pause' : db.elapsed > 0 ? 'Resume' : 'Start workout',
            'adjust-value': db.mode === 'erg' ? `${number(db.powerTarget)} W` : db.mode === 'resistance'
                ? `${number(db.resistanceTarget)}% resistance` : `${number(db.slopeTarget, 1)}% slope`,
        };
        Object.entries(values).forEach(([key, value]) => {
            const element = root.querySelector(`#ride-${key}`);
            if(element) element.textContent = value;
        });
        const progress = root.querySelector('#ride-progress');
        if(progress) progress.value = duration ? position / duration : 0;
        root.querySelector('#ride-cadence-prescription').hidden = cadenceTarget == null;
        const instruction = root.querySelector('#ride-instruction');
        instruction.textContent = db.workoutTextEvent || '';
        instruction.hidden = !instruction.textContent;
        if(timeline) {
            const fraction = position / duration;
            root.querySelector('#ride-profile-cursor').style.left = `${fraction * 100}%`;
            root.querySelector('#ride-profile-cursor span').textContent = finished ? 'Done' : 'Now';
            root.querySelector('#ride-profile-completed').setAttribute('width', fraction * 1000);
            const interval = timeline.intervals[db.intervalIndex];
            const active = root.querySelector('#ride-profile-active');
            active.setAttribute('x', interval ? interval.start / duration * 1000 : 0);
            active.setAttribute('width', interval && !finished ? interval.duration / duration * 1000 : 0);
            root.querySelector('#ride-profile').setAttribute('aria-label',
                `Workout target power profile. Position ${time(position)} of ${time(duration)}.`);
        }
        const mode = root.querySelector('#ride-mode');
        if(mode && document.activeElement !== mode) mode.value = db.mode;
        root.querySelector('[data-action="ride-skip"]').disabled = db.watchStatus !== 'started' || !intervals.length;
        root.querySelector('[data-action="ride-finish"]').disabled = !db.elapsed;
        root.querySelector('[data-action="ride-toggle"]').disabled = savingRide || Boolean(engineModels.activity?.pendingRecording);
        root.querySelector('#ride-unsaved').hidden = !engineModels.activity?.pendingRecording;
    }

    root.addEventListener('input', event => {
        if(event.target.id !== 'workout-search') return;
        libraryFilters.search = event.target.value;
        libraryPage = 0;
        const position = event.target.selectionStart;
        render();
        const input = root.querySelector('#workout-search');
        input.focus();
        input.setSelectionRange(position, position);
    });
    root.addEventListener('change', event => {
        const libraryField = {
            'workout-category': 'category', 'workout-type': 'type',
            'workout-duration': 'duration', 'workout-sort': 'sort',
        }[event.target.id];
        if(libraryField) {
            libraryFilters[libraryField] = event.target.value;
            libraryPage = 0;
            render();
            root.querySelector(`#${event.target.id}`).focus();
            return;
        }
        if(event.target.id === 'ride-mode') xf.dispatch('ui:mode-set', event.target.value);
        if(event.target.id === 'restore-backup') {
            const file = event.target.files[0];
            if(!file) return;
            void run(async () => {
                if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before restoring data.');
                if(!confirm('Merge backup files and replace local coaching, settings and calendar?')) return;
                const {restoreBackup} = await import('../storage/backup.js');
                await restoreBackup(JSON.parse(await file.text()));
                window.location.reload();
            });
        }
        if(event.target.id === 'platform-upload') {
            const files = Array.from(event.target.files);
            if(!files.length) return;
            void run(async () => {
                const { models } = await import('../models/models.js');
                for(const file of files) {
                    const {result, name} = await models.workout.readFromFile(file);
                    const workout = models.workout.parse(result, name);
                    await models.workouts.save(workout);
                    db.workouts.push(workout);
                    xf.dispatch('db:workouts', db);
                }
                render();
                report('Workout files imported.');
            });
        }
    });
    root.addEventListener('submit', event => {
        if(!['profile-form', 'intervals-connect'].includes(event.target.id)) return;
        event.preventDefault();
        const form = event.target;
        const values = new FormData(form);
        void run(async () => {
            if(form.id === 'profile-form') {
                if(intervals.status().connected) throw new Error('FTP and body mass are managed by Intervals.icu. Change them there, or disconnect first.');
                xf.dispatch('ui:ftp-set', Number(values.get('ftp')));
                xf.dispatch('ui:weight-set', Number(values.get('weight')));
                report('Device profile saved.');
            } else {
                const apiKey = values.get('apiKey');
                form.reset();
                integration = await intervals.connect({apiKey, oldest: values.get('oldest')});
                render();
                await intervals.syncProfile();
                profileSyncError = '';
                render();
                report('Intervals.icu connected. Choose Import history to begin.');
            }
        });
    });
    root.addEventListener('click', event => {
        if(event.target.closest('.skip-link')) {
            event.preventDefault();
            root.querySelector('#main-content').focus();
            return;
        }
        if(event.target.closest('[data-library-reset]')) {
            libraryFilters = initialLibraryFilters();
            libraryPage = 0;
            render();
            root.querySelector('#workout-search').focus();
            return;
        }
        const pageButton = event.target.closest('[data-library-page]');
        if(pageButton) {
            libraryPage = Number(pageButton.dataset.libraryPage);
            render();
            const results = root.querySelector('#library-results');
            results.setAttribute('tabindex', '-1');
            results.focus();
            results.scrollIntoView({block: 'start'});
            return;
        }
        const device = event.target.closest('[data-device]')?.dataset.device;
        if(device) { requestedDevices.add(device); xf.dispatch(`ui:ble:${device}:switch`); return; }
        const download = event.target.closest('[data-download]')?.dataset.download;
        if(download) {
            void run(async () => { const {models} = await import('../models/models.js'); await models.activity.download(download); });
            return;
        }
        const deleteRide = event.target.closest('[data-delete-ride]')?.dataset.deleteRide;
        if(deleteRide) {
            void run(async () => {
                if(!confirm('Delete this Athlima activity and its local FIT recording? Existing plan decisions and external uploads are not removed.')) return;
                const service = coachingService();
                const activity = service.data?.activities?.find(item => String(item.id) === deleteRide);
                if(activity && activity.source !== 'athlima') throw new Error('Only Athlima recordings can be deleted here.');
                if(db.activity.some(item => String(item.id) === deleteRide)) {
                    const {idb} = await import('../storage/idb.js');
                    await idb.removeChecked('activity', deleteRide);
                    db.activity = db.activity.filter(item => String(item.id) !== deleteRide);
                }
                if(activity) {
                    try {
                        await service.deleteRide(activity.id);
                    } catch(error) {
                        render();
                        throw new Error(`Activity history could not be deleted; retry. Any local FIT recording has already been removed: ${error.message}`);
                    }
                }
                if(lastRide && String(lastRide.id) === deleteRide) lastRide = null;
                xf.dispatch('coaching:changed');
                render();
                report('Activity deleted. External uploads and previous plan decisions were not changed.');
            });
            return;
        }
        const upload = event.target.closest('[data-upload-ride]')?.dataset.uploadRide;
        if(upload) {
            void run(async () => {
                const {models} = await import('../models/models.js');
                const {idb} = await import('../storage/idb.js');
                const record = await idb.get('activity', upload);
                const result = await models.api.intervals.uploadWorkout(record);
                if(result !== ':success') throw new Error('Intervals.icu upload failed. Check the connection and retry.');
                report('Recording sent to Intervals.icu. Run Sync to refresh provider metadata.');
            });
            return;
        }
        const activityButton = event.target.closest('[data-load-activity]');
        if(activityButton) {
            const activityId = activityButton.dataset.loadActivity;
            const panel = activityButton.closest('tr')?.querySelector('.activity-stream-panel');
            if(!panel || !activityId) return;
            if(!panel.hidden) {
                panel.hidden = true;
                activityButton.setAttribute('aria-expanded', 'false');
                return;
            }
            void run(async () => {
                activityButton.disabled = true;
                activityButton.textContent = 'Loading...';
                try {
                    const data = activityDataCache.get(activityId) ??
                        await intervals.activityData(activityId);
                    activityDataCache.set(activityId, data);
                    if(!panel.isConnected) return;
                    panel.innerHTML = renderActivityStreamData(data);
                    panel.hidden = false;
                    activityButton.setAttribute('aria-expanded', 'true');
                } finally {
                    activityButton.disabled = false;
                    activityButton.innerHTML = 'Route &amp; data';
                }
            });
            return;
        }
        if(event.target.closest('[data-download-activity-csv]')) {
            const row = event.target.closest('tr');
            const activityId = row?.querySelector('[data-load-activity]')?.dataset.loadActivity;
            const streams = activityDataCache.get(activityId)?.streams;
            if(!streams) return;
            const names = ['time', 'watts', 'heartrate', 'cadence'];
            const count = Math.max(0, ...names.map(name => streams[name]?.length || 0));
            const csv = ['sample_index,time_seconds,watts,heartrate_bpm,cadence_rpm',
                ...Array.from({length: count}, (_, index) =>
                    [index, ...names.map(name => streams[name]?.[index] ?? '')].join(','))].join('\n');
            const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'}));
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `activity-${activityId}-streams.csv`;
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            return;
        }
        const action = event.target.closest('[data-action]')?.dataset.action;
        if(!action) return;
        if(action === 'sync') {
            void syncIntegration().catch(error => report(error.message, true));
            return;
        }
        void run(async () => {
            if(engineModels.activity?.pendingRecording && !['recover-download', 'recover-save'].includes(action)) {
                throw new Error('Save or download the unsaved FIT recording before continuing.');
            }
            if(action === 'start-workout') {
                if(db.watchStatus !== 'stopped' || db.elapsed > 0 || savingRide) {
                    throw new Error('Finish and save your current ride before starting another workout.');
                }
                const workout = selectedWorkout(coachingData());
                if(workout.coachingWorkoutId) {
                    if(coachingData().profile.ftp !== db.ftp) throw new Error('Update device FTP to match your Coach profile, or regenerate your plan.');
                    xf.dispatch('ui:coaching:select', workout);
                } else xf.dispatch('workout', workout);
                window.location.hash = '/player';
                xf.dispatch('ui:watchStart');
                xf.dispatch('ui:workoutStart');
            } else if(action === 'ride-toggle') {
                if(db.watchStatus === 'started') xf.dispatch('ui:watchPause');
                else if(db.elapsed > 0) xf.dispatch('ui:watchResume');
                else { xf.dispatch('ui:watchStart'); xf.dispatch('ui:workoutStart'); }
            } else if(action === 'recover-download') {
                const record = engineModels.activity.pendingRecording;
                const {fileHandler} = await import('../file.js');
                fileHandler.download()(record.blob, engineModels.activity.fileName(record.summary.timestamp),
                    'application/octet-stream');
            } else if(action === 'recover-save') xf.dispatch('ui:activity:retry-save');
            else if(action === 'ride-skip') xf.dispatch('ui:watchLap');
            else if(action === 'ride-finish') {
                if(db.watchStatus === 'started') xf.dispatch('ui:watchPause');
                xf.dispatch('ui:watchStop');
            } else if(action === 'target-up' || action === 'target-down') {
                const target = db.mode === 'erg' ? 'power' : db.mode === 'resistance' ? 'resistance' : 'slope';
                xf.dispatch(`ui:${target}-target-${action === 'target-up' ? 'inc' : 'dec'}`);
            } else if(action === 'test-connection') {
                await intervals.athlete();
                report('Intervals.icu connection is working.');
            } else if(action === 'disconnect') {
                if(!confirm('Disconnect Intervals.icu? Imported activities will be kept.')) return;
                integration = intervals.disconnect();
                profileSyncError = '';
                coachingService().syncPending = false;
                await refresh();
                activityDataCache.clear();
                render();
            } else if(action === 'backup') {
                if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before backing up.');
                const {createBackup} = await import('../storage/backup.js');
                const {fileHandler} = await import('../file.js');
                fileHandler.download()(JSON.stringify(await createBackup(db.workouts), null, 2),
                    'athlima-backup.json', 'application/json');
                report('Local backup downloaded. Keep this file private.');
            } else if(action === 'export') {
                const {fileHandler} = await import('../file.js');
                fileHandler.download()(JSON.stringify(coachingData(), null, 2), 'athlima-training-history.json', 'application/json');
            } else if(action === 'import-profile') {
                await intervals.syncProfile();
                profileSyncError = '';
                render();
                report('FTP and body mass synced from Intervals.icu. Regenerate an active plan if FTP changed.');
            } else if(action === 'reload') window.location.reload();
            else if(action === 'retry-rides') {
                await refresh();
                const {syncRecordedRides} = await import('../storage/ride-sync.js');
                await syncRecordedRides(coachingService());
                await refresh();
                db.activity = await engineModels.activity.restore();
                render();
                report('Local coaching history updated.');
            }
        });
    });
    window.addEventListener('hashchange', navigate);
    window.addEventListener('pwa:error', event => report(event.detail, true));
    navigator.serviceWorker?.addEventListener('message', event => {
        if(event.data?.type === 'CACHE_ERROR') report('Some app assets could not be cached for offline use. Your active ride is unaffected.', true);
    });
    Object.keys(devices).forEach(id => {
        for(const [event, label] of [['connected', 'Connected'], ['connecting', 'Connecting...'], ['disconnected', 'Disconnected']]) {
            xf.sub(`ble:${id}:${event}`, () => {
                sensorStatus[id] = label;
                if(label === 'Connected' && requestedDevices.has(id)) {
                    const source = `ble:${id}`;
                    const selection = id === 'controllable' ? {control: source, power: source, cadence: source, speed: source}
                        : id === 'powerMeter' ? {power: source}
                            : id === 'speedCadenceSensor' ? {cadence: source, speed: source} : {heartRate: source};
                    xf.dispatch('sources', selection);
                }
                if(label !== 'Connecting...') requestedDevices.delete(id);
                queueMicrotask(updateRide);
                root.querySelectorAll(`[data-sensor="${id}"]`).forEach(element => { element.textContent = label; });
                if(label === 'Disconnected' && db?.watchStatus === 'started') {
                    report(`${devices[id]} disconnected. Reconnect the device; workout recording is still active.`, true);
                }
            });
        }
    });
    xf.sub('db:page', page => {
        if(!ready) return;
        if(page === 'home' && route !== 'player') window.location.hash = '/player';
    });
    xf.sub('coaching:error', error => { coachingError = error; report(error, true); });
    xf.sub('coaching:changed', () => {
        if(!ready) return;
        const data = coachingData();
        const version = ++stateVersion;
        coachingError = '';
        state = undefined;
        if(data?.profile) {
            import('../coaching/state.js').then(({estimateState}) => {
                if(version !== stateVersion) return;
                try { state = estimateState(data.activities, data.profile, today(data)); }
                catch(error) { report(`Training load could not be calculated: ${error.message}`, true); }
                if(['dashboard', 'progress', 'plan', 'activities'].includes(route)) render();
            }, error => {
                if(version === stateVersion) report(`Training load could not be calculated: ${error.message}`, true);
            });
        }
        if(!['player', 'settings', 'coach'].includes(route)) render();
    });
    xf.sub('activity:saving', () => { savingRide = true; updateRide(); });
    xf.sub('activity:discarded', () => {
        report('Ride discarded.');
        updateRide();
    });
    xf.sub('activity:save:success', ride => {
        savingRide = false;
        lastRide = ride;
        if(route === 'player') window.location.hash = '/activities';
    });
    xf.sub('activity:save:fail', () => {
        savingRide = false;
        report('Ride could not be saved. Keep this page open and download the unsaved FIT recording.', true);
        if(route !== 'player') window.location.hash = '/player';
        else updateRide();
    });
    xf.sub('action:planned', () => { if(ready && route === 'dashboard') render(); });
    xf.sub('db:workouts', () => { if(ready && route === 'library') render(); });
    for(const key of ['elapsed', 'lapTime', 'power1s', 'powerTarget', 'cadence', 'cadenceTarget', 'heartRate', 'watchStatus',
        'workoutStatus', 'intervalIndex', 'stepIndex', 'workoutTextEvent', 'mode', 'resistanceTarget', 'slopeTarget', 'sources']) xf.sub(`db:${key}`, updateRide);
    for(const key of ['workout', 'ftp']) xf.sub(`db:${key}`, () => { if(ready && route === 'player') render(); });
    const updateProfileLock = () => {
        let locked = true;
        try { locked = intervals.status().connected; }
        catch(error) { profileSyncError = error.message; report(error.message, true); }
        legacy.querySelectorAll('[effect="ftp-set"], [effect="weight-set"]').forEach(control => { control.disabled = locked; });
    };
    xf.sub('services', updateProfileLock);
    window.addEventListener('storage', () => {
        updateProfileLock();
        if(ready && route === 'settings') void loadIntegration();
    });
    const started = new Promise((resolve, reject) => {
        window.addEventListener('app:ready', resolve, {once: true});
        window.addEventListener('app:error', event => reject(new Error(event.detail.data)), {once: true});
    });
    await import('../index.js');
    ({db} = await import('../db.js'));
    ({models: engineModels} = await import('../models/models.js'));
    await started;
    try {
        if(intervals.status().connected) {
            content.innerHTML = '<p role="status">Syncing FTP and body mass from Intervals.icu...</p>';
            await intervals.syncProfile();
        }
    } catch(error) {
        profileSyncError = `${error.message} Cached FTP and body mass are retained; local editing stays disabled while connected.`;
    }
    updateProfileLock();
    ready = true;
    legacy.querySelectorAll('connection-switch, protocol-switch, tab-btn, source-switch').forEach(element => {
        element.setAttribute('role', 'button');
        element.tabIndex = 0;
        element.addEventListener('keydown', event => {
            if(!['Enter', ' '].includes(event.key)) return;
            event.preventDefault();
            element.dispatchEvent(new Event('pointerup', {bubbles: true}));
        });
    });
    if(coachingData()?.profile) {
        const {estimateState} = await import('../coaching/state.js');
        state = estimateState(coachingData().activities, coachingData().profile, today(coachingData()));
    }
    navigate();
    await loadIntegration();
    if(integration?.connected && !profileSyncError) {
        report('Syncing Intervals.icu history into local coaching...');
        void syncIntegration({profileSynced: true}).catch(error => report(error.message, true));
    }
    if(profileSyncError) report(profileSyncError, true);
    if(db.elapsed > 0) {
        report('A previous ride was recovered. Reconnect your trainer and resume in Ride.');
        window.location.hash = '/player';
    }
    // Keep multi-device edits explicit; never overwrite a dirty form on focus.
    window.addEventListener('focus', () => {
        if(ready && !busy && !['coach', 'settings', 'player'].includes(route)) void run(refresh);
    });
}
