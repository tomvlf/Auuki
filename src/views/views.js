/*
 * views.js: front-end client module.
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

import './connection-switch.js';
import './data-views.js';
import './auth-forms.js';
import './effect-views.js';
import './editor.js';
import './tabs.js';
import './workout-list.js';
import './planned-list.js';
import './training-calendar.js';
import './coaching-panel.js';
import './server-account.js';
import './active-list-item.js';
import './activity-list.js';
import './workout-graph.js';
import './moxy-graph.js';
import './watch.js';
import './ant-device-scan.js';
import './keyboard.js';

function start() {
    console.log('start views.');
}

start();
