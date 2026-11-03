import { VERSION, localDay, validateProfile, date } from './domain.js';
import { normalizeActivity } from './normalizer.js';
import { estimateState } from './state.js';
import { generatePlan } from './planner.js';
import { matchWorkout, adaptPlan } from './adaptation.js';
import { openCoachingStorage } from './storage.js';
import { ServerCoachingService, SERVER_MODE_KEY, serverEnabled, serverAccount } from '../server/client.js';

const KEY = 'auuki-coaching-v1';
const empty = () => ({version: VERSION, profile: null, goal: null, activities: [],
    snapshots: [], revisions: [], plan: null});

export class CoachingService {
    constructor(storage, clock = () => new Date().toISOString()) {
        this.storage = storage;
        this.clock = clock;
        const stored = storage.getItem(KEY);
        this.data = stored ? JSON.parse(stored) : empty();
        if(this.data.version !== VERSION || !Array.isArray(this.data.activities) ||
           !Array.isArray(this.data.snapshots) || !Array.isArray(this.data.revisions)) {
            throw new Error('Unsupported or corrupt coaching storage; export or repair it before continuing.');
        }
    }
    async commit(next) {
        // A single atomic storage write: failure leaves the prior in-memory revision intact.
        if(this.saving) throw new Error('Another coaching update is saving; retry when it finishes.');
        this.saving = true;
        try {
            await this.storage.setItem(KEY, JSON.stringify(next));
            this.data = next;
            return next;
        } finally {
            this.saving = false;
        }
    }
    async configure(profile, goal) {
        validateProfile(profile);
        if(this.data.plan?.status === 'active') throw new Error('Finish or archive the current plan before changing profile or goal.');
        if(this.data.activities.length && this.data.profile.id !== profile.id) throw new Error('Existing coaching history belongs to a different athlete.');
        return this.commit({...this.data, profile: JSON.parse(JSON.stringify(profile)),
            goal: JSON.parse(JSON.stringify(goal))});
    }
    snapshot(data, asOf, outcome = null) {
        const outcomes = data.plan?.workouts.filter(w => w.status !== 'scheduled').map(w =>
            ({date: w.date, status: w.status, quality: w.completionQuality})) || [];
        if(outcome) outcomes.push(outcome);
        const state = estimateState(data.activities, data.profile, asOf, {}, outcomes);
        state.id += `:${data.snapshots.length + 1}`;
        data.snapshots.push(state);
        return state;
    }
    async generate(startDate) {
        const next = JSON.parse(JSON.stringify(this.data));
        if(!next.profile || !next.goal) throw new Error('Configure an athlete and dated goal first.');
        if(next.plan?.status === 'active') throw new Error('Archive the current plan before generating another.');
        const state = this.snapshot(next, date(startDate));
        next.plan = generatePlan({profile: next.profile, goal: next.goal, state,
            startDate, generatedAt: this.clock()});
        next.revisions.push(JSON.parse(JSON.stringify(next.plan)));
        return (await this.commit(next)).plan;
    }
    async archive() {
        if(!this.data.plan) throw new Error('No plan to archive.');
        const next = JSON.parse(JSON.stringify(this.data));
        next.plan.status = 'archived';
        next.revisions.push(JSON.parse(JSON.stringify(next.plan)));
        return this.commit(next);
    }
    async importActivities(rawActivities) {
        if(!this.data.profile) throw new Error('Configure a profile before importing rides.');
        if(!Array.isArray(rawActivities)) throw new Error('Activity import must be a JSON array.');
        // Validate the entire batch before committing any of it.
        const normalized = rawActivities.map(raw => normalizeActivity(raw, this.data.profile));
        const next = JSON.parse(JSON.stringify(this.data));
        const added = [];
        for(const activity of normalized) {
            if(next.activities.some(a => a.id === activity.id)) continue;
            next.activities.push(activity);
            added.push(activity);
        }
        if(next.plan?.status === 'active') {
            const today = localDay(this.clock(), next.profile.timeZone);
            if(today >= next.plan.startDate && today <= next.plan.endDate) {
                for(const activity of added.filter(a => a.day <= today && a.day >= next.plan.startDate)) {
                    this.applyActivity(next, activity, today);
                }
            }
        }
        return this.commit(next);
    }
    applyActivity(next, activity, asOf, explicitId = null) {
        if(activity.sport !== 'cycling' || activity.day > asOf || activity.day < next.plan.startDate) return;
        const match = matchWorkout(activity, next.plan.workouts, explicitId);
        const state = this.snapshot(next, asOf, match.workoutId
            ? {date: activity.day, status: 'completed', quality: match.quality} : null);
        next.plan = adaptPlan({plan: next.plan, profile: next.profile, state,
            trigger: match.workoutId ? 'completed' : 'unplanned', date: asOf,
            timestamp: this.clock(), workoutId: match.workoutId, activity,
            match: match.workoutId ? match : null});
        next.revisions.push(JSON.parse(JSON.stringify(next.plan)));
    }
    async recordRide(raw, explicitId = null) {
        if(!this.data.profile) return null; // Coaching is opt-in.
        if(this.data.activities.some(a => a.id === String(raw.id))) return this.data.plan;
        const activity = normalizeActivity(raw, this.data.profile);
        const next = JSON.parse(JSON.stringify(this.data));
        next.activities.push(activity);
        if(next.plan?.status === 'active') {
            const asOf = localDay(this.clock(), next.profile.timeZone);
            if(asOf >= next.plan.startDate && asOf <= next.plan.endDate) this.applyActivity(next, activity, asOf, explicitId);
        }
        await this.commit(next);
        return next.plan;
    }
    async resolve({workoutId = null, trigger, activityId = null, feedback = null, asOf}) {
        const next = JSON.parse(JSON.stringify(this.data));
        if(!next.plan || next.plan.status !== 'active') throw new Error('No active plan to adapt.');
        const today = date(asOf || localDay(this.clock(), next.profile.timeZone));
        const activity = activityId ? next.activities.find(a => a.id === activityId) : null;
        if(activityId && !activity) throw new Error('Activity not found.');
        if(activity && next.plan.workouts.some(w => w.matchedActivity === activity.id)) {
            throw new Error('This activity is already matched to a workout.');
        }
        if(feedback) {
            if(!activity) throw new Error('Feedback requires an activity.');
            const updated = normalizeActivity({...activity.original, id: activity.id, streams: activity.streams,
                rpe: feedback.rpe ?? activity.rpe, feedback: {...activity.feedback, ...feedback}}, next.profile);
            Object.assign(activity, updated);
        }
        const workout = next.plan.workouts.find(w => w.id === workoutId);
        if(activity && workout && activity.day !== workout.date) throw new Error('Substitution must occur on the scheduled local date.');
        const match = activity && workout ? {workoutId, confidence: 1,
            quality: Math.min(activity.duration, workout.duration) / Math.max(activity.duration, workout.duration),
            reason: 'Rider-confirmed substitution; duration quality, interval fidelity unknown.'} : null;
        const state = this.snapshot(next, today, workout
            ? {date: workout.date, status: trigger, quality: match?.quality} : null);
        next.plan = adaptPlan({plan: next.plan, profile: next.profile, state, trigger, date: today,
            timestamp: this.clock(), workoutId, activity, match});
        next.revisions.push(JSON.parse(JSON.stringify(next.plan)));
        return (await this.commit(next)).plan;
    }
    async updateFeedback(activityId, feedback, asOf) {
        const next = JSON.parse(JSON.stringify(this.data));
        const activity = next.activities.find(a => a.id === activityId);
        if(!activity) throw new Error('Activity not found.');
        const keys = ['rpe', 'legFreshness', 'sleepQuality', 'muscleSoreness', 'stress'];
        if(!Object.keys(feedback).length || Object.entries(feedback).some(([key, value]) =>
            !keys.includes(key) || !Number.isFinite(value) || value < (key === 'rpe' ? 0 : 1) ||
            value > (key === 'rpe' ? 10 : 5))) throw new Error('Supply RPE 0-10 or feedback ratings 1-5.');
        if(Object.entries(feedback).every(([key, value]) =>
            value === (key === 'rpe' ? activity.rpe : activity.feedback[key]))) return this.data;
        const updated = normalizeActivity({...activity.original, id: activity.id, streams: activity.streams,
            rpe: feedback.rpe ?? activity.rpe, feedback: {...activity.feedback, ...feedback}}, next.profile);
        Object.assign(activity, updated);
        if(next.plan?.status === 'active') {
            const today = date(asOf || localDay(this.clock(), next.profile.timeZone));
            const state = this.snapshot(next, today);
            next.plan = adaptPlan({plan: next.plan, profile: next.profile, state, trigger: 'feedback',
                date: today, timestamp: this.clock(), activity});
            next.revisions.push(JSON.parse(JSON.stringify(next.plan)));
        }
        return this.commit(next);
    }
    async advance(asOf) {
        if(this.data.plan?.status !== 'active') return this.data.plan;
        const today = date(asOf || localDay(this.clock(), this.data.profile.timeZone));
        const due = this.data.plan.workouts.filter(w => w.status === 'scheduled' && w.date < today);
        // Resolve overdue sessions in one persistent transaction, with one revision per outcome.
        const next = JSON.parse(JSON.stringify(this.data));
        for(const workout of due) {
            const day = today > next.plan.endDate ? next.plan.endDate : today;
            const state = this.snapshot(next, day, {date: workout.date, status: 'missed', quality: null});
            next.plan = adaptPlan({plan: next.plan, profile: next.profile, state,
                trigger: 'missed', date: day, timestamp: this.clock(), workoutId: workout.id});
            next.revisions.push(JSON.parse(JSON.stringify(next.plan)));
        }
        if(today >= next.plan.endDate) next.plan.status = 'finished';
        await this.commit(next);
        return next.plan;
    }
}

let instance;
let localInstance;
let modeRevision = 0;
export async function initializeCoaching(indexedDB = window.indexedDB) {
    if(!instance) {
        const revision = modeRevision;
        let loaded;
        if(serverEnabled()) loaded = await ServerCoachingService.open();
        else {
            localInstance = localInstance || new CoachingService(await openCoachingStorage(indexedDB));
            loaded = localInstance;
        }
        // A slow startup request must not undo an explicit mode switch.
        if(revision === modeRevision) {
            instance = loaded;
            serverAccount.email = loaded instanceof ServerCoachingService ? loaded.email : null;
        }
    }
    return instance;
}
export async function useServerCoaching() {
    const remote = await ServerCoachingService.open();
    await remote.advance();
    window.localStorage.setItem(SERVER_MODE_KEY, '1');
    modeRevision++;
    instance = remote;
    serverAccount.email = remote.email;
    return remote;
}
export async function useLocalCoaching() {
    localInstance = localInstance || new CoachingService(await openCoachingStorage(window.indexedDB));
    window.localStorage.removeItem(SERVER_MODE_KEY);
    modeRevision++;
    instance = localInstance;
    serverAccount.email = null;
    return instance;
}
export function coachingService() {
    if(!instance) throw new Error('Coaching history is not loaded yet. Reload if this message persists.');
    return instance;
}
export const coachingData = () => instance?.data ?? null;
