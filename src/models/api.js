import { xf } from '../functions.js';
import intervals from './intervals.js';

export default function API() {
    return Object.freeze({
        intervals,
        start() {
            xf.dispatch('services', {intervals: intervals.status().connected});
        },
        stop() {},
    });
}
