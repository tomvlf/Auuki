/*
 * activity-icon.js: small inline SVG icons for activity sport categories.
 *
 * Icons use currentColor so they follow the surrounding Athlima theme colour.
 */

import { activityTypeLabel, sportForType } from '../coaching/activity-types.js';

const paths = {
    cycling: '<circle cx="5.5" cy="17" r="3.5"/><circle cx="18.5" cy="17" r="3.5"/>' +
        '<path d="M5.5 17 9 9.5h6.5L18.5 17M9 9.5 12 17h-6.5M12 17l3.5-7.5M13.5 6h3"/>',
    running: '<circle cx="15" cy="4.5" r="2"/><path d="m6 21 3.5-5 3 2 1-6 3 3h3M8.5 12l2-4 4 1.5 3-2"/>',
    swimming: '<circle cx="16.5" cy="7" r="2"/><path d="m5 13 5-4 3 3M2 17c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5M2 21c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5"/>',
    walking: '<circle cx="13" cy="4" r="2"/><path d="m8 21 3-7 3 3v4M11 14l1-6 4 4h3M12 8l-4 2-1 4"/>',
    hiking: '<path d="m2 20 7-11 4 6 3-4 6 9z"/><path d="m14.5 6.5 1.5-2.5 1.5 2.5"/>',
    strength: '<path d="M6.5 6.5v11M17.5 6.5v11M3.5 9v6M20.5 9v6M6.5 12h11"/>',
    mobility: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7.5V13M5 10l7 2 7-2M4 19c3-1 5-4 8-6 3 2 5 5 8 6"/>',
    rowing: '<path d="M2 17h20l-3 3H5zM6 14l12-10M16 6l3 3"/><circle cx="9" cy="10" r="1.6"/>',
    winter: '<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 2 3-2M9 20l3-2 3 2"/>',
    skating: '<path d="M6 3h5v8l7 2c1.5.4 2 1.4 2 2.5V16H6zM4 20h16M8 16v4M17 16v4"/>',
    water: '<path d="M12 2v14H4zM14 5c3 2.5 4.5 6 4.5 11H14zM2 20c2.5 0 2.5-1.5 5-1.5s2.5 1.5 5 1.5 2.5-1.5 5-1.5 2.5 1.5 5 1.5"/>',
    racket: '<ellipse cx="9.5" cy="9.5" rx="6" ry="6.5" transform="rotate(-45 9.5 9.5)"/><path d="m14 14 6.5 6.5M6 9.5h7M9.5 6v7"/>',
    team: '<circle cx="12" cy="12" r="9"/><path d="m12 7 4 3-1.5 4.5h-5L8 10zM12 3v4M20.5 10 16 10M3.5 10H8M9.5 14.5 7 19M14.5 14.5 17 19"/>',
    other: '<path d="M2 12h4l3-8 6 16 3-8h4"/>',
};

/**
 * Renders an accessible activity icon with its readable type label.
 *
 * @param {{sport?: string, activityType?: string|null}} activity - Normalized activity.
 * @param {{label?: boolean}} [options] - Set label=false to render only the icon.
 * @returns {string} HTML markup.
 */
export function activityIcon(activity = {}, {label = false} = {}) {
    const sport = activity.sport || (activity.activityType ? sportForType(activity.activityType) : 'cycling');
    const text = activityTypeLabel(activity.activityType, sport);
    const svg = `<svg class="activity-icon activity-icon--${paths[sport] ? sport : 'other'}" viewBox="0 0 24 24" ` +
        `aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" ` +
        `stroke-linecap="round" stroke-linejoin="round">${paths[sport] || paths.other}</svg>`;
    const safe = text.replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
    return label
        ? `<span class="activity-type" title="${safe}">${svg}<span>${safe}</span></span>`
        : `<span class="activity-type" title="${safe}" role="img" aria-label="${safe}">${svg}</span>`;
}

export { activityTypeLabel };
