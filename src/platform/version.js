import { serverRequest } from '../server/client.js';
import frontendBuildInfo from './build-info.json';
import { escape } from './format.js';

const frontendVersion = frontendBuildInfo.version?.trim() || 'development';
const frontendRevision = frontendBuildInfo.revision?.trim() || '';
const label = (version, revision) => revision ? `${version} (${revision.slice(0, 12)})` : version;
const fullLabel = (version, revision) => revision ? `${version} / ${revision}` : version;

export function versionMarkup({showRevision = true} = {}) {
    return `<div class="app-versions" role="group" aria-label="Deployed versions" data-show-revision="${showRevision}">
        <span>Frontend: <strong data-frontend-version title="${escape(fullLabel(frontendVersion, frontendRevision))}">${escape(label(frontendVersion, showRevision ? frontendRevision : ''))}</strong></span>
        <span>Backend: <strong data-backend-version role="status" aria-live="polite">Checking...</strong></span>
    </div>`;
}

export function mountVersions(root) {
    const area = root.querySelector('.app-versions');
    const backend = area.querySelector('[data-backend-version]');
    const showRevision = area.dataset.showRevision === 'true';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const loadBackendVersion = async () => {
        try {
            const result = await serverRequest('health', {account: null, signal: controller.signal});
            if(result?.available !== true) throw new Error('The backend health response is invalid.');
            if(result.version === undefined) {
                backend.textContent = 'Not reported';
                backend.title = 'This backend does not report its version.';
                return;
            }
            if(typeof result.version !== 'string' || !result.version.trim() ||
                (result.revision != null && typeof result.revision !== 'string')) {
                throw new Error('The backend version response is invalid.');
            }
            const version = result.version.trim();
            const revision = result.revision?.trim() || '';
            backend.textContent = label(version, showRevision ? revision : '');
            backend.title = fullLabel(version, revision);
        } catch(error) {
            backend.textContent = 'Unavailable';
            backend.title = controller.signal.aborted ? 'The backend version request timed out.' :
                error?.message || 'The backend version could not be retrieved.';
            console.warn('Could not read the backend version:', backend.title);
        } finally {
            clearTimeout(timeout);
        }
    };
    void loadBackendVersion();
}
