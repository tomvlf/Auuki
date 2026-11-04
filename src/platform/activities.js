import { addDays, localDay, weekday } from '../coaching/domain.js';
import { renderPowerProfile } from '../views/power-profile.js';
import { escape, number, time } from './format.js';

const loadLabels = {
    power: 'Power load',
    sessionRpe: 'Session RPE load',
    heartRate: 'Heart-rate load',
    duration: 'Training minutes',
};

export function activityLists(data, localActivities, authenticated) {
    const historyAvailable = Array.isArray(data?.activities);
    const localById = new Map(localActivities.map(activity => [String(activity.id), activity]));
    const history = historyAvailable ? data.activities.map(activity => {
        const local = localById.get(String(activity.id));
        if(!local) return activity;
        const combined = {...activity};
        for(const key of ['distance', 'averagePower', 'averageHeartRate', 'ftp']) {
            if(combined[key] == null && local[key] != null) combined[key] = local[key];
        }
        return combined;
    }).sort((a, b) => b.start.localeCompare(a.start)) : [];
    const historyIds = new Set(history.map(activity => String(activity.id)));
    const deviceOnly = [...localById.values()].filter(activity => !historyIds.has(String(activity.id)));
    return {
        historyAvailable,
        history,
        localById,
        pending: deviceOnly.filter(activity => activity.pendingSync),
        cached: authenticated ? [] : deviceOnly.filter(activity => !activity.pendingSync),
    };
}

function activityDay(activity, timeZone) {
    if(typeof activity.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(activity.day)) {
        const parsed = Date.parse(`${activity.day}T00:00:00Z`);
        if(Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === activity.day) return activity.day;
    }
    const timestamp = activity.start ?? activity.timestamp;
    if(timestamp == null || timestamp === '') return null;
    const instant = new Date(timestamp);
    return Number.isFinite(instant.getTime()) ? localDay(instant, timeZone) : null;
}

function total(values) {
    if(!values.length) return {value: 0, complete: true};
    const known = values.filter(value => Number.isFinite(value) && value >= 0);
    return {
        value: known.length ? known.reduce((sum, value) => sum + value, 0) : null,
        complete: known.length === values.length,
    };
}

function periodTotals(activities, loadSource) {
    return {
        count: activities.length,
        duration: total(activities.map(activity => activity.duration)),
        distance: total(activities.map(activity => activity.distance)),
        load: total(activities.map(activity => loadSource === 'duration'
            ? Number.isFinite(activity.duration) ? activity.duration / 60 : null
            : activity.loadMetrics?.[loadSource]?.value)),
    };
}

export function summarizeActivityPeriods(lists, {day, timeZone, loadSource = 'power'}) {
    const weekStart = addDays(day, -((weekday(day) + 6) % 7));
    const monthStart = `${day.slice(0, 7)}-01`;
    const rides = [...lists.history, ...lists.pending, ...lists.cached]
        .filter(activity => !activity.sport || activity.sport === 'cycling')
        .map(activity => ({activity, day: activityDay(activity, timeZone)}));
    const inRange = start => rides.filter(ride => ride.day && ride.day >= start && ride.day <= day)
        .map(ride => ride.activity);
    return {
        week: periodTotals(inRange(weekStart), loadSource),
        month: periodTotals(inRange(monthStart), loadSource),
        undated: rides.filter(ride => !ride.day).length,
    };
}

function durationLabel(seconds) {
    const minutes = Math.round(seconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function totalMetric(label, metric, format) {
    const title = metric.complete ? label : `Known ${label[0].toLowerCase()}${label.slice(1)}`;
    return `<div><dt>${title}</dt><dd>${metric.value == null ? '--' : format(metric.value)}</dd></div>`;
}

function periodMarkup(label, values, loadSource) {
    return `<section class="activity-period" aria-label="${label} activity totals">
        <h3>${label}</h3>
        <dl class="activity-period-metrics">
            <div><dt>Rides</dt><dd>${values.count}</dd></div>
            ${totalMetric('Time', values.duration, durationLabel)}
            ${totalMetric('Distance', values.distance, value => `${number(value / 1000, 1)} km`)}
            ${totalMetric(loadLabels[loadSource], values.load, value => number(value, 1))}
        </dl>
    </section>`;
}

export function renderActivityOverview(data, lists, state, now = Date.now()) {
    if(!lists.historyAvailable) {
        return `<section class="activity-overview"><p role="status" class="muted">
            Activity history is unavailable, so weekly and monthly totals cannot be calculated.</p></section>`;
    }
    const timeZone = data?.profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const day = localDay(now, timeZone);
    const currentState = state?.date === day ? state : null;
    const weekStart = addDays(day, -((weekday(day) + 6) % 7));
    const monthStart = `${day.slice(0, 7)}-01`;
    const start = weekStart < monthStart ? weekStart : monthStart;
    const currentRides = [...lists.history, ...lists.pending, ...lists.cached].filter(activity => {
        const recordedDay = activityDay(activity, timeZone);
        return (!activity.sport || activity.sport === 'cycling') && recordedDay && recordedDay >= start && recordedDay <= day;
    });
    const availableSource = ['power', 'sessionRpe', 'heartRate'].find(source =>
        currentRides.some(activity => Number.isFinite(activity.loadMetrics?.[source]?.value)));
    const loadSource = Object.hasOwn(loadLabels, currentState?.loadSource)
        ? currentState.loadSource : availableSource || 'power';
    const periods = summarizeActivityPeriods(lists, {day, timeZone, loadSource});
    const hasState = currentState && [currentState.chronicLoad, currentState.acuteLoad,
        currentState.formBalance, currentState.rampRate].every(Number.isFinite);
    const deviceOnly = lists.pending.length + lists.cached.length;
    return `<section class="activity-overview" aria-label="Activity overview">
        <div class="activity-periods">
            ${periodMarkup('This week', periods.week, loadSource)}
            ${periodMarkup('This month', periods.month, loadSource)}
        </div>
        ${hasState ? `<div class="activity-load-state" aria-label="Current training load">
            <span>Fitness <strong>${number(currentState.chronicLoad)}</strong></span>
            <span>Fatigue <strong>${number(currentState.acuteLoad)}</strong></span>
            <span>Form <strong>${number(currentState.formBalance)}</strong></span>
            <span>Ramp <strong>${number(currentState.rampRate, 1)}</strong></span>
        </div>
        <p class="muted activity-overview-note">Modelled from coaching history using ${escape(loadLabels[loadSource])};
            these are not direct measurements.${deviceOnly ? ' Device-only rides are not included in the model.' : ''}</p>` : ''}
        <p class="muted activity-overview-note">The week starts on Monday. Totals include dated cycling activities${deviceOnly ? ' and device-only recordings' : ''}.
            ${periods.undated ? `${periods.undated} undated ${periods.undated === 1 ? 'ride is' : 'rides are'} excluded.` : ''}</p>
    </section>`;
}

function profileMarkup(activity, local) {
    const samples = [local?.powerProfile, activity.powerProfile, activity.streams?.power]
        .find(values => Array.isArray(values) && values.filter(value => Number.isFinite(value) && value >= 0).length >= 2);
    return renderPowerProfile({
        samples: samples || [],
        ftp: activity.ftp ?? local?.ftp,
        label: activity.name || 'Cycling activity',
    }) || '<small class="activity-no-profile">No recorded power profile</small>';
}

function measurement(value, unit, digits = 0) {
    return Number.isFinite(value) && value >= 0 ? `${number(value, digits)} ${unit}` : '--';
}

function loadAndFeedback(activity) {
    const source = ['power', 'sessionRpe', 'heartRate']
        .find(key => Number.isFinite(activity.loadMetrics?.[key]?.value));
    const values = [];
    if(source) values.push(`${loadLabels[source]} ${number(activity.loadMetrics[source].value, 1)}`);
    if(Number.isFinite(activity.rpe)) values.push(`RPE ${number(activity.rpe, 1)}`);
    return values.length ? values.join(' / ') : '--';
}

export function localActivityRow(activity, timeZone) {
    const day = activityDay(activity, timeZone);
    return `<li class="session-row activity-local">
        <div class="activity-local-details"><strong>${escape(activity.name || 'Recorded ride')}</strong>
            <span>${day ? `${escape(day)} / ` : ''}${time(activity.duration)} / ${measurement(activity.distance == null ? null : activity.distance / 1000, 'km', 1)}</span>
            <span>${measurement(activity.averagePower, 'W')} / ${measurement(activity.averageHeartRate, 'bpm')}</span>
            ${profileMarkup(activity)}
        </div>
        <button class="secondary" data-download="${escape(activity.id)}">Download FIT</button>
    </li>`;
}

export function historyActivityRow(activity, local, connected) {
    const actions = local ? `<div class="button-row activity-file-actions">
        <button class="secondary" data-download="${escape(activity.id)}">FIT</button>
        ${connected ? `<button class="secondary" data-upload-ride="${escape(activity.id)}">Send to Intervals.icu</button>` : ''}
    </div>` : '--';
    return `<tr>
        <td data-label="Activity" class="activity-title"><strong>${escape(activity.name || 'Cycling activity')}</strong>
            <small>${escape(activity.day)}</small>${profileMarkup(activity, local)}</td>
        <td data-label="Duration">${time(activity.duration)}</td>
        <td data-label="Distance">${measurement(activity.distance == null ? null : activity.distance / 1000, 'km', 1)}</td>
        <td data-label="Avg power">${measurement(activity.averagePower, 'W')}</td>
        <td data-label="Avg HR">${measurement(activity.averageHeartRate, 'bpm')}</td>
        <td data-label="Load / feedback">${loadAndFeedback(activity)}</td>
        <td data-label="Source">${escape(activity.source)}<small>${escape(activity.externalId)}</small></td>
        <td data-label="File">${actions}</td>
    </tr>`;
}
