import { VERSION, positive, mean, metric, localDay, date } from './domain.js';
import { powerAccumulator } from './power.js';

function optional(value, name, warnings, min = 0, max = Infinity) {
    if(value == null) return null;
    if(!Number.isFinite(value) || value < min || value > max) {
        warnings.push(`Invalid ${name}; excluded from calculations.`);
        return null;
    }
    return value;
}

export function normalizeActivity(raw, profile) {
    if(!raw.id || !positive(raw.duration) || raw.duration > 604800 || typeof raw.start !== 'string' ||
       !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(raw.start) || !Number.isFinite(Date.parse(raw.start))) {
        throw new Error('Activity requires a stable id, ISO start timestamp and positive duration in seconds.');
    }
    date(raw.start.slice(0, 10));
    const warnings = [];
    const timeZone = raw.timeZone || profile.timeZone;
    if(!timeZone) throw new Error('An activity or athlete time zone is required.');
    const day = localDay(raw.start, timeZone);
    const ftp = optional(raw.ftp ?? profile.ftp, 'FTP', warnings, 1);
    const rpe = optional(raw.rpe, 'RPE', warnings, 0, 10);
    let power = optional(raw.normalizedPower ?? raw.weightedPower, 'normalized power', warnings, 0, 3000);
    let avgPower = optional(raw.averagePower, 'average power', warnings, 0, 3000);
    let hr = optional(raw.averageHeartRate, 'average heart rate', warnings, 1, 255);
    let averagePowerSource = avgPower != null ? 'source-summary' : 'unavailable';
    let averageHeartRateSource = hr != null ? 'source-summary' : 'unavailable';
    const inputStreams = raw.streams || {};
    const streams = {};
    for(const key of ['power', 'heartRate']) {
        const values = inputStreams[key];
        if(values != null) {
            if(!Array.isArray(values) || values.length > raw.duration + 1 ||
               values.some(v => !Number.isFinite(v) || (key === 'power' ? v < 0 : v <= 0) ||
                   v > (key === 'power' ? 3000 : 255))) {
                warnings.push(`Invalid ${key} stream; expected contiguous one-second samples.`);
            } else if(values.length) streams[key] = [...values];
        }
    }
    if(avgPower == null && streams.power?.length >= raw.duration * 0.9) {
        avgPower = mean(streams.power);
        averagePowerSource = 'derived-stream-mean';
    }
    if(hr == null && streams.heartRate?.length >= raw.duration * 0.9) {
        hr = mean(streams.heartRate);
        averageHeartRateSource = 'derived-stream-mean';
    }
    const sourceMaxPower = optional(raw.maximumPower, 'maximum power', warnings, 0, 3000);
    const sourceMaxHR = optional(raw.maximumHeartRate, 'maximum HR', warnings, 1, 255);
    const maxPower = sourceMaxPower ?? (streams.power ? streams.power.reduce((a, b) => Math.max(a, b), 0) : null);
    const maxHR = sourceMaxHR ?? (streams.heartRate ? streams.heartRate.reduce((a, b) => Math.max(a, b), 0) : null);
    let powerSource = power == null ? 'unavailable' : 'source-summary';
    if(power == null && streams.power?.length >= 30 && streams.power.length >= raw.duration * 0.9) {
        const calculation = powerAccumulator();
        streams.power.forEach(value => calculation.add(value));
        power = calculation.value();
        powerSource = 'derived-30s-rolling-fourth-power';
    }
    const intensity = power != null && ftp ? power / ftp : null;
    if(power == null) warnings.push('Normalized power unavailable; average power is not used as normalized power.');
    if(!ftp) warnings.push('FTP unavailable; power load unavailable.');
    const tss = intensity == null ? null : raw.duration / 3600 * intensity ** 2 * 100;
    const hrReserve = hr && profile.maxHeartRate > profile.restingHeartRate &&
        positive(profile.restingHeartRate) ? (hr - profile.restingHeartRate) /
            (profile.maxHeartRate - profile.restingHeartRate) : null;
    const hrLoad = hrReserve != null && hrReserve >= 0 && hrReserve <= 1
        ? raw.duration / 60 * hrReserve ** 2 : null;
    const feedback = {};
    for(const key of ['legFreshness', 'sleepQuality', 'muscleSoreness', 'stress']) {
        feedback[key] = optional(raw.feedback?.[key], key, warnings, 1, 5);
    }
    const level = streams.power && streams.heartRate && rpe != null ? 'A'
        : (power != null || avgPower != null) && hr && rpe != null ? 'B'
            : hr && rpe != null ? 'C' : rpe != null ? 'D' : 'E';
    const loadMetrics = {
        power: metric(tss, 'medium', 'Duration hours x (normalized power / FTP)^2 x 100.',
            {duration: raw.duration, normalizedPower: power, ftp}),
        heartRate: metric(hrLoad, 'low', 'HR-reserve squared minutes; not TSS or clinical TRIMP.',
            {duration: raw.duration, averageHeartRate: hr,
                restingHeartRate: profile.restingHeartRate ?? null, maxHeartRate: profile.maxHeartRate ?? null}),
        sessionRpe: metric(rpe == null ? null : raw.duration / 60 * rpe, 'medium',
            'Duration minutes x session RPE.', {duration: raw.duration, rpe}),
    };
    const sourceWork = optional(raw.workKj, 'work', warnings);
    const derivedWork = streams.power?.length >= raw.duration * 0.9 ? streams.power.reduce((a, b) => a + b, 0) / 1000
        : avgPower != null ? avgPower * raw.duration / 1000 : null;
    const bestEfforts = (raw.bestEfforts || []).filter(e => positive(e.seconds) && positive(e.watts) &&
        e.watts <= 3000 && e.seconds <= raw.duration).map(e => ({...e}));
    if(bestEfforts.length !== (raw.bestEfforts || []).length) warnings.push('Invalid best-effort summaries excluded.');
    return {
        id: String(raw.id), externalId: raw.externalId ?? raw.id, source: raw.source || 'manual',
        start: new Date(raw.start).toISOString(), day, timeZone,
        sport: raw.sport || 'cycling', indoor: raw.indoor ?? null,
        duration: raw.duration, movingTime: optional(raw.movingTime, 'moving time', warnings),
        distance: optional(raw.distance, 'distance', warnings),
        elevation: optional(raw.elevation, 'elevation', warnings),
        averagePower: avgPower, normalizedPower: power,
        averagePowerCalculation: {source: averagePowerSource, version: VERSION},
        averageHeartRateCalculation: {source: averageHeartRateSource, version: VERSION},
        normalizedPowerCalculation: {source: powerSource, version: VERSION,
            inputs: powerSource.startsWith('derived') ? {sampleSeconds: 1, samples: streams.power.length} :
                {normalizedPower: raw.normalizedPower ?? null, weightedPower: raw.weightedPower ?? null}},
        maximumPower: maxPower,
        maximumPowerCalculation: {source: sourceMaxPower != null ? 'source-summary' :
            maxPower != null ? 'derived-observed-stream-maximum' : 'unavailable', version: VERSION},
        averageHeartRate: hr, maximumHeartRate: maxHR,
        maximumHeartRateCalculation: {source: sourceMaxHR != null ? 'source-summary' :
            maxHR != null ? 'derived-observed-stream-maximum' : 'unavailable', version: VERSION},
        averageCadence: optional(raw.averageCadence, 'cadence', warnings, 0, 300),
        workKj: sourceWork ?? derivedWork,
        workCalculation: sourceWork != null ? {value: sourceWork, source: 'source', version: VERSION} :
            metric(derivedWork, 'low', 'Integrated available one-second power, otherwise average power x elapsed seconds / 1000.'),
        ftp, intensityFactor: intensity,
        rpe, feedback, streams,
        bestEfforts,
        hasPower: !!streams.power || power != null || avgPower != null,
        hasHeartRate: !!streams.heartRate || hr != null,
        hasPowerStream: !!streams.power, hasHeartRateStream: !!streams.heartRate,
        hasIntervals: raw.hasIntervals === true,
        dataLevel: level, loadMetrics, warnings, version: VERSION,
        rawReference: raw.rawReference ?? null, original: {...raw},
        streamAveragePower: metric(streams.power ? mean(streams.power) : null, 'medium',
            'Mean of available one-second power samples; never substituted for normalized power.'),
    };
}

export function fromRecordedRide(db, id, timestamp) {
    const records = db.records || [];
    const start = db.events?.[0]?.timestamp ?? records[0]?.timestamp ?? timestamp - db.elapsed * 1000;
    // Recorded timestamps are milliseconds. Gaps invalidate a continuous stream.
    const contiguous = records.length > 1 && records.every((r, i) =>
        i === 0 || Math.abs(r.timestamp - records[i - 1].timestamp - 1000) <= 100);
    const complete = key => contiguous && records.every(r => Number.isFinite(r[key]));
    return {
        id, source: 'auuki', start: new Date(start).toISOString(),
        duration: db.elapsed, ftp: db.ftp, indoor: true,
        averagePower: db.powerAvg, averageHeartRate: db.heartRateAvg || null,
        maximumHeartRate: db.heartRateMax || null,
        streams: {
            power: complete('power') ? records.map(r => r.power) : undefined,
            heartRate: complete('heart_rate') && records.every(r => r.heart_rate > 0)
                ? records.map(r => r.heart_rate) : undefined,
        },
    };
}
