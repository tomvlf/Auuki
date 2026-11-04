/*
 * intervals.js: front-end client module.
 *
 * Why this exists:
 * This file is part of Athlima and is kept separate so the application can be understood
 * as a set of focused responsibilities instead of one large unstructured script.
 * The code here is intentionally organized around one job so a new contributor can
 * follow the data flow and the reason for each step without reading unrelated code.
 *
 * What it does:
 * defines the data structures and API contracts used by the app when storing and exchanging rider data.
 *
 * Developer note:
 * Read this file as the boundary of the problem it solves: inputs, transformations,
 * persistence, and outputs. If a change affects the behaviour of this module, update
 * the tests and the surrounding callers in the same review.
 */

import { xf } from '../functions.js';
import { isoDate } from '../utils.js';
import { serverRequest } from '../server/client.js';

const endpoint = 'integrations/intervals';

function connect() {
    window.location.hash = '/settings';
    xf.dispatch('ui:page-set', 'settings');
}

async function disconnect() {
    await serverRequest(endpoint, {method: 'DELETE', body: {}});
    xf.dispatch('services', {intervals: false});
}

async function wod(oldest = isoDate(), newest = isoDate()) {
    try {
        const events = await serverRequest(`${endpoint}/events?${new URLSearchParams({oldest, newest})}`);
        xf.dispatch('action:planned', ':intervals:wod:success');
        return events.filter(event => event.workout_file_base64);
    } catch(error) {
        xf.dispatch('action:planned', ':intervals:wod:fail');
        xf.dispatch('ui:modal:error:open', error.message);
        throw error;
    }
}

async function uploadWorkout(record) {
    try {
        const bytes = new Uint8Array(await record.blob.arrayBuffer());
        let binary = '';
        for(let offset = 0; offset < bytes.length; offset += 8192) {
            binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        await serverRequest(`${endpoint}/upload`, {method: 'POST', body: {
            id: record.id, name: record.summary?.name || 'Athlima workout', file: btoa(binary),
        }});
        return ':success';
    } catch(error) {
        xf.dispatch('ui:modal:error:open', error.message);
        return ':fail';
    }
}

function athleteToSettings(athlete = {}, defaults = {weight: 0, ftp: 0}) {
    const settings = athlete.sportSettings || [];
    const selected = settings.find(setting => setting.types?.includes('VirtualRide')) ||
        settings.find(setting => setting.types?.includes('Ride'));
    return {
        weight: athlete.weight ?? athlete.icu_weight ?? defaults.weight,
        ftp: selected?.indoor_ftp ?? selected?.ftp ?? defaults.ftp,
    };
}

async function getAthlete() {
    try {
        const athlete = await serverRequest(`${endpoint}/athlete`);
        xf.dispatch('action:athlete', ':intervals:athlete:success');
        return athleteToSettings(athlete);
    } catch(error) {
        xf.dispatch('action:athlete', ':intervals:athlete:fail');
        xf.dispatch('ui:modal:error:open', error.message);
        throw error;
    }
}

export default Object.freeze({connect, disconnect, wod, uploadWorkout, getAthlete,
    athleteToSettings, update() {}});
