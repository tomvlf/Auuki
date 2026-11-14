import frontendBuildInfo from './build-info.json';
import { escape } from './format.js';

const frontendVersion = frontendBuildInfo.version?.trim() || 'development';
const frontendRevision = frontendBuildInfo.revision?.trim() || '';
const label = (version, revision) => revision ? `${version} (${revision.slice(0, 12)})` : version;
const fullLabel = (version, revision) => revision ? `${version} / ${revision}` : version;

export function versionMarkup({showRevision = true} = {}) {
    return `<div class="app-versions" role="group" aria-label="Deployed versions" data-show-revision="${showRevision}">
        <span>Frontend: <strong data-frontend-version title="${escape(fullLabel(frontendVersion, frontendRevision))}">${escape(label(frontendVersion, showRevision ? frontendRevision : ''))}</strong></span>
        <span>Storage: on this device</span>
    </div>`;
}

export function mountVersions(root) {
    return root.querySelector('.app-versions');
}
