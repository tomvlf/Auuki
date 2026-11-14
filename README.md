
# Athlima

Athlima is a browser-based indoor cycling platform for structured workouts, trainer control, activity recording, and coaching. All application logic and training data stay in your browser. There is no login, application backend or cloud account.

The app supports local backups and optional direct Intervals.icu history import and FIT upload using your personal API key.

## What Athlima does

- runs `.zwo` workouts and built-in structured sessions
- shows a live workout power timeline with a current-position marker, interval countdown, and separate target/actual power and cadence; cadence targets appear only when prescribed
- searches and filters the workout library by category, type, and duration, with power profiles and cadence previews
- controls smart trainers in ERG, resistance, and grade-simulation modes
- records `.fit` files with power, cadence, heart rate, and RR intervals
- supports session planning and direct launch from a multi-week calendar, with weekly ride totals and power profiles when data is available
- reviews cycling activities with weekly and monthly totals, available training-load indicators, and recorded power previews when samples exist
- imports and syncs activity history (all sports, with type icons) from Intervals.icu
- fetches full-resolution power, heart-rate and cadence streams plus route previews on demand, with CSV export
- uploads new FIT recordings back to Intervals.icu
- includes an adaptive coaching engine for goal-based planning and ride review
- automatically switches between mobile and desktop layouts as the window width changes
- saves coaching, plans, workouts, recordings and calendar on this device
- downloads and restores local backup files without including integration credentials

## Ride screen

The application's default cyberpunk theme uses a locally bundled city backdrop,
dark panels and restrained cyan/magenta accents. The ride screen removes
decorative imagery and header accents to keep metrics and controls
distraction-free. The theme is included in production builds and Docker images,
with no external image or font requests. Styling lives in `src/css/cyberpunk.css`;
the original city artwork is retained in `src/images/cyberpunk-city.svg`.

Both `/` and `/mobile` automatically use the mobile layout at widths of 700px
or less and the desktop layout above that. Resizing or rotating switches layouts
without reloading, changing the current page, clearing forms, or interrupting a ride.
Mobile screens use compact cards and expandable secondary information: library
filters, workout notes and intervals, monthly activity totals, local backup
settings, additional sensors, the month calendar overview, and the plan timeline. Open sections retain their
state while navigating during the session; desktop shows this information expanded.
The mobile library shows six workouts per page with Previous/Next controls.
Ride metrics and controls stay visible, and the five-item bottom navigation is unchanged.
Long activity histories and setup forms still scroll so no information is clipped.

The ride screen keeps target power, interval time remaining and target cadence
above an always-visible workout power profile. A labelled position marker
follows the workout timeline, including skipped intervals; completed work is
dimmed and the current interval is outlined. Actual power and cadence remain
separate from their targets, and disconnected sensors show unavailable readings.
Cadence targets come from the workout and are hidden when none is prescribed;
actual cadence remains visible. Device connections and trainer settings are available
under "Devices & trainer settings" without hiding the profile.
Use "Choose a workout" beneath the ride controls to browse the library.
In workout details, "Start workout" opens the ride screen and starts the session.
Finish and save an existing ride before starting another workout.

The library includes gentle cadence-practice sessions and shows target cadence
ranges on workout cards and individual targets in workout details. The Coach
may include approved drills in suitable endurance slots; cadence is optional,
not a diagnosis or a universal target. Ride comfortably and stop or return to
your natural cadence if a drill causes discomfort or bouncing.

## Current repo status

This repository is a standalone browser app. The main flow is:

- open the app and train without signing in
- run the complete Coach locally using IndexedDB
- connect Intervals.icu directly from Settings using a browser-stored API key
- export a backup before clearing browser data or switching devices


## Quick start

### Local development

Requirements:
- Node.js 22.18.0 or later

```bash
npm install
npm start
```

The frontend is run through Parcel. Open the local URL it prints in the browser.

Useful commands:

```bash
npm test
npm run build
```

For HTTPS development, use:

```bash
npm run starttls
```

This expects local cert files in `dev_cert/cert.pem` and `dev_cert/key.pem`.

### Docker Compose

The default Compose setup serves only static frontend files. No backend or database service is needed.
The frontend runs as UID/GID 101 on container port 8080, with a read-only
filesystem, no Linux capabilities, no privilege escalation and a bounded
temporary filesystem. The container includes a health check.

```bash
docker compose up -d
```

Then open:

- http://localhost:8080

For the existing Dockhand `bike_trainer` stack, use `compose.dockhand.yaml`.
It preserves host port 1111 for the existing HTTPS proxy, forwarding to container
port 8080. TLS remains handled by your existing proxy; no Caddy or backend is
needed in this stack. Replace the stack's Compose content with this file and
redeploy after publishing the new frontend image.
The old backend is no longer needed. Stop/remove its container separately if
Dockhand leaves it as an orphan; preserve its data volume until any old data
has been exported. Do not use volume deletion during this upgrade.

To stop it:

```bash
docker compose down
```

To build from a local checkout instead of using published images:

```bash
docker compose -f compose.yaml -f compose.server.yaml up --build -d
```

For public HTTPS hosting, replace `app.example.com` in `Caddyfile` with your
hostname and run:

```bash
docker compose -f compose.https.yaml up -d
```

To build the HTTPS frontend locally instead:

```bash
docker compose -f compose.https.yaml -f compose.server.yaml up --build -d
```

Caddy manages TLS certificates, sets HSTS and keeps certificate/configuration
state in its named volumes. Its root process retains only the capability needed
to bind ports 80/443; the frontend is non-root and has no capabilities.

The build and server base images are pinned by digest, and `npm ci` uses the
committed lockfile. Refresh these pins and the lockfile regularly for security
updates; pinning does not automatically apply upstream patches.
Rebuild/publish before using these Compose files with a published image:
older frontend images listen on port 80 rather than 8080.

### Deployed versions

The desktop app shows the frontend version at the bottom of the left-hand menu;
the mobile layout omits it. Published images display the GitHub Actions build
number and attempt. Hover over the version for the full Git revision.

Local development and local image builds show `development` unless build metadata
is supplied. The frontend label identifies the code currently loaded in the
browser, so reload the app after deploying a new frontend.

## Local data and integrations

The Coach, activity history, calendar, workout library and ride recovery use browser storage. Data is not synchronized between browsers or devices. Clearing site data or browser eviction can remove it; use Settings > Local backup regularly.

Intervals.icu is optional and requires internet access. In Settings, enter your
personal API key and import start date. The key is saved in this browser's local
storage and sent only to `https://intervals.icu`. It is not encrypted against
someone with access to your browser profile. Disconnect removes the key but
keeps imported history. There is no Athlima server or intermediary.
Strava and TrainingPeaks server-based OAuth connections have been removed;
use FIT file downloads for manual upload to other providers.

For details, see:

- [doc/backend.md](doc/backend.md)
- [doc/intervals-guide.md](doc/intervals-guide.md)
- [doc/coaching.md](doc/coaching.md)

Older account-scoped browser data and server volumes are not deleted or silently
merged. Export data from the previous version before upgrading; see the migration
notes in the backend guide.

## Browser and device support

Athlima relies on browser APIs such as Web Bluetooth, Web Serial, and Web Components. For a supported experience, use a secure context and a compatible browser.

Supported browsers:
- Chrome
- Edge
- Opera
- Brave
- Samsung Internet

Important notes:
- Bluetooth requires HTTPS or localhost
- Android generally works best by opening the URL directly in Chrome
- Firefox and Safari are not supported for the trainer/Web Bluetooth path

### Linux

On Linux, enable the experimental web platform flag if needed:

- Chrome: `chrome://flags/#enable-experimental-web-platform-features`
- Edge: `edge://flags/#enable-experimental-web-platform-features`
- Opera: `opera://flags/#enable-experimental-web-platform-features`

### iOS

The web version is not currently supported on iOS.

## Supported trainer protocols

Athlima supports the industry-standard trainer and sensor protocols used by indoor bikes:

- FTMS over Bluetooth
- FE-C over BLE
- Wahoo CPS
- ANT+ FE-C via a compatible USB ANT+ adapter

## Static hosting

Serve the built `dist/` directory over HTTPS, or use localhost for development.
The Compose HTTPS variant adds Caddy in front of the static frontend only.
No authentication cookie, server encryption key or server-origin configuration
is required. Training and coaching work offline once app assets are cached;
Intervals.icu requests require a connection and browser CORS access.

The Docker build generates a Content Security Policy from the exact built HTML,
including hashes for Parcel's inline import map. Scripts cannot use arbitrary
inline code or `eval`; connections are limited to this origin and Intervals.icu.
Inline styles remain allowed for the existing dynamic UI. Anti-framing,
MIME-sniffing, referrer and device-permission headers also apply to error pages.
Other static hosts must configure equivalent headers themselves. Do not reuse
the generated CSP after replacing assets without rebuilding its import-map hashes.

## Documentation

- [README.md](README.md)
- [doc/backend.md](doc/backend.md)
- [doc/intervals-guide.md](doc/intervals-guide.md)
- [doc/coaching.md](doc/coaching.md)

## License

This project is licensed under the terms in [LICENSE.txt](LICENSE.txt).
