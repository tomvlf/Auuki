import { cadenceSummary, escape, minutes, number, profileGraph } from './format.js';

export const initialLibraryFilters = () => ({
    search: '', category: '', type: 'all', duration: 'all', sort: 'original',
});

const workoutType = workout => Array.isArray(workout.points) ? 'course' : 'workout';
const hasMetric = value => Number.isFinite(value) && value > 0;

function compareMetric(left, right, key, descending = false) {
    const a = left.meta[key], b = right.meta[key];
    if(!hasMetric(a)) return hasMetric(b) ? 1 : 0;
    if(!hasMetric(b)) return -1;
    return descending ? b - a : a - b;
}

export function filterWorkouts(workouts, filters) {
    const query = filters.search.toLowerCase();
    const filtered = workouts.filter(workout => {
        const {name, category, duration} = workout.meta;
        if(!`${name} ${category || ''}`.toLowerCase().includes(query)) return false;
        if(filters.category && category !== filters.category) return false;
        if(filters.type !== 'all' && workoutType(workout) !== filters.type) return false;
        if(filters.duration !== 'all') {
            if(!hasMetric(duration)) return false;
            if(filters.duration === 'short' && duration > 1800) return false;
            if(filters.duration === 'medium' && (duration <= 1800 || duration > 3600)) return false;
            if(filters.duration === 'long' && duration <= 3600) return false;
        }
        return true;
    });

    if(filters.sort === 'name') filtered.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    if(filters.sort === 'duration') filtered.sort((a, b) => compareMetric(a, b, 'duration'));
    if(filters.sort === 'distance') filtered.sort((a, b) => compareMetric(a, b, 'distance', true));
    return filtered;
}

const option = (value, label, selected) =>
    `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`;

function workoutCard(workout) {
    const {name, category, duration, distance} = workout.meta;
    const type = workoutType(workout) === 'course' ? 'Course' : 'Workout';
    const metrics = [];
    if(hasMetric(duration)) metrics.push(['Duration', minutes(duration)]);
    if(hasMetric(distance)) metrics.push(['Distance', `${number(distance / 1000, 1)} km`]);
    if(workout.intervals?.length) metrics.push(['Intervals', number(workout.intervals.length)]);
    if(type === 'Workout') metrics.push(['Cadence', cadenceSummary((workout.intervals || []).flatMap(interval => interval.steps || []))]);
    metrics.push(['Type', type]);

    return `<article class="workout-card">
        <div class="workout-card-content">
            <h2><a class="workout-card-link" href="#/workout/${escape(encodeURIComponent(workout.id))}"
                aria-label="View workout: ${escape(name)}">${escape(name)}</a></h2>
            <p class="workout-card-category">${escape(category || type)}</p>
            <dl class="workout-card-metrics">${metrics.map(([label, value]) =>
                `<div><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
        </div>
        <div class="workout-card-profile">${profileGraph(workout)}</div>
    </article>`;
}

export function renderLibrary(workouts, filters) {
    const filtered = filterWorkouts(workouts, filters);
    const categories = [...new Set(workouts.map(workout => workout.meta.category)
        .filter(category => typeof category === 'string' && category.trim()))].sort((a, b) => a.localeCompare(b));
    const results = filtered.length ? filtered.map(workoutCard).join('') :
        `<div class="library-empty">${workouts.length ? 'No workouts match your search.' :
            'Your workout library is empty. Import a workout to get started.'}</div>`;

    return `<section class="library">
        <div class="library-toolbar">
            <p class="library-count" role="status" aria-live="polite" aria-atomic="true">Showing ${filtered.length} of ${workouts.length} ${workouts.length === 1 ? 'workout' : 'workouts'}</p>
            <div class="library-actions">
                <label class="button secondary library-import">Import .ZWO / .FIT course<input type="file" id="platform-upload" accept=".zwo,.fit" multiple></label>
                <a class="button secondary" href="#/editor">Workout editor</a>
            </div>
        </div>
        <div class="library-layout">
            <aside class="panel library-filters" aria-labelledby="library-filters-heading">
                <p class="eyebrow">Explore your library</p>
                <h2 id="library-filters-heading">Find a workout</h2>
                <div class="library-filter-fields">
                    <label class="library-keywords">Keywords<input type="search" id="workout-search" aria-controls="library-results" placeholder="Name or category" value="${escape(filters.search)}"></label>
                    <label>Category<select id="workout-category" aria-controls="library-results">
                        ${option('', 'All categories', filters.category)}${categories.map(category => option(category, category, filters.category)).join('')}
                    </select></label>
                    <label>Type<select id="workout-type" aria-controls="library-results">
                        ${option('all', 'All types', filters.type)}${option('workout', 'Workouts', filters.type)}${option('course', 'Courses', filters.type)}
                    </select></label>
                    <label>Duration<select id="workout-duration" aria-controls="library-results">
                        ${option('all', 'Any duration', filters.duration)}${option('short', '30 min or less', filters.duration)}
                        ${option('medium', 'Over 30 to 60 min', filters.duration)}${option('long', 'Over 60 min', filters.duration)}
                    </select></label>
                    <label>Sort by<select id="workout-sort" aria-controls="library-results">
                        ${option('original', 'Library order', filters.sort)}${option('name', 'Name A-Z', filters.sort)}
                        ${option('duration', 'Shortest duration', filters.sort)}${option('distance', 'Longest distance', filters.sort)}
                    </select></label>
                </div>
                <button class="secondary library-reset" type="button" data-library-reset>Clear filters</button>
            </aside>
            <div class="library-results" id="library-results"><div class="workout-grid">${results}</div></div>
        </div>
    </section>`;
}
