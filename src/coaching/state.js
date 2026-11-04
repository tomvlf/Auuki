/*
 * state.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * models training load, planning logic, and adaptation rules used to generate and explain workouts.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { DEFAULTS, VERSION, addDays, sum, mean, metric, positive, round, validateProfile } from './domain.js';

export const POWER_DURATIONS = [5, 15, 30, 60, 180, 300, 720, 1200, 1800, 2400, 3600];

export function estimateCriticalPower(efforts) {
    const valid = efforts.filter(e => e.maximal === true && e.seconds >= 120 && e.seconds <= 1200 &&
        positive(e.watts));
    const unavailable = reason => ({cp: null, wPrime: null, fitQuality: null, version: VERSION, reason});
    if(new Set(valid.map(e => e.seconds)).size < 3 ||
       Math.max(...valid.map(e => e.seconds)) / Math.min(...valid.map(e => e.seconds)) < 3) {
        return unavailable('Requires three explicitly maximal efforts spanning at least a 3:1 duration range (120-1200 s).');
    }
    const xs = valid.map(e => 1 / e.seconds);
    const ys = valid.map(e => e.watts);
    const mx = mean(xs), my = mean(ys);
    const slope = sum(xs.map((x, i) => (x - mx) * (ys[i] - my))) / sum(xs.map(x => (x - mx) ** 2));
    const cp = my - slope * mx;
    const residual = sum(xs.map((x, i) => (ys[i] - cp - slope * x) ** 2));
    const variance = sum(ys.map(y => (y - my) ** 2));
    const fitQuality = variance > 0 ? 1 - residual / variance : 0;
    if(!Number.isFinite(cp) || !Number.isFinite(slope) || !Number.isFinite(fitQuality) ||
       cp < 50 || cp > 600 || slope < 1000 || slope > 50000 || fitQuality < 0.95) {
        return unavailable('Fit rejected: implausible CP/W-prime or R-squared below 0.95.');
    }
    return {cp: round(cp), wPrime: round(slope), fitQuality, version: VERSION,
        reason: 'Two-parameter power = CP + W-prime / seconds least-squares fit; FTP remains separate.'};
}

export function powerDuration(activities, weight) {
    return POWER_DURATIONS.map(seconds => {
        let best = null;
        for(const activity of activities) {
            for(const e of activity.bestEfforts.filter(e => e.seconds === seconds)) {
                if(!best || e.watts > best.watts) best = {...e, date: activity.day, context: 'unknown'};
            }
            const stream = activity.streams.power || [];
            let total = 0;
            for(let i = 0; i < stream.length; i++) {
                total += stream[i];
                if(i >= seconds) total -= stream[i - seconds];
                if(i >= seconds - 1 && (!best || total / seconds > best.watts)) {
                    best = {watts: total / seconds, date: activity.day,
                        context: i - seconds + 1 >= 3600 ? 'after-60-minutes' : 'early',
                        maximal: false};
                }
            }
        }
        return {seconds, watts: best?.watts ?? null, wKg: best ? best.watts / weight : null,
            date: best?.date ?? null, context: best?.context ?? 'unknown',
            reason: best ? 'Best observed value; not necessarily a maximal effort.' : 'No suitable stream or reliable best-effort summary.',
            confidence: best ? 'medium' : 'unavailable'};
    });
}

export function intensityDistribution(activities, profile, config = DEFAULTS) {
    function distribution(key, reference, thresholds, threeCuts) {
        const zones = Array(thresholds.length + 1).fill(0);
        const three = [0, 0, 0];
        for(const a of activities) {
            for(const v of a.streams[key] || []) {
                if(!positive(reference)) continue;
                const ratio = v / reference;
                zones[thresholds.findIndex(t => ratio <= t) < 0 ? thresholds.length :
                    thresholds.findIndex(t => ratio <= t)]++;
                three[ratio <= threeCuts[0] ? 0 : ratio <= threeCuts[1] ? 1 : 2]++;
            }
        }
        return {seconds: zones, threeZoneSeconds: three, reference: reference ?? null,
            thresholds, version: VERSION, confidence: sum(zones) ? 'medium' : 'unavailable'};
    }
    return {
        power: distribution('power', profile.ftp, config.powerZones, [0.75, 1.05]),
        heartRate: distribution('heartRate', profile.maxHeartRate, config.heartRateZones, [0.7, 0.9]),
    };
}

export function estimateDurability(activities) {
    const observations = [];
    for(const a of activities) {
        const p = a.streams.power, h = a.streams.heartRate;
        if(!p || !h || p.length < 3600 || h.length !== p.length || !positive(a.ftp)) continue;
        const samples = p.slice(600);
        const avg = mean(samples);
        const cv = Math.sqrt(mean(samples.map(v => (v - avg) ** 2))) / avg;
        if(avg < a.ftp * 0.5 || avg > a.ftp * 0.75 || cv > 0.1 ||
           h.some(v => v < 40)) continue;
        const mid = 600 + Math.floor(samples.length / 2);
        const earlyPower = mean(p.slice(600, mid)), latePower = mean(p.slice(mid));
        const earlyHR = mean(h.slice(600, mid)), lateHR = mean(h.slice(mid));
        observations.push({date: a.day, powerFade: (earlyPower - latePower) / earlyPower,
            decoupling: 1 - (latePower / lateHR) / (earlyPower / earlyHR)});
    }
    return metric(observations.length ? observations : null, 'low',
        'Only >=60 min paired streams, after 10 min warm-up, 50-75% FTP and power CV <=10%; no diagnosis.');
}

export function estimateState(activities, profile, asOf, options = {}, outcomes = []) {
    validateProfile(profile);
    const config = {...DEFAULTS, ...options};
    for(const key of ['shortDays', 'mediumDays', 'longDays', 'chronicDays', 'acuteDays']) {
        if(!Number.isInteger(config[key]) || config[key] < 1 || config[key] > 730) throw new Error(`Invalid ${key}.`);
    }
    if(config.shortDays > config.mediumDays || config.mediumDays > config.longDays) throw new Error('Historical windows must be ordered short <= medium <= long.');
    for(const key of ['powerZones', 'heartRateZones']) {
        if(!Array.isArray(config[key]) || !config[key].length ||
           config[key].some((v, i) => !positive(v) || (i > 0 && v <= config[key][i - 1]))) {
            throw new Error('Zone thresholds must be positive and strictly increasing.');
        }
    }
    const history = activities.filter(a => a.sport === 'cycling' && a.day <= asOf &&
        a.day > addDays(asOf, -config.longDays));
    const recent = history.filter(a => a.day > addDays(asOf, -config.mediumDays));
    // One scale for the entire snapshot, never add TSS to RPE or HR units.
    const loadSource = recent.length && recent.every(a => a.loadMetrics.power.value != null) ? 'power'
        : recent.length && recent.every(a => a.loadMetrics.sessionRpe.value != null) ? 'sessionRpe'
            : recent.length && recent.every(a => a.loadMetrics.heartRate.value != null) ? 'heartRate' : 'duration';
    const loadOf = a => loadSource === 'duration' ? a.duration / 60 : a.loadMetrics[loadSource].value;
    const daily = [];
    let chronic = 0, acute = 0, previousChronic = 0;
    for(let i = config.longDays - 1; i >= 0; i--) {
        const day = addDays(asOf, -i);
        const rides = history.filter(a => a.day === day);
        const values = rides.map(loadOf);
        const load = sum(values.filter(v => v != null));
        chronic += (load - chronic) * (1 - Math.exp(-1 / config.chronicDays));
        acute += (load - acute) * (1 - Math.exp(-1 / config.acuteDays));
        if(i === 7) previousChronic = chronic;
        daily.push({day, load, duration: sum(rides.map(a => a.duration)), incomplete: values.some(v => v == null)});
    }
    const week = daily.slice(-7);
    const loads = week.map(d => d.load);
    const average = mean(loads);
    const deviation = Math.sqrt(mean(loads.map(l => (l - average) ** 2)));
    const monotony = deviation > 0 ? average / deviation : null;
    const recentOutcomes = outcomes.filter(o => o.date <= asOf && o.date > addDays(asOf, -config.mediumDays));
    const completed = recentOutcomes.filter(o => ['completed', 'substituted'].includes(o.status));
    const feedback = history.filter(a => a.day > addDays(asOf, -3));
    const concerns = feedback.flatMap(a => [
        a.rpe >= 9 ? 'High recent perceived exertion.' : null,
        a.feedback.sleepQuality != null && a.feedback.sleepQuality <= 2 ? 'Low reported sleep quality.' : null,
        a.feedback.legFreshness != null && a.feedback.legFreshness <= 2 ? 'Low reported leg freshness.' : null,
        a.feedback.muscleSoreness >= 4 ? 'High reported soreness.' : null,
        a.feedback.stress >= 4 ? 'High reported stress.' : null,
    ].filter(Boolean));
    const sufficient = recent.length >= 8 && recent.every(a => ['A', 'B'].includes(a.dataLevel));
    const confidence = sufficient ? 'medium' : 'low';
    const powerCurve = powerDuration(recent, profile.weight);
    const baseline = powerDuration(history, profile.weight);
    const cp = estimateCriticalPower(recent.flatMap(a => a.bestEfforts));
    const rpes = recent.filter(a => a.rpe != null).sort((a, b) => a.start.localeCompare(b.start));
    const half = Math.floor(rpes.length / 2);
    return {
        id: `${profile.id}:${asOf}:${VERSION}`, athleteId: profile.id, date: asOf, version: VERSION, config,
        profileInputs: JSON.parse(JSON.stringify(profile)),
        ftp: {...metric(profile.ftp ?? null, 'medium', 'Athlete-declared FTP, not inferred CP.'), source: 'athlete-profile'},
        wKg: metric(profile.ftp ? profile.ftp / profile.weight : null, 'medium', 'Declared FTP / body mass.'),
        criticalPower: cp, maximumAerobicPower: metric(null, 'unavailable', 'No validated MAP protocol supplied.'),
        powerDuration: powerCurve, baselinePowerDuration: baseline,
        performanceComparison: 'Missing maximal efforts are not evidence of performance decline.',
        weeklyDuration: history.length ? sum(week.map(d => d.duration)) / 60 : null,
        baselineWeeklyMinutes: sum(recent.map(a => a.duration)) / 60 / (config.mediumDays / 7),
        weeklyLoad: history.length ? sum(loads) : null,
        chronicLoad: history.length ? chronic : null, acuteLoad: history.length ? acute : null,
        formBalance: history.length ? chronic - acute : null, rampRate: history.length ? chronic - previousChronic : null,
        rollingLoad: history.length ? sum(daily.map(d => d.load)) : null,
        shortWindowLoad: history.length ? sum(daily.slice(-config.shortDays).map(d => d.load)) : null,
        dailyLoad: daily, loadSource,
        loadConfidence: confidence,
        metricConfidence: Object.fromEntries(['weeklyDuration', 'weeklyLoad', 'chronicLoad', 'acuteLoad',
            'formBalance', 'rollingLoad', 'rampRate'].map(key => [key, history.length ? confidence : 'unavailable'])),
        loadExplanation: 'Modelled load indicators, not direct biological measurements; zero-initialized over the historical window.',
        monotony: metric(monotony, confidence, deviation > 0 ? 'Mean daily load / population standard deviation.'
            : 'Undefined: no variation in observed daily loads.'),
        strain: metric(monotony == null ? null : sum(loads) * monotony, confidence, 'Weekly load x monotony.'),
        intensityDistribution: intensityDistribution(recent, profile, config),
        durability: estimateDurability(recent),
        completionRate: metric(recentOutcomes.length ? completed.length / recentOutcomes.length : null,
            confidence, 'Completed or substituted / resolved workouts.'),
        workoutSuccessRate: metric(completed.length ? completed.filter(o => o.quality >= 0.8).length / completed.length : null,
            confidence, 'Completed workouts with quality >=0.8 / completed workouts.'),
        recentRpeTrend: metric(half ? mean(rpes.slice(half).map(a => a.rpe)) -
            mean(rpes.slice(0, half).map(a => a.rpe)) : null, 'low', 'Recent half minus earlier half mean RPE.'),
        readiness: {concerns: [...new Set(concerns)], status: concerns.length ? 'caution' : 'unknown',
            reason: concerns.length ? 'Subjective recovery concerns; reduce demands, no diagnosis.' : 'No concerns reported is not proof of readiness.'},
        sufficiency: sufficient ? 'supported' : recent.length ? 'limited' : 'insufficient',
        confidence, activityCount: history.length,
        warnings: ['Load models use supplied history only; missing imports are not proof of rest.',
            ...new Set(history.flatMap(a => a.warnings)),
            ...(daily.some(d => d.incomplete) ? ['Some historical loads unavailable on the chosen scale.'] : [])],
    };
}
