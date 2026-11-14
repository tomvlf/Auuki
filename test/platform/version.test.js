import { mountVersions, versionMarkup } from '../../src/platform/version.js';

jest.mock('../../src/platform/build-info.json', () => ({
    version: 'build-17.1', revision: 'fedcba9876543210',
}));

test.each([true, false])('shows build metadata without contacting a backend (revision: %s)', showRevision => {
    global.fetch = jest.fn();
    document.body.innerHTML = versionMarkup({showRevision});
    mountVersions(document.body);
    const frontend = document.querySelector('[data-frontend-version]');
    expect(frontend.textContent).toBe(showRevision ? 'build-17.1 (fedcba987654)' : 'build-17.1');
    expect(frontend.title).toBe('build-17.1 / fedcba9876543210');
    expect(document.querySelector('[data-backend-version]')).toBeNull();
    expect(document.body.textContent).toContain('Storage: on this device');
    expect(fetch).not.toHaveBeenCalled();
});
