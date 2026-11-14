# Browser-only deployment and migration

The account backend, login, registration, server coaching, server backup APIs
and OAuth proxies have been removed. The app now runs fully in the browser.
Intervals.icu requests go directly to the provider using a locally stored
personal API key. No Athlima server stores training information.

## Run the app

For development:

```sh
npm install
npm start
```

For a production build:

```sh
npm run build
```

Serve `dist/` over HTTPS or localhost. Web Bluetooth requires a secure context.
The Compose configurations serve static frontend files only; the HTTPS variant
adds Caddy. The historically named `compose.server.yaml` is now only a local
frontend build override. No server database, authentication cookies, integration
encryption key or trusted-origin environment variables are required.

The hardened frontend container listens on port 8080 as UID/GID 101. Compose
enforces a read-only filesystem, drops all capabilities, prevents privilege
escalation and mounts only bounded temporary storage. The build uses a lockfile
and digest-pinned base images; update these deliberately for upstream patches.
HTTP responses include a build-specific CSP that allows the generated import map,
local scripts/workers and direct Intervals.icu access, but no arbitrary inline
scripts, framing or plugins. Inline styles are retained for the dynamic UI.
The HTTPS variant adds HSTS and restricts the Caddy container while retaining
writable TLS volumes and its low-port binding capability.
Older published frontend images use port 80; rebuild/publish before deploying
the updated port-8080 Compose configuration.

## Storage and backups

- IndexedDB `store` contains workouts, recent FIT recordings and ride recovery.
- IndexedDB `athlima-coaching` contains full coaching history, profile, goals,
  plans and revisions.
- Local storage contains device settings, manual calendar entries and the
  optional Intervals.icu API key.
- Settings > Local backup downloads/restores a version-2 JSON file containing
  coaching plus device data. API keys are excluded.

Browser data is specific to an origin and browser profile. A hostname, scheme or
port change can make existing data appear absent without deleting it. Keep local
backups before changing origins, clearing browser data or moving devices.
Backups contain private training information; protect them accordingly.

## Upgrading from the account-backed version

Before upgrading, use the previous version to export coaching history and
download device backups. The new version opens the existing unscoped local
database and local coaching state; it does not automatically select or merge
any account-scoped browser database or server history.

Version-1 device backup files from the previous version can be restored through
Settings > Local backup. They contain device files/settings/calendar, not
coaching history. Exported coaching activity arrays can be imported through
Coach's JSON history import. New version-2 backups also restore the full Coach
profile, goal, plan and revision state.

Existing server volumes and account-scoped browser data are left untouched.
Do not delete them until you have verified exports and local restoration.
When updating an existing Compose deployment, explicitly stop/remove the old
backend container; the new Compose configuration does not start or expose it.
Keep its data volume until migration is verified.
