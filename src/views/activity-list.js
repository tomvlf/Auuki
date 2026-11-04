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
        this.capacity = 3;
        this.index = 0;
    }
    /**
     * Subscribes the list to activity lifecycle events when the component is attached.
     */
    connectedCallback() {
        const self = this;
        this.abortController = new AbortController();
        this.signal = { signal: self.abortController.signal };

        xf.sub('activity:add', self.onAdd.bind(this), this.signal);
        xf.sub('db:activity', self.onRestore.bind(this), this.signal);
    }

    /**
     * Cleans up event subscriptions when the component is removed.
     */
    disconnectedCallback() {
        this.abortController.abort();
        this.unsubs();
    }

    /**
     * Adds a newly created activity to the top of the list and expands it by default.
     *
     * @param {object} activity - The activity object just added to the in-memory store.
     */
    onAdd(activity) {
        const self = this;
        self.insertAdjacentHTML("afterbegin", self.template(this.index, activity));
        xf.dispatch(`action:activity:${this.id(activity)}`, ':toggleExpand');

        if(this.childElementCount > 3) {
            self.removeChild(self.lastElementChild);
        }

        this.index++;
    }

    /**
     * Re-renders activities restored from persisted storage.
     *
     * @param {object[]} activities - Stored activity records already loaded from the app.
     */
    onRestore(activities) {
        const self = this;
        activities.forEach((a) => {
            self.insertAdjacentHTML("beforeend", self.template(this.index, a));
        });
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
        return `${Math.ceil(data.duration / 60)} min`;
    }
    uploadStatus(data) {
        return data.status;
    }
    template(i, data) {
        const status = this.uploadStatus(data);

        return `
            <activity-item id="i${i}--activity--item" class="some" data-id="${this.id(data)}">
                    <div class="activity--cont list--row--outer">
                        <div class="list--row--inner activity--info">
                            <div class="activity--info--short">
                                <view-action
                                    class="info"
                                    action=":toggleExpand"
                                    topic=":activity:${this.id(data)}">
                                    <div id="i${i}--activity--date" class="activity--name">
                                        ${this.name(data)}
                                    </div>
                                    <div class="activity--date">
                                        ${this.date(data)}
                                    </div>
                                    <div id="i${i}--activity--duration" class="activity--duration">
                                        ${this.duration(data)}
                                    </div>
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
