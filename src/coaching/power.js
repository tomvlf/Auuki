export function powerAccumulator() {
    const window = Array(30).fill(0);
    let cursor = 0, count = 0, total = 0, fourthSum = 0, samples = 0;
    return {
        add(power, seconds = 1) {
            if(!Number.isFinite(power) || power < 0 || !Number.isInteger(seconds) || seconds < 1) {
                throw new Error('Power calculation requires nonnegative power and positive integer seconds.');
            }
            const boundary = Math.min(seconds, 30);
            for(let i = 0; i < boundary; i++) {
                total += power - window[cursor];
                window[cursor] = power;
                cursor = (cursor + 1) % 30;
                count++;
                if(count >= 30) {
                    fourthSum += (total / 30) ** 4;
                    samples++;
                }
            }
            // A steady block's interior has identical rolling averages; keep only its boundary window.
            if(seconds > boundary) {
                const remaining = seconds - boundary;
                fourthSum += power ** 4 * remaining;
                samples += remaining;
                count += remaining;
                cursor = (cursor + remaining) % 30;
                total = power * 30;
            }
        },
        value() { return samples ? (fourthSum / samples) ** 0.25 : null; },
    };
}
