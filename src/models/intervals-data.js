import { sportForType } from '../coaching/activity-types.js';

const detailFields = {
    type: 'type', subType: 'sub_type', description: 'description', startLocal: 'start_date_local',
    timeZone: 'timezone', provider: 'source', deviceName: 'device_name', powerMeter: 'power_meter',
    gear: 'gear', tags: 'tags', commute: 'commute', race: 'race', trainer: 'trainer', analyzed: 'analyzed',
    elapsedTime: 'elapsed_time', movingTime: 'moving_time', recordingTime: 'icu_recording_time',
    coastingTime: 'coasting_time', warmupTime: 'icu_warmup_time', cooldownTime: 'icu_cooldown_time',
    distance: 'distance', averageSpeed: 'average_speed', maxSpeed: 'max_speed', pace: 'pace', gap: 'gap',
    elevationGain: 'total_elevation_gain', elevationLoss: 'total_elevation_loss',
    averageAltitude: 'average_altitude', minAltitude: 'min_altitude', maxAltitude: 'max_altitude',
    averagePower: 'icu_average_watts', normalizedPower: 'icu_weighted_avg_watts', ftp: 'icu_ftp',
    intensity: 'icu_intensity', variabilityIndex: 'icu_variability_index',
    efficiencyFactor: 'icu_efficiency_factor', powerHr: 'icu_power_hr', decoupling: 'decoupling',
    work: 'icu_joules', workAboveFtp: 'icu_joules_above_ftp', wPrime: 'icu_w_prime',
    maxWbalDepletion: 'icu_max_wbal_depletion', lrBalance: 'avg_lr_balance', crankLength: 'crank_length',
    rollingFtp: 'icu_rolling_ftp', estimatedCp: 'icu_pm_cp', estimatedFtp: 'icu_pm_ftp',
    averageHeartRate: 'average_heartrate', maxHeartRate: 'max_heartrate', lthr: 'lthr',
    restingHeartRate: 'icu_resting_hr', athleteMaxHeartRate: 'athlete_max_hr', hrRecovery: 'icu_hrr',
    averageCadence: 'average_cadence', averageStride: 'average_stride',
    trainingLoad: 'icu_training_load', powerLoad: 'power_load', hrLoad: 'hr_load', paceLoad: 'pace_load',
    hrLoadType: 'hr_load_type', trimp: 'trimp', strainScore: 'strain_score',
    fitness: 'icu_ctl', fatigue: 'icu_atl', polarizationIndex: 'polarization_index',
    rpe: 'icu_rpe', perceivedExertion: 'perceived_exertion', sessionRpe: 'session_rpe', feel: 'feel',
    powerZoneTimes: 'icu_zone_times', heartRateZoneTimes: 'icu_hr_zone_times', paceZoneTimes: 'pace_zone_times',
    powerZones: 'icu_power_zones', heartRateZones: 'icu_hr_zones',
    calories: 'calories', carbsUsed: 'carbs_used', carbsIngested: 'carbs_ingested', weight: 'icu_weight',
    averageTemp: 'average_temp', minTemp: 'min_temp', maxTemp: 'max_temp',
    weatherTemp: 'average_weather_temp', feelsLike: 'average_feels_like', windSpeed: 'average_wind_speed',
    windGust: 'average_wind_gust', windDirection: 'prevailing_wind_deg', headwindPercent: 'headwind_percent',
    tailwindPercent: 'tailwind_percent', clouds: 'average_clouds', rain: 'max_rain', snow: 'max_snow',
    lapCount: 'icu_lap_count', intervalSummary: 'interval_summary', streamTypes: 'stream_types',
    lengths: 'lengths', poolLength: 'pool_length', kgLifted: 'kg_lifted', compliance: 'compliance',
    pairedEventId: 'paired_event_id', stravaId: 'strava_id',
};

function detailValue(value) {
    if(typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if(typeof value === 'boolean') return value;
    if(typeof value === 'string') return value ? value.slice(0, 2000) : undefined;
    if(Array.isArray(value)) {
        const items = value.slice(0, 60).map(item => item && typeof item === 'object'
            ? Object.fromEntries(Object.entries(item).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))
                .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]))
            : detailValue(item)).filter(item => item !== undefined);
        return items.length ? items : undefined;
    }
    if(value && typeof value === 'object') {
        const entries = Object.entries(value).filter(([, v]) => ['number', 'string', 'boolean'].includes(typeof v))
            .map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 200) : v]);
        return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return undefined;
}

function validTimeZone(zone) {
    if(typeof zone !== 'string' || !zone) return null;
    try { new Intl.DateTimeFormat('en', {timeZone: zone}); return zone; } catch { return null; }
}

const finite = (value, min = 0, max = Infinity) =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : null;

export function intervalsActivity(activity, syncedAt) {
    const type = typeof activity.type === 'string' && activity.type ? activity.type : 'Other';
    const duration = finite(activity.moving_time, 1) ?? finite(activity.elapsed_time, 1);
    if(!activity.id || !activity.start_date || !duration) return null;
    const legacyId = /^(?:athlima|auuki):([\w-]{1,100})$/.exec(activity.external_id || '');
    const details = {};
    for(const [key, field] of Object.entries(detailFields)) {
        const value = detailValue(field === 'gear' ? activity.gear?.name : activity[field]);
        if(value !== undefined) details[key] = value;
    }
    const joules = finite(activity.icu_joules);
    return {
        id: legacyId ? legacyId[1] : `intervals:${activity.id}`,
        externalId: String(activity.id), source: 'intervals', providerIds: {intervals: String(activity.id)},
        name: activity.name, start: activity.start_date, duration,
        movingTime: finite(activity.moving_time), elapsedTime: finite(activity.elapsed_time),
        distance: finite(activity.distance) ?? finite(activity.icu_distance),
        elevation: finite(activity.total_elevation_gain),
        sport: sportForType(type), activityType: type, timeZone: validTimeZone(activity.timezone) ?? undefined,
        indoor: activity.trainer === true || /^Virtual/.test(type),
        averagePower: activity.icu_average_watts ?? activity.average_watts,
        normalizedPower: activity.icu_weighted_avg_watts, ftp: activity.icu_ftp,
        averageHeartRate: activity.average_heartrate, maximumHeartRate: activity.max_heartrate,
        averageCadence: activity.average_cadence,
        workKj: joules == null ? null : joules / 1000,
        rpe: finite(activity.icu_rpe, 0, 10) ?? finite(activity.perceived_exertion, 0, 10),
        hasIntervals: Array.isArray(activity.interval_summary) && activity.interval_summary.length > 0,
        details, rawReference: String(activity.id), syncedAt,
    };
}

export function compactProfile(values, buckets = 120) {
    if(!Array.isArray(values)) return null;
    const count = Math.min(buckets, values.length);
    const profile = [];
    for(let index = 0; index < count; index++) {
        const slice = values.slice(Math.floor(index * values.length / count),
            Math.max(Math.floor(index * values.length / count) + 1, Math.floor((index + 1) * values.length / count)))
            .filter(value => typeof value === 'number' && Number.isFinite(value) && value >= 0);
        if(slice.length) profile.push(Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length));
    }
    return profile.length >= 2 ? profile : null;
}
