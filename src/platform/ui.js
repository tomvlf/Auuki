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
import { serverRequest, serverAccount, SERVER_MODE_KEY } from '../server/client.js';
import { coachingData, coachingService } from '../coaching/service.js';
import { toAppWorkout } from '../coaching/workouts.js';
import { addDays } from '../coaching/domain.js';
import { escape, minutes, number, time, today, trainingSummary, profileGraph } from './format.js';
import { activityLists, historyActivityRow, localActivityRow, renderActivityOverview, renderActivityStreamData } from './activities.js';
import { initialLibraryFilters, renderLibrary } from './library.js';
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
const card = (title, body, className = '') => `<section class="panel ${className}"><h2>${title}</h2>${body}</section>`;
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
 * @param {object|null} account - The current authenticated account or guest fallback.
 * @returns {Promise<void>} Resolves after the platform shell and route plumbing are ready.
 */
export async function launchPlatform(root, account) {
    root.removeAttribute('role');
    const authenticated = Boolean(account?.email);
    const mobile = /^\/mobile\/?$/.test(window.location.pathname);
    document.body.classList.add('platform-app', ...(mobile ? ['mobile-app'] : []));
    root.innerHTML = `<a class="skip-link" href="#main-content">Skip to content</a>
        <aside class="sidebar"><a class="brand" href="${mobile ? '/mobile' : '/'}">Athlima<span> / training</span></a>
            <nav aria-label="Main navigation">${(mobile
                ? ['dashboard', 'player', 'devices', 'activities', 'settings']
                : Object.keys(routes).filter(r => !['workout'].includes(r)))
                .map(route => link(route, routes[route][0])).join('')}</nav>
            <div class="sidebar-bottom"><span>Train with intention.</span>
                <a href="${mobile ? '/' : '/mobile'}">${mobile ? 'Desktop platform' : 'Mobile ride companion'}</a></div>
            ${mobile ? '' : versionMarkup({showRevision: false})}
        </aside>
        <main id="main-content" tabindex="-1"><header class="platform-header">
            <div><p class="eyebrow" id="route-subtitle"></p><h1 id="route-title" tabindex="-1"></h1></div>
            <div class="account-menu"><span>${escape(account?.email || 'Guest / on-device only')}</span><button class="secondary" data-action="${authenticated ? 'logout' : 'signin'}">${authenticated ? 'Sign out' : 'Sign in / Create account'}</button></div>
        </header><div id="platform-message" role="status" aria-live="polite"></div>
        <div id="platform-content"><p role="status">Loading your training...</p></div>
        <div id="legacy-slot"></div></main>`;
    if(!mobile) mountVersions(root);
    const legacy = document.querySelector('.wrapper');
    root.querySelector('#legacy-slot').append(legacy);
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
    let syncTimer;
    let busy = false;
    let ready = false;
    let coachingError = '';
    let lastRide;
    let savingRide = false;
    let advancedPlayer = false;
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
        if(!authenticated) {
            await coachingService().advance();
            xf.dispatch('coaching:changed');
            return;
        }
        const result = await serverRequest('coaching');
        const service = coachingService();
        service.data = result.data;
        service.revision = result.revision;
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
        if(!data) return card('Training data unavailable', `<p>${escape(coachingError || 'Your server training data has not loaded.')}</p>
            <button data-action="reload">Reload training data</button><p class="muted">Your local workout library and ride controls remain available while this account is signed in.</p>`);
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
            ${card('Connect & ride', `${deviceButtons()}<div class="button-row">${link('player', 'Open ride controls', 'button')}${link('library', 'Choose a workout', 'button secondary')}</div>`)}
            ${card('Up next', next.length ? `<ul class="session-list">${next.slice(0, 2).map(workoutRow).join('')}</ul>` : '<p>No upcoming sessions.</p>')}`;
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
        const canPrepare = !planned || (data.plan.status === 'active' && planned.date === today(data) && planned.status === 'scheduled');
        return card(escape(workout.meta.name), `<p class="eyebrow">${escape(workout.meta.category)} / ${minutes(workout.meta.duration || 0)}</p>
            ${profileGraph(workout)}<p class="description">${escape(workout.meta.description || 'No description supplied.')}</p>
            ${planned ? `<p>${escape(planned.date)} &middot; ${escape(planned.status)} &middot; Expected RPE ${planned.expectedRpe}/10</p>` : ''}
            <div class="button-row">${canPrepare ? '<button data-action="prepare">Prepare workout</button>' :
                '<p class="muted">Coach sessions can be ridden on their scheduled date while unresolved.</p>'}${link('devices', 'Connect devices', 'button secondary')}</div>
            <ol class="interval-list">${(workout.intervals || []).flatMap(interval => interval.steps || []).map(step => `<li>
                ${time(step.duration)} &middot; ${step.power == null ? `Slope ${number(step.slope, 1)}%` : `${number(targetPower(step.power, db.ftp))} W`}</li>`).join('')}</ol>`);
    }
    function plan(data) {
        const plan = data?.plan;
        if(!plan) return empty('A plan built for your goal, availability and recent training.', 'coach', 'Create your training plan');
        return `${card(escape(data.goal?.name || 'Your plan'), `<p class="eyebrow">${escape(plan.status)} / revision ${plan.revision}</p>
            <p>${escape(plan.startDate)} - ${escape(plan.endDate)}</p><p>${escape(plan.rationale)}</p>
            <div class="phase-track">${plan.phases.map(phase => `<div><strong>${escape(phase.type)}</strong>
                <small>${escape(phase.startDate)} - ${escape(phase.endDate)}</small><p>${escape(phase.rationale)}</p></div>`).join('')}</div>`)}
            ${card('Scheduled sessions', plan.workouts.length ? `<ul class="session-list">${plan.workouts.map(workoutRow).join('')}</ul>` :
                `<p>No sessions fit the current training-load and availability limits. Review the warnings in Coach,
                check your imported history and profile, then archive and regenerate the plan if needed.</p>${link('coach', 'Review Coach', 'button secondary')}`)}
            ${card('Plan changes', plan.adaptations.length ? plan.adaptations.slice(-10).reverse().map(adaptation =>
                `<p><span class="eyebrow">${escape(adaptation.timestamp)}</span><br>${escape(adaptation.reasoning)}</p>`).join('') :
                '<p>Adaptations will appear after recorded rides, feedback or missed-session reviews.</p>')}`;
    }
    function activities(data) {
        const lists = activityLists(data, db.activity, authenticated);
        const timeZone = data?.profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        return `${lastRide ? card('Ride saved', `<div class="stats">${stat('Duration', time(lastRide.duration))}
            ${stat('Average power', number(lastRide.averagePower), 'W')}${stat('Average HR', number(lastRide.averageHeartRate), 'bpm')}</div>
            <p>${!authenticated ? 'Saved on this device. No account or upload is required.' : lists.history.some(activity => activity.id === lastRide.id) ? "Saved to this account's server history." : 'Saved on this device. Server synchronization has not been confirmed.'}
            Add session feedback in Coach to inform your next session.</p>${link('coach', 'Add feedback', 'button secondary')}`) : ''}
            ${renderActivityOverview(data, lists, state)}
            ${lists.pending.length ? card(authenticated ? 'Awaiting server synchronization' : 'Awaiting local coaching update', `<p>Your recordings are safely stored on this device.</p>
                <ul class="session-list">${lists.pending.map(activity => localActivityRow(activity, timeZone)).join('')}</ul><button data-action="retry-rides">Retry synchronization</button>`) : ''}
            ${lists.cached.length ? card('Device recordings', `<p>Recordings from earlier guest rides are still available on this device.</p>
                <ul class="session-list">${lists.cached.map(activity => localActivityRow(activity, timeZone)).join('')}</ul>`) : ''}
            ${card('Activity history', !lists.historyAvailable ? '<p role="status">Activity history is currently unavailable.</p>' :
                lists.history.length ? `<div class="table-scroll"><table><thead><tr><th>Activity</th><th>Duration</th><th>Distance</th>
                <th>Avg power</th><th>Avg HR</th><th>Load / feedback</th><th>Source</th><th>File</th></tr></thead><tbody>${lists.history.map(activity =>
                historyActivityRow(activity, lists.localById.get(String(activity.id)), integration?.connected)).join('')}</tbody></table></div>` :
                empty(authenticated ? 'Your activities will appear here after you finish a workout or connect Intervals.icu.' : 'Your rides will appear here after you finish a workout.', authenticated ? 'settings' : 'player', authenticated ? 'Connect an integration' : 'Start a ride'), 'activity-history')}
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
                ${state.powerDuration.map(effort => `<tr><td>${time(effort.seconds)}</td><td>${number(effort.watts)}</td><td>${number(effort.wKg, 2)}</td></tr>`).join('')}</tbody></table></div>`)}</div>` :
                card('Training metrics', '<p>Configure your Coach profile to calculate training-load and power metrics from your history. No inferred fitness score is shown without sufficient data.</p>')}`;
    }
    function player() {
        return `<section class="ride-panel"><div class="ride-heading"><div><p class="eyebrow">Workout player</p><h2>${escape(db.workout?.meta?.name || 'Free ride')}</h2></div>
            <span id="ride-status" role="status"></span></div>
            <div class="ride-sensors">${deviceButtons()}</div>
            <div class="ride-metrics">${[['power', 'Power', 'W'], ['target', 'Target', 'W'], ['countdown', 'Interval left', ''],
                ['cadence', 'Cadence', 'rpm'], ['hr', 'Heart rate', 'bpm'], ['elapsed', 'Elapsed', '']].map(([key, label, unit]) =>
                `<div class="ride-metric ${key === 'power' ? 'primary' : ''}"><span>${label}</span><strong id="ride-${key}">--</strong><small>${unit}</small></div>`).join('')}</div>
            <div class="interval-context"><span id="ride-interval"></span><span id="ride-next"></span><span id="ride-remaining"></span></div>
            <progress id="ride-progress" max="1" value="0" aria-label="Workout progress"></progress>
            <div class="ride-actions"><button data-action="ride-toggle" id="ride-toggle">Start workout</button>
                <button class="secondary" data-action="ride-skip">Skip interval</button>
                <button class="secondary" data-action="ride-finish">Finish & save</button></div>
            <section id="ride-unsaved" role="alert" hidden><h3>Recording needs saving</h3>
                <p>Keep this page open. Download your FIT file now, or retry local storage after freeing space.</p>
                <div class="button-row"><button data-action="recover-download">Download unsaved FIT</button>
                <button class="secondary" data-action="recover-save">Retry saving</button></div></section>
            <div class="ride-adjust"><label>Trainer mode<select id="ride-mode"><option value="erg">ERG</option>
                <option value="resistance">Resistance</option><option value="sim">Slope</option></select></label>
                <button class="secondary" data-action="target-down" aria-label="Decrease current target">-</button>
                <span id="ride-adjust-value"></span><button class="secondary" data-action="target-up" aria-label="Increase current target">+</button></div>
            <p class="muted" id="ride-recovery">${db.elapsed ? 'Ride recovered on this device. Reconnect sensors before resuming.' : 'Connect a trainer and sensors, then start. Your ride is recovered locally after an interruption.'}</p>
            <details id="ride-advanced" ${advancedPlayer ? 'open' : ''}><summary>Workout profile and original trainer controls</summary><p>The controls below use the original Athlima workout engine.</p></details>
        </section>`;
    }
    function settings() {
        return `<div class="dashboard-grid">${card('Rider profile', `<p>${authenticated ? 'These settings are private to this account on this device. Coach configuration is stored on the server.' : 'Guest settings, workouts, recordings, calendar and coaching are stored only on this device.'}</p>
            <form id="profile-form"><label>FTP (W)<input name="ftp" type="number" min="1" max="1500" value="${db.ftp}" required></label>
                <label>Body mass (kg)<input name="weight" type="number" min="1" max="500" step="0.1" value="${db.weight}" required></label>
                <button>Save profile</button></form>${integration?.connected ? '<button class="secondary" data-action="import-profile">Use Intervals.icu FTP / weight</button>' : ''}
                <p class="muted">After changing FTP, archive and regenerate an active plan before riding it.</p>`)}
            ${authenticated ? `${card('Intervals.icu', integrationView())}
            ${card('Private device backup', `<p>Back up this account's workout files, recent FIT recordings, settings and manual calendar to the server.</p>
                <div class="button-row"><button class="secondary" data-action="backup">Save backup</button>
                <button class="secondary" data-action="restore">Restore backup</button></div>
                <p class="muted">Restore merges workout/recording files and replaces device settings/calendar. It does not import another account's data.</p>`)}
            ${card('Your account', `<p>${escape(account.email)}</p><p>Coach history and imports are automatically saved to this server. Bluetooth pairings and ride recovery stay on this device.</p>
                <button class="secondary" data-action="export">Export training history</button>
                <form id="delete-account"><label>Confirm email to permanently delete this account and all server data
                <input name="confirm" type="email" autocomplete="off" required></label><button class="danger">Delete account</button></form>`)}` :
                card('Optional server account', `<p>Ride, connect devices, import workouts, download FIT recordings, use the calendar and run local coaching without an account.
                    Sign in for account-scoped server coaching, private backups and Intervals.icu integrations. Guest data is kept separately and is never automatically uploaded.</p>
                    <button data-action="signin">Sign in / Create account</button><button class="secondary" data-action="export">Export local training history</button>`)}</div>`;
    }
    function integrationView() {
        if(!integration) return '<p role="status">Loading integration status...</p>';
        if(!integration.configured) return '<p>The server operator must configure the encryption key before connections are available.</p>';
        if(!integration.connected) return `<p>Import cycling history into your Activities, analytics and Coach. Use a personal API key from Intervals.icu Settings; it is encrypted on this server, never stored in the browser.</p>
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
            <p class="muted">Disconnect removes credentials and stops imports. Imported history is retained. Future syncs recheck the last seven days for updates.</p>`;
    }
    async function loadIntegration() {
        if(!authenticated) return;
        if(integrationLoading) return;
        integrationLoading = true;
        try {
            const previous = integration;
            integration = await serverRequest('integrations/intervals');
            xf.dispatch('services', {intervals: integration.connected});
            if(route === 'settings' && !root.querySelector('#intervals-connect:focus-within')) render();
            if(previous && ['queued', 'running'].includes(previous.status) && integration.status === 'connected') {
                await refresh();
                report('Activity sync completed.');
            }
            clearTimeout(syncTimer);
            if(['queued', 'running'].includes(integration.status)) syncTimer = setTimeout(loadIntegration, 2500);
        } catch(error) { report(error.message, true); }
        finally { integrationLoading = false; }
    }
    let libraryFilters = initialLibraryFilters();
    function render() {
        if(!ready) return;
        const data = coachingData();
        const [title, subtitle] = routes[route] || ['Workout editor', 'Build a session'];
        root.querySelector('#route-title').textContent = mobile && route === 'dashboard' ? 'Ready to ride?' : title;
        root.querySelector('#route-subtitle').textContent = subtitle;
        root.querySelectorAll('nav a').forEach(a => a.setAttribute('aria-current',
            a.getAttribute('href') === `#/${route}` ? 'page' : 'false'));
        document.body.dataset.route = route;
        legacy.hidden = !['calendar', 'coach', 'devices', 'editor', 'player'].includes(route) || (route === 'player' && !advancedPlayer);
        root.querySelector('#legacy-slot').classList.toggle('legacy-player', route === 'player');
        content.innerHTML = route === 'dashboard' ? dashboard(data) : route === 'library' ? renderLibrary(db.workouts, libraryFilters)
            : route === 'workout' ? details(data) : route === 'plan' ? plan(data)
                : route === 'activities' ? activities(data) : route === 'progress' ? progress(data)
                    : route === 'player' ? player() : route === 'settings' ? settings()
                        : route === 'devices' ? `<p class="muted">Select your trainer and sensors below, then choose which device supplies each measurement.
                            Connections and controls use the existing BLE / ANT+ engine.</p>
                            ${!navigator.bluetooth ? '<p role="alert">Web Bluetooth is unavailable in this browser. Use Chrome/Edge on a supported platform and HTTPS or localhost. ANT+ requires Web Serial or WebUSB.</p>' : ''}`
                            : route === 'coach' ? `<p class="muted">Your ${authenticated ? 'private' : 'on-device'} Coach plans around your goal, schedule and ride history.</p>` : '';
        if(route === 'player') updateRide();
    }
    function navigate() {
        const [name, id] = window.location.hash.replace(/^#\/?/, '').split('/');
        route = Object.hasOwn(routes, name) || name === 'editor' ? name : 'dashboard';
        try { selectedId = decodeURIComponent(id || ''); }
        catch { selectedId = ''; }
        report(coachingError, Boolean(coachingError));
        render();
        if(route === 'settings') void loadIntegration();
        if(route === 'calendar') void legacy.querySelector('training-calendar').loadPlannedMonth();
        root.querySelector('#route-title').focus?.();
    }
    function updateRide() {
        if(!ready || route !== 'player') return;
        const intervals = db.workout?.intervals || [];
        const current = intervals[db.intervalIndex];
        const next = current?.steps?.[db.stepIndex + 1] || intervals[db.intervalIndex + 1]?.steps?.[0];
        const duration = db.workout?.meta?.duration;
        const remaining = db.workoutStatus === 'done' ? 0
            : db.workoutStatus === 'started' && current ? Math.max(0, db.lapTime) +
                intervals.slice(db.intervalIndex + 1).reduce((total, interval) => total + interval.duration, 0)
                : duration;
        const connected = metric => !db.connectedDevices || db.connectedDevices[db.sources?.[metric]] === true;
        const values = {
            power: connected('power') ? number(db.power1s) : '--',
            target: number(db.powerTarget), countdown: time(db.lapTime), cadence: connected('cadence') ? number(db.cadence) : '--',
            hr: connected('heartRate') && db.heartRate > 0 ? number(db.heartRate) : '--', elapsed: time(db.elapsed),
            interval: intervals.length ? `Interval ${Math.min(intervals.length, db.intervalIndex + 1)} / ${intervals.length}` : 'Free ride',
            next: next ? `Next: ${time(next.duration)} / ${next.power == null ? 'slope target' : `${number(targetPower(next.power, db.ftp))} W`}` : 'No next interval',
            remaining: duration ? `${time(remaining)} remaining` : '',
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
        if(progress) progress.value = duration ? Math.max(0, Math.min(1, 1 - remaining / duration)) : 0;
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
        const position = event.target.selectionStart;
        render();
        const input = root.querySelector('#workout-search');
        input.focus();
        input.setSelectionRange(position, position);
    });
    root.addEventListener('toggle', event => {
        if(event.target.id !== 'ride-advanced') return;
        advancedPlayer = event.target.open;
        legacy.hidden = !advancedPlayer;
        if(advancedPlayer) window.dispatchEvent(new Event('resize'));
    }, true);
    root.addEventListener('change', event => {
        const libraryField = {
            'workout-category': 'category', 'workout-type': 'type',
            'workout-duration': 'duration', 'workout-sort': 'sort',
        }[event.target.id];
        if(libraryField) {
            libraryFilters[libraryField] = event.target.value;
            render();
            root.querySelector(`#${event.target.id}`).focus();
            return;
        }
        if(event.target.id === 'ride-mode') xf.dispatch('ui:mode-set', event.target.value);
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
        if(!['profile-form', 'intervals-connect', 'delete-account'].includes(event.target.id)) return;
        event.preventDefault();
        const form = event.target;
        const values = new FormData(form);
        void run(async () => {
            if(form.id === 'profile-form') {
                xf.dispatch('ui:ftp-set', Number(values.get('ftp')));
                xf.dispatch('ui:weight-set', Number(values.get('weight')));
                report('Device profile saved.');
            } else if(form.id === 'delete-account') {
                if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before deleting the account.');
                if(!confirm('Permanently delete this account, all server training data and integrations?')) return;
                await serverRequest('account', {method: 'DELETE', body: {confirm: values.get('confirm')}});
                window.localStorage.setItem('athlima-session-change', String(Date.now()));
                window.localStorage.removeItem(SERVER_MODE_KEY);
                window.location.reload();
            } else {
                const apiKey = values.get('apiKey');
                form.reset();
                integration = await serverRequest('integrations/intervals', {method: 'PUT',
                    body: {apiKey, oldest: values.get('oldest')}});
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
            render();
            root.querySelector('#workout-search').focus();
            return;
        }
        const device = event.target.closest('[data-device]')?.dataset.device;
        if(device) { requestedDevices.add(device); xf.dispatch(`ui:ble:${device}:switch`); return; }
        const download = event.target.closest('[data-download]')?.dataset.download;
        if(download) {
            void run(async () => { const {models} = await import('../models/models.js'); await models.activity.download(download); });
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
                        await serverRequest(`integrations/intervals/activity-data?${new URLSearchParams({activityId})}`);
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
        void run(async () => {
            if(engineModels.activity?.pendingRecording && !['recover-download', 'recover-save'].includes(action)) {
                throw new Error('Save or download the unsaved FIT recording before continuing.');
            }
            if(action === 'signin') {
                if(db?.watchStatus !== 'stopped') throw new Error('Finish your current ride before signing in.');
                window.location.hash = '/account';
                window.location.reload();
            } else if(action === 'logout') {
                if(db?.watchStatus !== 'stopped') throw new Error('Finish your current ride before signing out.');
                await serverRequest('logout', {method: 'POST', body: {}});
                window.localStorage.setItem('athlima-session-change', String(Date.now()));
                window.localStorage.removeItem(SERVER_MODE_KEY);
                serverAccount.email = null;
                window.location.reload();
            } else if(action === 'prepare') {
                if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before selecting another workout.');
                const workout = selectedWorkout(coachingData());
                if(workout.coachingWorkoutId) {
                    if(coachingData().profile.ftp !== db.ftp) throw new Error('Update device FTP to match your Coach profile, or regenerate your plan.');
                    xf.dispatch('ui:coaching:select', workout);
                } else xf.dispatch('workout', workout);
                window.location.hash = '/player';
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
            } else if(action === 'sync') {
                integration = await serverRequest('integrations/intervals/sync', {method: 'POST', body: {}});
                render();
                void loadIntegration();
            } else if(action === 'test-connection') {
                await serverRequest('integrations/intervals/test', {method: 'POST', body: {}});
                report('Intervals.icu connection is working.');
            } else if(action === 'disconnect') {
                if(!confirm('Disconnect Intervals.icu? Imported activities will be kept.')) return;
                integration = await serverRequest('integrations/intervals', {method: 'DELETE', body: {}});
                clearTimeout(syncTimer);
                render();
            } else if(action === 'backup' || action === 'restore') {
                if(db.watchStatus !== 'stopped') throw new Error('Finish your current ride before changing device data.');
                const {createBackup, restoreBackup} = await import('../server/backup.js');
                const saved = await serverRequest('backup');
                if(action === 'backup') {
                    if(saved.data && !confirm('Replace the existing server backup with this device’s data?')) return;
                    await serverRequest('backup', {method: 'PUT', body: {revision: saved.revision, data: await createBackup(db.workouts)}});
                    report('Private device backup saved.');
                } else {
                    if(!saved.data) throw new Error('No server backup is available.');
                    if(!confirm('Merge the backup and replace this device’s settings and manual calendar?')) return;
                    await restoreBackup(saved.data);
                    window.location.reload();
                }
            } else if(action === 'export') {
                const {fileHandler} = await import('../file.js');
                fileHandler.download()(JSON.stringify(coachingData(), null, 2), 'athlima-training-history.json', 'application/json');
            } else if(action === 'import-profile') {
                const {models} = await import('../models/models.js');
                const settings = await models.api.intervals.getAthlete();
                if(settings.ftp > 0) xf.dispatch('ui:ftp-set', settings.ftp);
                if(settings.weight > 0) xf.dispatch('ui:weight-set', settings.weight);
                render();
                report('Available FTP and body mass imported. Regenerate an active plan if FTP changed.');
            } else if(action === 'reload') window.location.reload();
            else if(action === 'retry-rides') {
                await refresh();
                const {syncRecordedRides} = await import('../server/ride-sync.js');
                await syncRecordedRides(coachingService());
                await refresh();
                db.activity = await engineModels.activity.restore();
                render();
                report(authenticated ? 'Recorded rides synchronized.' : 'Local coaching history updated.');
            }
        });
    });
    window.addEventListener('hashchange', navigate);
    window.addEventListener('session:expired', () => { clearTimeout(syncTimer); ready = false; });
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
    for(const key of ['elapsed', 'lapTime', 'power1s', 'powerTarget', 'cadence', 'heartRate', 'watchStatus',
        'workoutStatus', 'intervalIndex', 'mode', 'resistanceTarget', 'slopeTarget', 'sources']) xf.sub(`db:${key}`, updateRide);
    const started = new Promise((resolve, reject) => {
        window.addEventListener('app:ready', resolve, {once: true});
        window.addEventListener('app:error', event => reject(new Error(event.detail.data)), {once: true});
    });
    await import('../index.js');
    ({db} = await import('../db.js'));
    ({models: engineModels} = await import('../models/models.js'));
    await started;
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
    void loadIntegration();
    if(db.elapsed > 0) {
        report('A previous ride was recovered. Reconnect your trainer and resume in Ride.');
        window.location.hash = '/player';
    }
    // Keep multi-device edits explicit; never overwrite a dirty form on focus.
    window.addEventListener('focus', () => {
        if(ready && !busy && !['coach', 'settings', 'player'].includes(route)) void run(refresh);
    });
}
