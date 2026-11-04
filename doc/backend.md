# Platform backend

The desktop platform and `/mobile` support guest use without a backend.
Guest workouts, Bluetooth/ANT+ controls, FIT recording/downloads, recovery,
profile settings, the manual calendar and on-device coaching remain available
anonymously. Server coaching/history, private server backups and Intervals.icu
API-key connections require an account. There is no automatic upload of guest data.

After choosing **Sign in / Create account**, the app verifies the HttpOnly
session before opening account-specific browser data or starting the engine.
Subsequent visits restore that account mode. An expired session or unavailable
server shows a visible error/login screen with **Continue without an account**;
it never silently opens protected account data as a guest.
The default Compose stack runs both the frontend and backend;
include `compose.server.yaml` when building the images from source.

## Accounts and browser-native workouts

Choose **Sign in / Create account**, then create an account with an email and a password of at least
12 characters, or sign into an existing account. In **Coach**, configure a
profile and goal. Plans, activity
imports, post-ride feedback and adaptations are calculated by the server using
the same deterministic engine and safety limits as the local coach. No LLM,
external AI service or email delivery provider is involved.

Coaching operations and normalized activity history are saved automatically.
Export them in **Settings** or **Coach**. Coach calculations are request-driven;
opening the app or reviewing missed sessions advances the plan. The
Intervals.icu import worker runs separately on the server.

Workouts, FIT recordings, profile preferences, the manual calendar and recovery
checkpoints are isolated per account in this browser. Existing unscoped legacy
data is not automatically attributed or uploaded to a newly authenticated account.
Bluetooth/ANT+ access still uses browser permissions and the existing device
engine, not a server relay. No frontend runtime framework or CDN is required.

The worker timer, trainer controls and recording stay local during a loaded
ride. Server failure leaves completed rides in a persistent account-scoped
outbox; they retry on reload or with **Activities > Retry synchronization**.
Pending recordings are not evicted to enforce the normal seven-file cache.
If local storage itself fails, keep the page open and use **Download unsaved
FIT** or **Retry saving** in Ride before reloading or starting another session.
Reconnect sensors before resuming a recovered ride. Browser suspension or
device loss cannot be made equivalent to uninterrupted recording.

The PWA caches only its public shell and static assets, never account API
responses or credentials. Updates wait for existing ride windows to close.
A fresh account-mode page load still verifies the server session: fully offline
login or offline reopening of the protected account is not supported. Guest
mode can open the cached public shell and its separate on-device data.

When signed in, use **Settings > Save backup** to explicitly back up imported workout
files, recent cached FIT recordings (normally the last seven), profile settings
and the manual calendar. Referenced built-in workouts are saved as copies so
calendar entries retain their workout IDs on another device. Other built-in workouts remain supplied by the app. These
device backups are manual, not live multi-device synchronization, and do not
include Bluetooth pairing, active ride sessions, third-party credentials or local
coaching history. Save again after changing device data. A backup can be
downloaded as JSON, including base64-encoded FIT files.

On another browser, sign into the same server and confirm **Settings > Restore
backup**. Restore merges saved workouts and recordings by ID and replaces
profile settings and the manual calendar. Existing unrelated workout/recording
IDs are preserved. Storage failures are reported; if settings storage fails after
the IndexedDB merge, retry the restore. Stop recording before account actions or
restoring. Server coaching is already available after signing in without restore;
restore the profile FTP too before executing a server plan created with another FTP.

There is no silent local-coaching fallback for an account. If the server is unavailable,
changes fail visibly; FIT recording remains local. **Sign out** revokes the
session and is blocked during a ride. Expiry pauses and checkpoints a ride
before showing login. Switching to guest mode reloads into separate guest
storage; account ride recovery remains in that account's storage. Signing in
again or reloading retrieves the latest state
after a conflicting edit from another browser/tab.

## Intervals.icu API-key connection

The previous external OAuth proxy has been replaced for athlete profile reads,
planned ZWO workouts and FIT uploads as well as history import. All calls use
the current account's encrypted server-side API key. No key is placed in a
browser URL, local storage, response or log.

Set `ATHLIMA_INTEGRATION_KEY` to a persistent base64-encoded 32-byte encryption
key, for example generated with `openssl rand -base64 32`. Supply it through
your secret manager/environment, not version control. Losing or changing it
requires reconnecting integrations; keep it separate from database backups.
Credentials use AES-256-GCM with a random nonce and account-bound associated
data. Without the key configured, the rest of the platform still works but new
integration connections are disabled.

In **Settings > Intervals.icu**, enter a personal API key from the provider's
Settings page and a history start date. **Test & connect** validates access;
**Import history** queues the import. **Sync now** subsequently rechecks seven
days before the last successful synchronization through today. A 31-day
date-window cursor is persisted after each atomic batch. Interrupted jobs
resume after a process restart. Repeated syncs update stable provider IDs
without duplicating activities, rider feedback or workout completions. Uploads
carry an Athlima external identity so importing your own uploaded recording does
not create a second ride.

Syncs are serialized in this single-process deployment. HTTP 429 honors
`Retry-After`; network/server failures and revision conflicts use bounded
exponential retries, with at most five attempts per batch before requiring a
manual retry. No provider rate limit is assumed. Status, date progress, errors
and last successful synchronization are shown in Settings. Disconnect deletes
the encrypted credential and pending job; imported history is retained.

The provider adapter maps summaries to `normalizeActivity`; Coach, plan
generation/adaptation, history and analytics consume only this internal model.
Missing measurements remain unavailable. Cycling `Ride`/`VirtualRide` and
cycling subtypes are imported; Strava-origin data is not available through this
API. Imported summaries do not fabricate one-second streams or best efforts.
Additional providers should add an adapter producing the same normalized input
and stable provider IDs, rather than introduce provider objects to Coach.

Personal API-key connections are intended for personal/self-hosted use. Consult
Intervals.icu's OAuth requirements before operating a public multi-user service.
Official references consulted:
[API documentation](https://intervals.icu/api-docs/),
[API access](https://forum.intervals.icu/t/api-access-to-intervals-icu/609),
[integration cookbook](https://forum.intervals.icu/t/intervals-icu-api-integration-cookbook/80090),
[planned workouts](https://forum.intervals.icu/t/downloading-planned-workouts-from-the-api/93737).

## Development

Use Node.js 22.18 or newer. The backend has no third-party runtime dependencies;
it uses Node's HTTP, crypto and SQLite modules.

```sh
ATHLIMA_INSECURE_COOKIES=1 npm run server
# In another terminal:
npm start
```

Parcel proxies `/api/server` to port 3000. Use the `http://localhost:1234` Parcel
URL or `http://127.0.0.1:1234` (both are trusted by the CLI development defaults).
If Parcel selects another port, set `ATHLIMA_ORIGIN` to the URL it prints. For HTTPS
development set the matching `ATHLIMA_ORIGIN` and leave secure cookies enabled.

```sh
npm run test:server
npm test -- --runInBand test/server test/coaching test/views/training-calendar.test.js
```

## Deployment

The default `compose.yaml` pulls the frontend and backend images from GitHub
Container Registry:

```sh
ATHLIMA_ORIGIN=https://cycling.example.com \
  docker compose up -d
```

The GitHub Actions workflow publishes both images on pushes to `master` and
version tags. Make the packages public or authenticate to GHCR before pulling
private images. To build both images from a local checkout instead, use:

```sh
ATHLIMA_ORIGIN=https://cycling.example.com \
  docker compose -f compose.yaml -f compose.server.yaml up --build -d
```

Terminate TLS at a trusted reverse proxy in front of port 8080. Set
`ATHLIMA_ORIGIN` to the URL in the browser's address bar, **not** the backend's
`http://backend:3000` address or the proxy's internal address. Forward the
browser's `Origin` header unchanged. The backend is accessible only on the
Compose network, not a published host port. Nginx forwards `/api/server/` to it.
Without that service, login is unavailable. The included nginx resolver uses Docker's internal DNS; non-Docker nginx
deployments must configure their own backend address and resolver.

If multiple URLs legitimately serve the app, list their exact origins in
`ATHLIMA_ADDITIONAL_ORIGINS`, for example `https://mobile.example.com,https://cycling.example.com:8443`.
Only explicitly configured origins are trusted; forwarded host/protocol headers
do not grant trust. A trailing slash in configuration is normalized; paths,
credentials, query strings and fragments are rejected. Scheme and port matter.
Never add an untrusted site or a wildcard.

For an HTTP trial on localhost only, set `ATHLIMA_INSECURE_COOKIES=1`. This setting
is rejected if any configured origin is non-loopback. Keep Secure cookies enabled
on real deployments. HTTP LAN addresses cannot support secure authentication or
Web Bluetooth: use HTTPS. A missing cookie after successful registration/login
is reported explicitly instead of returning to login without an explanation.

The browser always calls relative `/api/server/` URLs through Parcel/nginx on
the same origin. This is intentionally not a cross-origin API: no permissive
CORS headers or separate browser API URL are needed. Backend port `PORT`
defaults to 3000; if changed, update both the proxy target and health check.
Email/password authentication has no OAuth callback/redirect URL; the session
cookie is scoped to `/api/server`. Intervals.icu uses the signed-in account's
server-stored API key, not the former OAuth proxy.

If login reports an origin rejection, compare the browser URL with the backend
startup log, correct the origin variables and recreate/restart the backend
(`docker compose up -d` after changing Compose's environment or `.env`).
Rebuilding static frontend assets does not change the backend's trusted origins.

| Environment | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Backend listening port |
| `ATHLIMA_ORIGIN` | `http://localhost:1234` (CLI), `http://localhost:8080` (Compose) | Exact allowed browser origin |
| `ATHLIMA_ADDITIONAL_ORIGINS` | `http://127.0.0.1:1234` (CLI only when `ATHLIMA_ORIGIN` is unset), otherwise empty | Comma-separated additional trusted browser origins |
| `ATHLIMA_DATABASE` | `./data/athlima.sqlite` | Persistent SQLite path |
| `ATHLIMA_INSECURE_COOKIES` | `0` | Set to `1` only for local HTTP |
| `ATHLIMA_INTEGRATION_KEY` | unset | Base64-encoded 32-byte server-only encryption key |

SQLite uses WAL and stores accounts, hashed sessions and per-account documents.
Compose keeps these in the `athlima-server-data` volume; do not use
`docker compose down -v` unless you intend to delete all server data. Back up
this volume consistently with SQLite's backup tooling or stop the backend before
copying the database and WAL files. Protect backups and restrict filesystem
access: training data and email addresses are **not encrypted at rest**.
Operate one backend process against this database; horizontal scaling is not
provided. Each backup/coaching document and incoming JSON request is capped at
32 MiB. Long coaching histories can reach this limit and should be exported.

Passwords use salted scrypt. Session cookies are HttpOnly, SameSite=Strict and
Secure by default, expire after seven days and are stored hashed on the server.
Writes require an explicitly configured Origin, JSON content type and client header.
Authentication attempts are limited per socket IP; behind nginx this is shared
by its clients, conservatively limiting all of them to 20 attempts per 15 minutes.
Configure additional public-edge rate limiting and registration access controls
for an internet-facing deployment. There is no email verification, password reset,
account recovery or operator UI in this initial backend; use a password manager.
Never expose the backend directly on public HTTP.

Deleting an account from the panel deletes its live coaching data, backup and
sessions, but not device data. Operators must apply their own retention policy to
database backups. Server training history may include physiological data
and subjective feedback: inform users where your server runs and who operates
it, secure it appropriately and establish a retention policy before accepting
other users' data.

## API

All routes are under `/api/server/`, separate from existing integration APIs.
Successful responses and errors are JSON with `Cache-Control: no-store`; errors
contain `error`. Authenticated requests use the session cookie. Writes require
`Origin: <ATHLIMA_ORIGIN>`, `Content-Type: application/json`, and `X-Athlima-Client: 1`.

| Route | Method | Body / response |
|---|---|---|
| `health` | GET | `{available: true}` |
| `register`, `login` | POST | `{email, password}`; sets session cookie |
| `session` | GET | `{email}` |
| `logout` | POST | `{}`; revokes current session |
| `account` | DELETE | `{confirm: "<account email>"}` |
| `backup` | GET | `{data, revision}`; `data` is null before first save |
| `backup` | PUT | `{data, revision}` |
| `coaching` | GET | `{data, revision}` |
| `coaching` | POST | `{method, args, revision}`; returns `{data, revision, result}` |
| `integrations/intervals` | GET | Connection status, progress, errors and last success; never the key |
| `integrations/intervals` | PUT | `{apiKey, oldest: "YYYY-MM-DD"}`; test and encrypt the connection |
| `integrations/intervals` | DELETE | `{}`; disconnect and cancel pending import |
| `integrations/intervals/test` | POST | `{}`; test saved key |
| `integrations/intervals/sync` | POST | `{}`; enqueue/coalesce synchronization (202) |
| `integrations/intervals/athlete` | GET | Provider athlete settings through the account connection |
| `integrations/intervals/events` | GET | `oldest`, `newest` query dates, at most 63 days; planned ZWO events |
| `integrations/intervals/upload` | POST | `{id, name, file}`; base64 FIT upload, at most 18 MiB decoded |

Allowed coaching methods are `configure`, `generate`, `archive`,
`importActivities`, `recordRide`, `resolve`, `updateFeedback`, `advance`, using
the existing `CoachingService` signatures. The server chooses the clock.
Backup and coaching revisions are independent; writes with a stale revision
return 409 instead of silently overwriting another client's edits.
