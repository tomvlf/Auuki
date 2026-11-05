/** @jest-environment jsdom */
import { mountVersions, versionMarkup } from '../../src/platform/version.js';
import { serverRequest } from '../../src/server/client.js';

jest.mock('../../src/server/client.js', () => ({serverRequest: jest.fn()}));
jest.mock('../../src/platform/build-info.json', () => ({
    version: 'build-17.1', revision: 'fedcba9876543210',
}));

const settle = async () => { for(let i = 0; i < 10; i++) await Promise.resolve(); };
const mount = options => {
    document.body.innerHTML = `<div id="versions">${versionMarkup(options)}</div>`;
    const root = document.querySelector('#versions');
    mountVersions(root);
    return root;
};

beforeEach(() => {
    serverRequest.mockReset();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

test('shows frontend and independently reported backend build identifiers', async () => {
    serverRequest.mockResolvedValue({available: true, version: 'build-18.2', revision: '0123456789abcdef0123'});
    const root = mount();
    const frontend = root.querySelector('[data-frontend-version]');
    expect(frontend.textContent).toBe('build-17.1 (fedcba987654)');
    expect(frontend.title).toBe('build-17.1 / fedcba9876543210');
    expect(root.querySelector('[data-backend-version]').textContent).toBe('Checking...');
    await settle();
    const backend = root.querySelector('[data-backend-version]');
    expect(backend.textContent).toBe('build-18.2 (0123456789ab)');
    expect(backend.title).toBe('build-18.2 / 0123456789abcdef0123');
    expect(serverRequest).toHaveBeenCalledWith('health', {account: null, signal: expect.any(AbortSignal)});
});

test('compact versions omit visible revisions while retaining full revisions in tooltips', async () => {
    serverRequest.mockResolvedValue({available: true, version: 'build-18.2', revision: '0123456789abcdef0123'});
    const root = mount({showRevision: false});
    await settle();
    const frontend = root.querySelector('[data-frontend-version]');
    const backend = root.querySelector('[data-backend-version]');
    expect(frontend.textContent).toBe('build-17.1');
    expect(frontend.title).toBe('build-17.1 / fedcba9876543210');
    expect(backend.textContent).toBe('build-18.2');
    expect(backend.title).toBe('build-18.2 / 0123456789abcdef0123');
});

test('identifies an older backend that does not report a version', async () => {
    serverRequest.mockResolvedValue({available: true});
    const root = mount();
    await settle();
    const backend = root.querySelector('[data-backend-version]');
    expect(backend.textContent).toBe('Not reported');
    expect(backend.title).toContain('does not report');
    expect(console.warn).not.toHaveBeenCalled();
});

test.each([
    ['unreachable', () => Promise.reject(new Error('Offline'))],
    ['invalid health', () => Promise.resolve({available: false, version: 'build-1'})],
    ['invalid version', () => Promise.resolve({available: true, version: 42})],
])('reports %s backend metadata explicitly', async (scenario, reply) => {
    serverRequest.mockImplementation(reply);
    const root = mount();
    await settle();
    expect(root.querySelector('[data-backend-version]').textContent).toBe('Unavailable');
    expect(root.querySelector('[data-backend-version]').title).not.toBe('');
    expect(console.warn).toHaveBeenCalled();
});

test('backend version text is not interpreted as markup', async () => {
    serverRequest.mockResolvedValue({available: true, version: '<img src=x onerror=alert(1)>', revision: null});
    const root = mount();
    await settle();
    const backend = root.querySelector('[data-backend-version]');
    expect(backend.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(backend.querySelector('img')).toBeNull();
});

test('version display has no refresh control and checks the backend once', async () => {
    serverRequest.mockResolvedValue({available: true, version: 'build-2'});
    const root = mount();
    await settle();
    expect(root.querySelector('[data-backend-version]').textContent).toBe('build-2');
    expect(root.querySelector('[data-refresh-version]')).toBeNull();
    expect(serverRequest).toHaveBeenCalledTimes(1);
});

test('a stalled backend check times out without blocking the interface', async () => {
    jest.useFakeTimers();
    serverRequest.mockImplementation((path, {signal}) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('Aborted')));
    }));
    const root = mount();
    expect(root.querySelector('[data-frontend-version]').textContent).toBe('build-17.1 (fedcba987654)');
    jest.advanceTimersByTime(8000);
    await settle();
    const backend = root.querySelector('[data-backend-version]');
    expect(backend.textContent).toBe('Unavailable');
    expect(backend.title).toContain('timed out');
});
