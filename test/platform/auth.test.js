jest.mock('../../src/platform/ui.js', () => ({launchPlatform: jest.fn().mockResolvedValue()}));
jest.mock('../../src/platform/pwa.js', () => ({registerPwa: jest.fn()}));

const settle = async () => { for(let i = 0; i < 30; i++) await Promise.resolve(); };

beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    document.body.innerHTML = '<div id="platform"></div>';
    global.fetch = jest.fn(() => Promise.reject(new Error('No backend')));
});

test.each(['/', '/mobile', '/#/account'])('opens %s locally without login, even with a legacy server preference', async path => {
    window.history.replaceState({}, '', path);
    localStorage.setItem('athlima-server-mode', '1');
    localStorage.setItem('ftp', '250');
    await import('../../src/platform/start.js');
    await settle();
    expect(require('../../src/platform/ui.js').launchPlatform)
        .toHaveBeenCalledWith(document.querySelector('#platform'));
    expect(fetch).not.toHaveBeenCalled();
    expect(document.querySelector('form')).toBeNull();
    expect(require('../../src/storage/account.js').accountDatabase()).toBe('store');
    expect(localStorage.getItem('ftp')).toBe('250');
    expect(localStorage.getItem('athlima-server-mode')).toBeNull();
});

test('reports local startup failures without presenting a login or clearing saved data', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    require('../../src/platform/ui.js').launchPlatform.mockRejectedValueOnce(new Error('Storage unavailable'));
    await import('../../src/platform/start.js');
    await settle();
    expect(document.querySelector('[role="alert"]').textContent).toContain('Storage unavailable');
    expect(document.querySelector('form')).toBeNull();
    error.mockRestore();
});
