function escapeAttribute(value) {
    return String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function renderPowerProfile({intervals = [], samples = [], ftp, label = 'Power profile'} = {}) {
    const hasThreshold = Number.isFinite(ftp) && ftp > 0;
    const threshold = hasThreshold ? ftp : 200;
    const width = 240;
    const height = 58;
    const left = 2;
    const right = width - 2;
    const top = 5;
    const bottom = height - 4;
    let segments = [];

    for(const interval of intervals) {
        for(const step of interval.steps || []) {
            const duration = Number(step.duration);
            const relativePower = Number(step.power);
            if(Number.isFinite(duration) && duration > 0 &&
               Number.isFinite(relativePower) && relativePower >= 0) {
                segments.push({duration, watts: relativePower * threshold});
            }
        }
    }

    if(segments.length) {
        const totalDuration = segments.reduce((sum, segment) => sum + segment.duration, 0);
        let elapsed = 0;
        const maxWatts = Math.max(threshold, ...segments.map(segment => segment.watts));
        const scale = value => bottom - (value / maxWatts) * (bottom - top);
        const points = [`M ${left} ${bottom}`];
        for(const segment of segments) {
            const x1 = left + (elapsed / totalDuration) * (right - left);
            elapsed += segment.duration;
            const x2 = left + (elapsed / totalDuration) * (right - left);
            const y = scale(segment.watts);
            points.push(`L ${x1} ${y}`, `L ${x2} ${y}`);
        }
        points.push(`L ${right} ${bottom}`, 'Z');
        const ftpY = scale(threshold);
        return `<figure class="power-profile">
            <figcaption>Power profile</figcaption>
            <svg viewBox="0 0 ${width} ${height}" role="img"
                 aria-label="${escapeAttribute(`${label}: target power from 0 to ${Math.round(maxWatts)} watts`)}"
                 preserveAspectRatio="none">
                <line class="power-profile--ftp" x1="${left}" y1="${ftpY}" x2="${right}" y2="${ftpY}"></line>
                <path class="power-profile--target" d="${points.join(' ')}"></path>
            </svg>
        </figure>`;
    }

    const validSamples = samples.filter(value => Number.isFinite(value) && value >= 0);
    if(validSamples.length < 2) return '';

    const bucketCount = Math.min(64, validSamples.length);
    const points = Array.from({length: bucketCount}, (_, index) => {
        const start = Math.floor(index * validSamples.length / bucketCount);
        const end = Math.max(start + 1, Math.floor((index + 1) * validSamples.length / bucketCount));
        const bucket = validSamples.slice(start, end);
        return bucket.reduce((sum, value) => sum + value, 0) / bucket.length;
    });
    const maxWatts = Math.max(1, hasThreshold ? threshold : 0, ...points);
    const x = index => left + (index / Math.max(1, points.length - 1)) * (right - left);
    const y = value => bottom - (value / maxWatts) * (bottom - top);
    const line = points.map((value, index) =>
        `${index ? 'L' : 'M'} ${x(index)} ${y(value)}`,
    ).join(' ');
    const area = `${line} L ${right} ${bottom} L ${left} ${bottom} Z`;
    const ftpY = bottom - (threshold / maxWatts) * (bottom - top);

    return `<figure class="power-profile">
        <figcaption>Power profile</figcaption>
        <svg viewBox="0 0 ${width} ${height}" role="img"
             aria-label="${escapeAttribute(`${label}: recorded power from 0 to ${Math.round(maxWatts)} watts`)}"
             preserveAspectRatio="none">
            ${hasThreshold ? `<line class="power-profile--ftp" x1="${left}" y1="${ftpY}" x2="${right}" y2="${ftpY}"></line>` : ''}
            <path class="power-profile--recorded-area" d="${area}"></path>
            <path class="power-profile--recorded" d="${line}"></path>
        </svg>
    </figure>`;
}

export {renderPowerProfile};
