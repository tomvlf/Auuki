/*
 * activity-types.js: maps provider activity types to Athlima sport categories.
 *
 * Intervals.icu (and Strava) use detailed type names such as GravelRide or TrailRun.
 * Coaching only plans cycling, so every type is reduced to a broad sport category
 * while the original type is kept for labels and icons.
 */

const categories = {
    cycling: ['Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide',
        'TrackRide', 'Cyclocross', 'Handcycle', 'Velomobile'],
    running: ['Run', 'VirtualRun', 'TrailRun'],
    swimming: ['Swim', 'OpenWaterSwim'],
    walking: ['Walk', 'Wheelchair'],
    hiking: ['Hike', 'Snowshoe', 'RockClimbing'],
    strength: ['WeightTraining', 'Crossfit', 'HighIntensityIntervalTraining', 'Workout', 'Elliptical', 'StairStepper'],
    mobility: ['Yoga', 'Pilates'],
    rowing: ['Rowing', 'VirtualRow', 'Canoeing', 'Kayaking', 'StandUpPaddling'],
    winter: ['AlpineSki', 'BackcountrySki', 'NordicSki', 'RollerSki', 'VirtualSki', 'Snowboard', 'IceSkate'],
    skating: ['InlineSkate', 'Skateboard'],
    water: ['Kitesurf', 'Sail', 'Surfing', 'Windsurf', 'WaterSport'],
    racket: ['Badminton', 'Padel', 'Pickleball', 'Racquetball', 'Squash', 'TableTennis', 'Tennis'],
    team: ['Hockey', 'Rugby', 'Soccer', 'Golf'],
};

const sportByType = new Map(Object.entries(categories)
    .flatMap(([sport, types]) => types.map(type => [type, sport])));

const sportLabels = {
    cycling: 'Ride', running: 'Run', swimming: 'Swim', walking: 'Walk', hiking: 'Hike',
    strength: 'Strength', mobility: 'Mobility', rowing: 'Paddle', winter: 'Winter sport',
    skating: 'Skate', water: 'Water sport', racket: 'Racket sport', team: 'Team sport', other: 'Activity',
};

const typeLabels = {
    EBikeRide: 'E-bike ride', EMountainBikeRide: 'E-MTB ride', MountainBikeRide: 'MTB ride',
    VirtualRide: 'Virtual ride', VirtualRun: 'Virtual run', VirtualRow: 'Virtual row', VirtualSki: 'Virtual ski',
    WeightTraining: 'Weight training', HighIntensityIntervalTraining: 'HIIT', StandUpPaddling: 'SUP',
    OpenWaterSwim: 'Open water swim', TableTennis: 'Table tennis', StairStepper: 'Stair stepper',
};

/** Returns the Athlima sport category for a provider activity type. */
export function sportForType(type) {
    return sportByType.get(type) || 'other';
}

/** Returns a readable label, e.g. "Gravel ride" for GravelRide. */
export function activityTypeLabel(type, sport) {
    if(typeof type === 'string' && type) {
        if(typeLabels[type]) return typeLabels[type];
        const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
        return words[0].toUpperCase() + words.slice(1);
    }
    return sportLabels[sport] || sportLabels.other;
}

export const sports = Object.keys(sportLabels);
