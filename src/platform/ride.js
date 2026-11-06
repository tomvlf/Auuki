import { time } from './format.js';

export function rideTimeline(workout, ftp, toAbsolute) {
    let duration = 0;
    const intervals = [];
    for(const interval of workout?.intervals || []) {
        const start = duration;
        const steps = [];
        for(const step of interval.steps || []) {
            if(!Number.isFinite(step.duration) || step.duration <= 0) return null;
            const target = Number.isFinite(step.power) ? toAbsolute(step.power, ftp) : null;
            const power = Number.isFinite(target) ? target : null;
            steps.push({...step, power, start: duration});
            duration += step.duration;
        }
        intervals.push({start, duration: duration - start, steps});
    }
    if(!duration) return null;
    const peak = intervals.reduce((max, interval) =>
        interval.steps.reduce((value, step) => Math.max(value, step.power || 0), max), 0);
    const threshold = Number.isFinite(ftp) && ftp > 0 ? ftp : null;
    return {duration, intervals, ftp: threshold, maximumPower: Math.ceil(Math.max(threshold || 0, peak, 50) / 50) * 50};
}

export function ridePosition(timeline, {intervalIndex = 0, lapTime, workoutStatus}) {
    if(!timeline) return 0;
    if(workoutStatus === 'done') return timeline.duration;
    if(workoutStatus !== 'started') return 0;
    const interval = timeline.intervals[intervalIndex];
    if(!interval) return timeline.duration;
    const left = Number.isFinite(lapTime) ? lapTime : interval.duration;
    return interval.start + Math.max(0, Math.min(interval.duration, interval.duration - left));
}

export function rideProfile(timeline) {
    if(!timeline) return '<p class="muted">No timed power profile for this ride. Ride at your own pace.</p>';
    const {duration, intervals, maximumPower} = timeline;
    const bars = intervals.flatMap(interval => interval.steps.map(step => {
        const height = step.power == null ? 3 : Math.max(3, step.power / maximumPower * 180);
        const share = (step.power || 0) / (timeline.ftp || maximumPower);
        const color = share > 1.05 ? '#f5ad65' : share > 0.75 ? '#9a99ff' : '#52d9b2';
        return `<rect x="${step.start / duration * 1000}" y="${180 - height}"
            width="${step.duration / duration * 1000}" height="${height}" fill="${color}">
            <title>${time(step.start)} / ${step.power == null ? 'No power target' : `${step.power} W`}${step.cadence > 0 ? ` / ${step.cadence} rpm` : ''}</title></rect>`;
    })).join('');
    return `<div class="ride-profile-axis" aria-hidden="true"><span>${maximumPower} W</span><span>${maximumPower / 2} W</span><span>0 W</span></div>
        <div class="ride-profile-plot">
            <svg viewBox="0 0 1000 180" preserveAspectRatio="none" aria-hidden="true">
                <line class="ride-profile-grid" x1="0" x2="1000" y1="90" y2="90"/>
                ${bars}
                <rect id="ride-profile-active" class="ride-profile-active" x="0" y="0" width="0" height="180"/>
                <rect id="ride-profile-completed" class="ride-profile-completed" x="0" y="0" width="0" height="180"/>
            </svg>
            <div id="ride-profile-cursor" class="ride-profile-cursor" style="left:0%"><span>Now</span></div>
            <div class="ride-profile-times" aria-hidden="true">${[0, .25, .5, .75, 1]
                .map(share => `<span>${time(duration * share)}</span>`).join('')}</div>
        </div>`;
}
