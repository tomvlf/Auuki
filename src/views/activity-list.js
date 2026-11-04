/*
 * activity-list.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * renders the screen, controls, and UI panels that let a rider interact with the app.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf, formatDate, } from '../functions.js';
import { models } from '../models/models.js';
import { formatTime, } from '../utils.js';
import { coachingData } from '../coaching/service.js';
import { estimateState } from '../coaching/state.js';
import { localDay } from '../coaching/domain.js';
import { renderPowerProfile } from './power-profile.js';

/**
 * Lists recent activities in a compact, browsable strip for the trainer and plan views.
 *
 * This component keeps the UI focused on recent rides, their timestamps, and provider
 * upload status rather than dumping a large technical record into every screen.
 */
class ActivityList extends HTMLElement {
    /**
     * Creates a compact activity summary list controller.
     */
    constructor() {
        super();
        this.capacity = 7;
        this.index = 0;
        this.activities = [];
    }
    /**
     * Subscribes the list to activity lifecycle events when the component is attached.
     */
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        xf.sub('activity:add', self.onAdd.bind(this), this.signal);
        xf.sub('activity:restore', () => this.loadActivities(), this.signal);
        xf.sub('coaching:changed', () => this.render(), this.signal);
    }

    /**
     * Cleans up event subscriptions when the component is removed.
     */
    disconnectedCallback() {
        this.abortController.abort();
    }

    /**
     * Adds a newly created activity to the top of the list and expands it by default.
     *
     * @param {object} activity - The activity object just added to the in-memory store.
     */
    onAdd(activity) {
        this.activities = [activity, ...this.activities.filter(item => item.id !== activity.id)];
        this.render();
        xf.dispatch(`action:activity:${this.id(activity)}`, ':toggleExpand');
    }

    /**
     * Re-renders activities restored from persisted storage.
     *
     * @param {object[]} activities - Stored activity records already loaded from the app.
     */
    async loadActivities() {
        try {
            this.activities = await models.activity.restore();
            this.render();
        } catch(error) {
            console.error('Unable to restore the activity list:', error);
            this.innerHTML = '<p class="activity-list--error">Activities could not be loaded from this browser.</p>';
        }
    }
    id(data) {
        return data.id;
    }
    name(data) {
        return data.name;
    }
    date(data) {
        return formatDate({
            date: new Date(data.timestamp),
            separator: '/',
            year: false,
        });
    }
    duration(data) {
        const seconds = Number(data.duration || 0);
        return `${Math.ceil(seconds / 60)} min`;
    }
    stats(data) {
        const coachedRide = coachingData()?.activities.find(activity =>
            activity.id === String(data.id) || activity.original?.id === String(data.id),
        );
        const ride = {...coachedRide, ...data};
        const distance = Number(data.distance || 0);
        const avgPower = Number(ride.averagePower || ride.avgPower || 0);
        const avgHr = Number(ride.averageHeartRate || ride.avgHr || 0);
        const items = [];
        if(distance > 0) items.push(`${(distance / 1000).toFixed(1)} km`);
        if(avgPower > 0) items.push(`${Math.round(avgPower)} W`);
        if(avgHr > 0) items.push(`${Math.round(avgHr)} bpm`);
        const loadSource = coachedRide?.loadMetrics;
        const load = loadSource && Object.values(loadSource).find(metric => metric?.value != null);
        if(load) items.push(`Load ${Math.round(load.value)}`);
        if(coachedRide?.rpe != null) items.push(`RPE ${coachedRide.rpe}`);
        if(items.length === 0) items.push(this.duration(data));
        return items;
    }
    summary() {
        const data = coachingData();
        const rides = data?.activities ?? [];
        const profile = data?.profile;
        const timeZone = profile?.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
        const today = localDay(Date.now(), timeZone);
        const date = new Date(`${today}T00:00:00Z`);
        const mondayOffset = (date.getUTCDay() + 6) % 7;
        date.setUTCDate(date.getUTCDate() - mondayOffset);
        const weekStart = date.toISOString().slice(0, 10);
        const monthStart = `${today.slice(0, 7)}-01`;
        const weekly = rides.filter(ride => ride.day >= weekStart && ride.day <= today);
        const monthly = rides.filter(ride => ride.day >= monthStart && ride.day <= today);
        const total = list => ({
            minutes: list.reduce((sum, ride) => sum + Number(ride.duration || 0), 0) / 60,
            distance: list.reduce((sum, ride) => sum + Number(ride.distance || 0), 0) / 1000,
        });
        const week = total(weekly);
        const month = total(monthly);
        let state = null;
        if(profile && rides.length) {
            try {
                state = estimateState(rides, profile, today);
            } catch(error) {
                console.error('Unable to calculate activity training-load metrics:', error);
            }
        }
        const hasStateMetrics = state && [
            state.chronicLoad,
            state.acuteLoad,
            state.formBalance,
            state.rampRate,
        ].every(Number.isFinite);
        const formatDuration = minutes => {
            const rounded = Math.round(minutes);
            const hours = Math.floor(rounded / 60);
            const remainder = rounded % 60;
            return hours ? `${hours}h ${remainder}m` : `${remainder}m`;
        };
        const loadFor = list => {
            if(!state) return null;
            if(state.loadSource === 'duration') {
                return Math.round(list.reduce((sum, ride) => sum + ride.duration, 0) / 60);
            }
            return Math.round(list.reduce((sum, ride) =>
                sum + (ride.loadMetrics[state.loadSource]?.value ?? 0), 0));
        };
        const loadLabel = state?.loadSource === 'duration' ? 'min' : 'load';
        const stats = (label, values, count, load) => `
            <section class="activity-period" aria-label="${label} activity totals">
                <h3>${label}</h3>
                <span>${count} ride${count === 1 ? '' : 's'}</span>
                <span>${formatDuration(values.minutes)}</span>
                ${values.distance ? `<span>${values.distance.toFixed(1)} km</span>` : ''}
                ${load == null ? '' : `<span>${load} ${loadLabel}</span>`}
            </section>`;
        return `
            <div class="activity-periods">
                ${stats('This week', week, weekly.length, loadFor(weekly))}
                ${stats('This month', month, monthly.length, loadFor(monthly))}
            </div>
            ${hasStateMetrics ? `<div class="activity-load-state" aria-label="Current training load">
                <span>Fitness <strong>${Math.round(state.chronicLoad)}</strong></span>
                <span>Fatigue <strong>${Math.round(state.acuteLoad)}</strong></span>
                <span>Form <strong>${Math.round(state.formBalance)}</strong></span>
                <span>Ramp <strong>${state.rampRate.toFixed(1)}</strong></span>
            </div>` : ''}`;
    }
    uploadStatus(data) {
        return data.status;
    }
    template(i, data) {
        const status = this.uploadStatus(data);
        const metrics = this.stats(data);
        const profile = renderPowerProfile({
            samples: data.powerProfile || [],
            ftp: data.ftp,
            label: data.name,
        });

        return `
            <activity-item id="i${i}--activity--item" class="some" data-id="${this.id(data)}">
                    <div class="activity--cont list--row--outer">
                        <div class="list--row--inner activity--info">
                            <div class="activity--info--short">
                                <view-action
                                    class="info"
                                    action=":toggleExpand"
                                    topic=":activity:${this.id(data)}">
                                    <div class="activity--summary-row">
                                        <div>
                                            <div id="i${i}--activity--date" class="activity--name">
                                                ${this.name(data)}
                                            </div>
                                            <div class="activity--date">
                                                ${this.date(data)}
                                            </div>
                                        </div>
                                        <div id="i${i}--activity--duration" class="activity--duration">
                                            ${this.duration(data)}
                                        </div>
                                    </div>
                                    <div class="activity--stats">
                                        ${metrics.map((metric) => `<span>${metric}</span>`).join('')}
                                    </div>
                                    ${profile}
                                </view-action>
                                <view-action
                                    class=""
                                    action=":options"
                                    topic=":activity:${this.id(data)}">
                                    <svg class="control--btn--icon" width="24" height="24">
                                        <use href="#icon--options" />
                                    </svg>
                                </view-action>
                            </div>
                            <div class="activity--info--full">
                                <div class="activity--image">
                                </div>
                                <div class="activity--actions">
                                    <div></div>
                                    <view-action
                                        class="activity--action action--intervals"
                                        action=":intervals:upload"
                                        topic=":activity:${this.id(data)}">
                                        <svg class="activity--icon intervals--icon" width="24" height="24">
                                            <use href="#icon--intervals" />
                                        </svg>
                                        <div class="connection-icon-switch--indicator ${status.intervals ?? 'none'} intervals"></div>
                                    </view-action>

                                    <view-action
                                        class="activity--action"
                                        action=":strava:upload"
                                        topic=":activity:${this.id(data)}">
                                        <svg class="activity--icon strava--icon" width="24" height="24">
                                            <use href="#icon--strava" />
                                        </svg>
                                        <div class="connection-icon-switch--indicator ${status.strava ?? 'none'} strava"></div>
                                    </view-action>
                                    <view-action
                                        class="activity--action action--download"
                                        action=":download"
                                        topic=":activity:${this.id(data)}">
                                        <svg class="activity--icon">
                                            <use href="#icon--save-btn" />
                                        </svg>
                                    </view-action>
                                    <view-action
                                        class="activity--action action--image"
                                        action=":image"
                                        topic=":activity:${this.id(data)}">
                                        <svg class="activity--icon">
                                            <use href="#icon--image" />
                                        </svg>
                                    </view-action>
                                </div> <!-- end activity--actions -->
                            </div> <!-- end activity--info--full -->
                        </div> <!-- end activity--info -->
                    </div> <!-- end activity--cont -->
                    <view-action
                        class="activity--options"
                        action=":remove"
                        topic=":activity:${this.id(data)}">
                        <span class="activity--remove">Delete</span>
                    </view-action>
            </activity-item>
        `;
    }
    render() {
        const items = this.activities.slice(0, this.capacity);
        this.innerHTML = `${this.summary()}<div class="activity-list--items">
            ${items.map((activity, index) => this.template(index, activity)).join('')}
        </div>`;
    }
}

                                    // <view-action
                                    //     class="activity--action"
                                    //     action=":tp:upload"
                                    //     topic=":activity:${this.id(data)}">
                                    //     <div class="tp-logo--icon">TP</div>
                                    //     <div class="connection-icon-switch--indicator ${status.tp ?? 'none'} tp"></div>
                                    // </view-action>


customElements.define('activity-list', ActivityList);

class ActivityItem extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        this.$indicatorStrava = this.querySelector(`.connection-icon-switch--indicator.strava`);
        this.$indicatorIntervals = this.querySelector(`.connection-icon-switch--indicator.intervals`);

        this.$indicatorTP = this.querySelector(`.connection-icon-switch--indicator.tp`);
        this.id = this.dataset.id;

        xf.sub(`action:activity:${self.id}`, this.onAction.bind(this), this.signal);
    }
    disconnectedCallback() {
        this.abortController.abort();
    }
    onAction(action) {
        console.log(action, this.id);

        if(action === ':options') {
            this.classList.toggle('options');
            return;
        }
        if(action === ':toggleExpand') {
            this.classList.toggle('expand');
            return;
        }
        if(action === ':remove') {
            // TODO: refactor to a functional state driven approach
            models.activity.remove(this.id);
            this.remove();
            return;
        }

        if(action === ':download') {
            models.activity.download(this.id);
            return;
        }
        if(action === ':strava:upload') {
            models.activity.upload('strava', this.id);
            this.onLoading(this.$indicatorStrava);
            return;
        }
        if(action === ':intervals:upload') {
            models.activity.upload('intervals', this.id);
            this.onLoading(this.$indicatorIntervals);
            return;
        }
        if(action === ':tp:upload') {
            models.activity.upload('trainingPeaks', this.id);
            this.onLoading(this.$indicatorTP);
            return;
        }

        if(action === ':strava:upload:success') {
            this.onSuccess(this.$indicatorStrava);
        }
        if(action === ':strava:upload:fail') {
            this.onFail(this.$indicatorStrava);
        }
        if(action === ':intervals:upload:success') {
            this.onSuccess(this.$indicatorIntervals);
        }
        if(action === ':intervals:upload:fail') {
            this.onFail(this.$indicatorIntervals);
        }
        if(action === ':tp:upload:success') {
            this.onSuccess(this.$indicatorTP);
        }
        if(action === ':tp:upload:fail') {
            this.onFail(this.$indicatorTP);
        }
    }
    onLoading($el) {
        $el.classList.remove('fail');
        $el.classList.remove('success');
        $el.classList.remove('none');
        $el.classList.add('loading');
    }
    onSuccess($el) {
        $el.classList.remove('off');
        $el.classList.remove('none');
        $el.classList.remove('loading');
        $el.classList.add('success');
    }
    onFail($el) {
        $el.classList.remove('success');
        $el.classList.remove('loading');
        $el.classList.remove('none');
        $el.classList.add('fail');
    }
}

customElements.define('activity-item', ActivityItem);
