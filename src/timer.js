/*
 * timer.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Auuki and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * contains the project logic for this module and keeps related responsibilities together.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

var interval;

function onStart() {
    interval = setInterval(function(){
        self.postMessage('tick');
    }, 1000);
}

function onStop() {
    clearInterval(interval);
}

self.addEventListener('message', function(e) {
    switch (e.data) {
    case 'start': onStart(); break;
    case 'stop':  onStop(); break;
    case 'pause': onStop(); break;
    };
}, false);
