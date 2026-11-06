<img alt="Athlima smart trainer app" src="https://github.com/user-attachments/assets/292a3216-2f52-4994-9b15-614446e41912" />

# Athlima

Athlima is a browser-based indoor cycling platform for structured workouts, trainer control, activity recording, and coaching. It is intentionally local-first: the workout engine, device controls, FIT recording, and most ride logic run in the browser, while optional server features are available when you sign in and configure the backend.

The app is built around a single idea: training should work without friction, while still supporting private accounts, backups, history import, and provider integrations when you want them.

## What Athlima does

- runs `.zwo` workouts and built-in structured sessions
- shows a live workout power timeline with a current-position marker, interval countdown, and separate target/actual power and cadence; unprescribed cadence is explicitly self-selected
- searches and filters the workout library by category, type, and duration, with sorting and workout or course previews
- controls smart trainers in ERG, resistance, and grade-simulation modes
- records `.fit` files with power, cadence, heart rate, and RR intervals
- supports session planning and direct launch from a multi-week calendar, with weekly ride totals and power profiles when data is available
- reviews cycling activities with weekly and monthly totals, available training-load indicators, and recorded power previews when samples exist
- imports and syncs activity history (all sports, with type icons) from Intervals.icu
- fetches full-resolution power, heart-rate and cadence streams plus route previews on demand, with CSV export
- uploads new FIT recordings back to Intervals.icu
- includes an adaptive coaching engine for goal-based planning and ride review
- supports a desktop web app and a dedicated `/mobile` training companion
- keeps guest-mode data separate from server-backed account data

## Ride screen

The ride screen keeps target power, interval time remaining and target cadence
above an always-visible workout power profile. A labelled position marker
follows the workout timeline, including skipped intervals; completed work is
dimmed and the current interval is outlined. Actual power and cadence remain
separate from their targets, and disconnected sensors show unavailable readings.
Cadence targets come from the workout; an unprescribed cadence is explicitly
shown as self-selected. Device connections and trainer settings are available
under "Devices & trainer settings" without hiding the profile.

## Current repo status

This repository is the browser app plus a self-hosted account backend. The main flow is:

- guest mode works without a server
- account mode enables server-side coaching, private backups, and provider integrations
- Intervals.icu integration is server-side and uses the current rider's encrypted API key
- the backend stores account-scoped state in SQLite and keeps the app contract explicit rather than silently falling back to guest mode


## Quick start

### Local development

Requirements:
- Node.js 22.18.0 or later

```bash
npm install
ATHLIMA_INSECURE_COOKIES=1 npm run server
# in a second terminal
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

The default Compose setup runs the frontend and backend together for local testing and self-hosted use.

```bash
ATHLIMA_INSECURE_COOKIES=1 docker compose up -d
```

Then open:

- http://localhost:8080

To stop it:

```bash
docker compose down
```

To build from a local checkout instead of using published images:

```bash
ATHLIMA_INSECURE_COOKIES=1 docker compose -f compose.yaml -f compose.server.yaml up --build -d
```

### Deployed versions

The desktop app shows separate frontend and backend versions at the bottom of the
left-hand menu; the dedicated mobile app omits them. The sign-in screen also shows
the versions. Published images display the GitHub Actions build number and
attempt. The sign-in screen also shows the first 12 characters of the Git
revision; hover over a version for the full revision. An older backend may show
“Not reported”, while an unreachable backend shows “Unavailable”.

Local development and local image builds show `development` unless build metadata
is supplied. The frontend label identifies the code currently loaded in the
browser, so reload the app after deploying a new frontend.

## Self-hosted accounts and integrations

The app is usable without an account for workouts, device control, recovery, local training calendar work, and on-device coaching.

Account features are opt-in and include:

- server-side coaching and adaptive planning
- private encrypted backups
- Intervals.icu API-key connections
- per-user account isolation for saved data and history
- server-side sync for imported ride history and uploads

If you are self-hosting, see:

- [doc/backend.md](doc/backend.md)
- [doc/intervals-guide.md](doc/intervals-guide.md)
- [doc/coaching.md](doc/coaching.md)

For Intervals.icu, the app expects a configured server-side encryption key:

```bash
openssl rand -base64 32
```

Store the result in `ATHLIMA_INTEGRATION_KEY` as a secret environment variable. Do not commit it to the repo.

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

## Server safety and deployment notes

The backend enforces trusted browser origins and must be configured to match the real public URL used by the browser.

Key variables:

- `ATHLIMA_ORIGIN` — exact public browser origin to allow
- `ATHLIMA_ADDITIONAL_ORIGINS` — extra trusted origins when needed
- `ATHLIMA_INSECURE_COOKIES` — only for localhost HTTP development; do not use this in production

The backend is meant to be used behind a secure public deployment, not just as a local dev convenience.

## Documentation

- [README.md](README.md)
- [doc/backend.md](doc/backend.md)
- [doc/intervals-guide.md](doc/intervals-guide.md)
- [doc/coaching.md](doc/coaching.md)

## License

This project is licensed under the terms in [LICENSE.txt](LICENSE.txt).
