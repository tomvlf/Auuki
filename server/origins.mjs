export function trustedOrigins(origin, additionalOrigins = []) {
    return new Set([origin, ...additionalOrigins].map(value => {
        const url = new URL(value);
        if(!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
           url.search || url.hash || url.pathname !== '/') {
            throw new Error('Auuki origins must be HTTP(S) scheme/host/port values without paths, credentials, queries or fragments.');
        }
        return url.origin;
    }));
}
