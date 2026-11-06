import { addDays, localDay, weekday } from '../coaching/domain.js';
import { renderPowerProfile } from '../views/power-profile.js';
import { activityIcon, activityTypeLabel } from '../views/activity-icon.js';
import { renderActivityDetails } from '../views/activity-details.js';
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
            <div><dt>Activities</dt><dd>${values.count}</dd></div>
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
        return recordedDay && recordedDay >= start && recordedDay <= day;
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
            these are not direct measurements. Only cycling activities are modelled.${deviceOnly ? ' Device-only rides are not included in the model.' : ''}</p>` : ''}
        <p class="muted activity-overview-note">The week starts on Monday. Totals include all dated activities${deviceOnly ? ' and device-only recordings' : ''}.
            ${periods.undated ? `${periods.undated} undated ${periods.undated === 1 ? 'activity is' : 'activities are'} excluded.` : ''}</p>
    </section>`;
}

function profileMarkup(activity, local) {
    const samples = [local?.powerProfile, activity.powerProfile, activity.streams?.power]
        .find(values => Array.isArray(values) && values.filter(value => Number.isFinite(value) && value >= 0).length >= 2);
    return renderPowerProfile({
        samples: samples || [],
        ftp: activity.ftp ?? local?.ftp,
        label: activity.name || 'Activity',
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
        <div class="activity-local-details"><span class="activity-heading">${activityIcon(activity)}<strong>${escape(activity.name || 'Recorded ride')}</strong></span>
            <span>${day ? `${escape(day)} / ` : ''}${time(activity.duration)} / ${measurement(activity.distance == null ? null : activity.distance / 1000, 'km', 1)}</span>
            <span>${measurement(activity.averagePower, 'W')} / ${measurement(activity.averageHeartRate, 'bpm')}</span>
            ${profileMarkup(activity)}
        </div>
        <div class="button-row"><button class="secondary" data-download="${escape(activity.id)}">Download FIT</button>
        <button class="secondary" data-delete-ride="${escape(activity.id)}">Delete</button></div>
    </li>`;
}

export function historyActivityRow(activity, local, connected) {
    const intervalsId = activity.source === 'intervals' ? activity.externalId : null;
    const actions = local || activity.source === 'athlima' || (connected && intervalsId) ? `<div class="button-row activity-file-actions">
        ${local ? `<button class="secondary" data-download="${escape(activity.id)}">FIT</button>` : ''}
        ${local && connected ? `<button class="secondary" data-upload-ride="${escape(activity.id)}">Send to Intervals.icu</button>` : ''}
        ${connected && intervalsId ? `<button class="secondary" data-load-activity="${escape(intervalsId)}" aria-expanded="false">Route &amp; data</button>` : ''}
        ${activity.source === 'athlima' ? `<button class="secondary" data-delete-ride="${escape(activity.id)}">Delete</button>` : ''}
    </div>` : '--';
    return `<tr>
        <td data-label="Activity" class="activity-title"><span class="activity-heading">${activityIcon(activity)}
            <strong>${escape(activity.name || 'Activity')}</strong></span>
            <small>${escape(activity.day)} · ${escape(activityTypeLabel(activity.activityType, activity.sport || 'cycling'))}</small>
            ${profileMarkup(activity, local)}${renderActivityDetails(activity)}
            ${connected && intervalsId ? '<div class="activity-stream-panel" hidden></div>' : ''}</td>
        <td data-label="Duration">${time(activity.duration)}</td>
        <td data-label="Distance">${measurement(activity.distance == null ? null : activity.distance / 1000, 'km', 1)}</td>
        <td data-label="Avg power">${measurement(activity.averagePower, 'W')}</td>
        <td data-label="Avg HR">${measurement(activity.averageHeartRate, 'bpm')}</td>
        <td data-label="Load / feedback">${loadAndFeedback(activity)}</td>
        <td data-label="Source">${escape(activity.source)}<small>${escape(activity.externalId)}</small></td>
        <td data-label="File">${actions}</td>
    </tr>`;
}

function renderStreamChart(label, unit, values, className) {
    if(!Array.isArray(values)) return '';
    const valid = values.filter(value => Number.isFinite(value) && value >= 0);
    if(valid.length < 2) return '';
    const width = 640, height = 150, pad = 8;
    const max = Math.max(1, valid.reduce((result, value) => Math.max(result, value), 0));
    const step = Math.max(1, Math.ceil(values.length / 600));
    const sampled = Array.from({length: Math.ceil(values.length / step)}, (_, index) => values[index * step]);
    if((values.length - 1) % step) sampled.push(values.at(-1));
    let path = '', drawing = false;
    sampled.forEach((value, index) => {
        if(!Number.isFinite(value) || value < 0) { drawing = false; return; }
        const x = pad + index / Math.max(1, sampled.length - 1) * (width - 2 * pad);
        const y = height - pad - value / max * (height - 2 * pad);
        path += `${drawing ? ' L' : ' M'}${x.toFixed(1)} ${y.toFixed(1)}`;
        drawing = true;
    });
    return `<figure class="activity-stream-chart ${className}">
        <figcaption>${label} <span>max ${Math.round(max)} ${unit}</span></figcaption>
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${label} per-second values across the activity">
            <path d="${path.trim()}" vector-effect="non-scaling-stroke"></path>
        </svg><small>${values.length.toLocaleString()} full-resolution samples</small>
    </figure>`;
}

function renderActivityRoute(map) {
    const points = map?.latlngs;
    if(!Array.isArray(points) || points.length < 2) {
        return '<p class="activity-route-empty">No route is available for this activity.</p>';
    }
    const stride = Math.max(1, Math.ceil(points.length / 1000));
    const sampled = points.filter((_, index) => index % stride === 0);
    if(sampled.at(-1) !== points.at(-1)) sampled.push(points.at(-1));
    const latitudes = sampled.map(point => point[0]);
    const longitudes = sampled.map(point => point[1]);
    const midLat = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
    const midLon = (Math.min(...longitudes) + Math.max(...longitudes)) / 2;
    const cosLat = Math.cos(midLat * Math.PI / 180);
    const projected = sampled.map(([lat, lon]) => [(lon - midLon) * cosLat, midLat - lat]);
    const minX = Math.min(...projected.map(point => point[0]));
    const maxX = Math.max(...projected.map(point => point[0]));
    const minY = Math.min(...projected.map(point => point[1]));
    const maxY = Math.max(...projected.map(point => point[1]));
    const scale = Math.min(284 / Math.max(maxX - minX, 0.00001), 124 / Math.max(maxY - minY, 0.00001));
    const screenPoints = projected.map(([x, y]) =>
        [160 + (x - (minX + maxX) / 2) * scale, 70 + (y - (minY + maxY) / 2) * scale]);
    const path = screenPoints.map(([x, y], index) =>
        `${index ? 'L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    return `<figure class="activity-route">
        <figcaption>Activity route <span>${points.length.toLocaleString()} GPS points</span></figcaption>
        <svg viewBox="0 0 320 140" role="img" aria-label="Map of the recorded activity route">
            <path d="${path}" vector-effect="non-scaling-stroke"></path>
            <circle class="activity-route-start" cx="${screenPoints[0][0].toFixed(1)}" cy="${screenPoints[0][1].toFixed(1)}" r="3"></circle>
            <circle class="activity-route-finish" cx="${screenPoints.at(-1)[0].toFixed(1)}" cy="${screenPoints.at(-1)[1].toFixed(1)}" r="3"></circle>
        </svg>
    </figure>`;
}

export function renderActivityStreamData(data) {
    const streams = data?.streams || {};
    const charts = [
        renderStreamChart('Power', 'W', streams.watts, 'activity-stream-chart--power'),
        renderStreamChart('Heart rate', 'bpm', streams.heartrate, 'activity-stream-chart--heart-rate'),
        renderStreamChart('Cadence', 'rpm', streams.cadence, 'activity-stream-chart--cadence'),
    ].filter(Boolean);
    const sampleCount = Math.max(0, ...Object.values(streams).filter(Array.isArray).map(values => values.length));
    return `<section class="activity-stream-data" aria-label="Full activity data">
        ${renderActivityRoute(data?.map)}
        ${charts.length ? `<div class="activity-stream-charts">${charts.join('')}</div>` :
            '<p class="activity-route-empty">No power, heart-rate or cadence streams are available.</p>'}
        <p class="activity-stream-note">Full-resolution streams are loaded on demand and held only in this browser session.
            ${sampleCount.toLocaleString()} samples are available for CSV export.</p>
        <button type="button" class="secondary" data-download-activity-csv>Download full streams as CSV</button>
    </section>`;
}
