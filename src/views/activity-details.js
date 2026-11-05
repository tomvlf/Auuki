/*
 * activity-details.js: readable metric list for an imported or recorded activity.
 *
 * Used by the activity history and the training calendar so both show the same
 * Intervals.icu summary values. Values that were not provided are omitted.
 */

const escapeHTML = value => String(value).replace(/[&<>"']/g, c =>
    ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
const num = value => typeof value === 'number' && Number.isFinite(value);
const round = (value, digits = 0) => Number(value.toFixed(digits)).toLocaleString('en', {maximumFractionDigits: digits});

function clock(seconds) {
    const total = Math.round(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor(total % 3600 / 60);
    const s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function pace(activity) {
    const time = activity.movingTime ?? activity.duration;
    if(!['running', 'walking', 'hiking'].includes(activity.sport) || !num(activity.distance) ||
       activity.distance <= 0 || !num(time)) return null;
    return `${clock(time / (activity.distance / 1000))} /km`;
}

function zones(times) {
    if(!Array.isArray(times)) return null;
    const entries = times.map((item, index) => typeof item === 'number'
        ? [`Z${index + 1}`, item] : [item?.id, item?.secs])
        .filter(([id, secs]) => id && num(secs) && secs > 0);
    return entries.length ? entries.map(([id, secs]) => `${id} ${clock(secs)}`).join(' · ') : null;
}

const feelLabels = {1: 'Strong', 2: 'Good', 3: 'Normal', 4: 'Poor', 5: 'Weak'};

/**
 * Returns label/value pairs for every available activity measurement.
 *
 * @param {object} activity - Normalized activity, optionally with Intervals.icu details.
 * @returns {Array<[string, string]>} Formatted rows.
 */
export function activityDetailRows(activity = {}) {
    const d = activity.details || {};
    const pick = (...values) => values.find(num);
    const kj = value => num(value) ? `${round(value / 1000)} kJ` : null;
    const rows = [
        ['Type', d.subType && d.subType !== 'NONE' ? `${d.type || ''} (${d.subType.toLowerCase()})` : null],
        ['Elapsed time', num(pick(activity.elapsedTime, d.elapsedTime)) ? clock(pick(activity.elapsedTime, d.elapsedTime)) : null],
        ['Moving time', num(pick(activity.movingTime, d.movingTime)) ? clock(pick(activity.movingTime, d.movingTime)) : null],
        ['Distance', num(activity.distance) && activity.distance > 0 ? `${round(activity.distance / 1000, 2)} km` : null],
        ['Average speed', num(d.averageSpeed) && d.averageSpeed > 0 ? `${round(d.averageSpeed * 3.6, 1)} km/h` : null],
        ['Max speed', num(d.maxSpeed) && d.maxSpeed > 0 ? `${round(d.maxSpeed * 3.6, 1)} km/h` : null],
        ['Pace', pace(activity)],
        ['Elevation gain', num(activity.elevation) ? `${round(activity.elevation)} m` : null],
        ['Elevation loss', num(d.elevationLoss) ? `${round(d.elevationLoss)} m` : null],
        ['Average power', num(activity.averagePower) ? `${round(activity.averagePower)} W` : null],
        ['Normalized power', num(activity.normalizedPower) ? `${round(activity.normalizedPower)} W` : null],
        ['Max power', num(activity.maximumPower) ? `${round(activity.maximumPower)} W` : null],
        ['FTP', num(activity.ftp) ? `${round(activity.ftp)} W` : null],
        ['Intensity', num(d.intensity) ? `${round(d.intensity, 1)}%`
            : num(activity.intensityFactor) ? `${round(activity.intensityFactor * 100, 1)}%` : null],
        ['Variability index', num(d.variabilityIndex) ? round(d.variabilityIndex, 2) : null],
        ['Efficiency factor', num(d.efficiencyFactor) ? round(d.efficiencyFactor, 2) : null],
        ['Power/HR', num(d.powerHr) ? round(d.powerHr, 2) : null],
        ['Work', num(activity.workKj) && activity.workKj > 0 ? `${round(activity.workKj)} kJ` : null],
        ['Work above FTP', kj(d.workAboveFtp)],
        ['W\u2032 depletion', num(d.maxWbalDepletion) ? `${round(d.maxWbalDepletion / 1000, 1)} kJ` : null],
        ['L/R balance', num(d.lrBalance) ? `${round(d.lrBalance, 1)} / ${round(100 - d.lrBalance, 1)}` : null],
        ['Average heart rate', num(activity.averageHeartRate) ? `${round(activity.averageHeartRate)} bpm` : null],
        ['Max heart rate', num(activity.maximumHeartRate) ? `${round(activity.maximumHeartRate)} bpm` : null],
        ['Decoupling', num(d.decoupling) ? `${round(d.decoupling, 1)}%` : null],
        ['Average cadence', num(activity.averageCadence) ? `${round(activity.averageCadence)} rpm` : null],
        ['Training load (Intervals)', num(d.trainingLoad) ? round(d.trainingLoad) : null],
        ['Power load', num(d.powerLoad) ? round(d.powerLoad) : null],
        ['HR load', num(d.hrLoad) ? round(d.hrLoad) : null],
        ['Pace load', num(d.paceLoad) ? round(d.paceLoad) : null],
        ['TRIMP', num(d.trimp) ? round(d.trimp) : null],
        ['Strain', num(d.strainScore) ? round(d.strainScore, 1) : null],
        ['Fitness / fatigue (Intervals)', num(d.fitness) && num(d.fatigue) ? `${round(d.fitness)} / ${round(d.fatigue)}` : null],
        ['Polarization index', num(d.polarizationIndex) ? round(d.polarizationIndex, 2) : null],
        ['Power zones', zones(d.powerZoneTimes)],
        ['Heart-rate zones', zones(d.heartRateZoneTimes)],
        ['Pace zones', zones(d.paceZoneTimes)],
        ['RPE', num(activity.rpe) ? `${round(activity.rpe, 1)}/10` : null],
        ['Feel', feelLabels[d.feel] || null],
        ['Calories', num(d.calories) ? `${round(d.calories)} kcal` : null],
        ['Carbs used', num(d.carbsUsed) ? `${round(d.carbsUsed)} g` : null],
        ['Carbs ingested', num(d.carbsIngested) ? `${round(d.carbsIngested)} g` : null],
        ['Temperature', num(d.averageTemp) ? `${round(d.averageTemp, 1)} °C` : null],
        ['Weather', num(d.weatherTemp) ? `${round(d.weatherTemp, 1)} °C${num(d.windSpeed) ? `, wind ${round(d.windSpeed * 3.6)} km/h` : ''}` : null],
        ['Laps', num(d.lapCount) ? round(d.lapCount) : null],
        ['Swim', num(d.lengths) ? `${d.lengths} lengths${num(d.poolLength) ? ` × ${d.poolLength} m` : ''}` : null],
        ['Weight lifted', num(d.kgLifted) ? `${round(d.kgLifted)} kg` : null],
        ['Compliance', num(d.compliance) ? `${round(d.compliance)}%` : null],
        ['Environment', [activity.indoor ? 'Indoor' : activity.indoor === false ? 'Outdoor' : null,
            d.commute ? 'Commute' : null, d.race ? 'Race' : null].filter(Boolean).join(', ') || null],
        ['Device', d.deviceName || null],
        ['Power meter', d.powerMeter || null],
        ['Gear', d.gear || null],
        ['Tags', Array.isArray(d.tags) && d.tags.length ? d.tags.join(', ') : null],
    ];
    return rows.filter(([, value]) => value != null && value !== '').map(([label, value]) => [label, String(value)]);
}

/**
 * Renders a collapsible list with every available activity measurement.
 *
 * @param {object} activity - Normalized activity.
 * @returns {string} HTML markup, or an empty string when nothing is available.
 */
export function renderActivityDetails(activity) {
    const rows = activityDetailRows(activity);
    const description = typeof activity?.details?.description === 'string' ? activity.details.description.trim() : '';
    if(!rows.length && !description) return '';
    return `<details class="activity-details">
        <summary>All metrics</summary>
        ${description ? `<p class="activity-details--description">${escapeHTML(description)}</p>` : ''}
        <dl>${rows.map(([label, value]) =>
            `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(value)}</dd></div>`).join('')}</dl>
    </details>`;
}
