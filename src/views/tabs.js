/*
 * tabs.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
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

import { xf } from '../functions.js';

class TabBtn extends HTMLElement {
    constructor() {
        super();
    }
    connectedCallback() {
        this.state = '';
        this.effect = this.getAttribute('effect') || '';
        this.param = this.getAttribute('param') || '';
        this.prop = this.getAttribute('prop') || false;
        this.addEventListener('pointerup', this.onEffect.bind(this));

        if(this.prop) {
            xf.sub(`db:${this.prop}`, this.onUpdate.bind(this));
            document.removeEventListener(`db:${this.prop}`, this.onUpdate);
        }
    }
    disconnectedCallback() {
        this.removeEventListener('pointerup', this.onEffect);
    }
    onEffect(e) {
        xf.dispatch(`ui:${this.effect}`, this.param);
    }
    onUpdate(state) {
        this.state = state;
        if(this.state === this.param) {
            this.classList.remove('active');
            this.classList.add('active');
        } else {
            this.classList.remove('active');
        }
    }
}

class TabGroup extends HTMLElement {
    constructor() {
        super();
        this.tabClass = this.defaultTabSelector();
        this.tabAttr = this.defaultTabAttr();
        this.prop = this.getAttribute('prop') || '';
        this.tabs = this.querySelectorAll(this.tabClass);
    }
    defaultTabSelector() { return '.tab'; }
    defaultTabAttr() { return 'tab'; }
    connectedCallback() {
        xf.sub(`db:${this.prop}`, this.onUpdate.bind(this));
    }
    disconnectedCallback() {
        document.removeEventListener(`db:${this.prop}`, this.onUpdate);
    }
    onUpdate(param) {
        this.tabs.forEach(tab => {
            if(this.getId(tab) === param) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
    }
    getId(tab) {
        return tab.getAttribute(this.tabAttr);
    }
}

customElements.define('tab-btn', TabBtn);
customElements.define('tab-group', TabGroup);



class PageBtn extends TabBtn {}
class PageGroup extends TabGroup {
    defaultTabSelector() { return '.page'; }
    defaultTabAttr() { return 'page'; }
}

customElements.define('page-btn', PageBtn);
customElements.define('page-group', PageGroup);

export { TabBtn, TabGroup };
