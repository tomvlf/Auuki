let scope = '';

export function setAccountScope(email) {
    scope = `auuki:${encodeURIComponent(email)}:`;
}

export const accountKey = key => `${scope}${key}`;
export const accountDatabase = () => scope ? `${scope}store` : 'store';
export const hasAccountScope = () => Boolean(scope);
export const accountStorage = {
    getItem: key => window.localStorage.getItem(accountKey(key)),
    setItem: (key, value) => window.localStorage.setItem(accountKey(key), value),
    removeItem: key => window.localStorage.removeItem(accountKey(key)),
};
