# Optional backend

Auuki remains local-only by default: no server discovery or account request is
made by this feature until you sign in. The existing third-party integrations
and their account forms are independent of this self-hosted account.

## What server mode does

In **Settings > Profile > Optional server account**, create an account using an
email and a password of at least 12 characters, or sign into an existing one.
Signing in explicitly enables server coaching for this browser. In
**Workouts > Calendar**, configure a profile and goal as usual. Plans, activity
imports, post-ride feedback and adaptations are calculated by the server using
the same deterministic engine and safety limits as the local coach. No LLM,
external AI service or email delivery provider is involved.

The account's coaching history is stored independently of the browser's local
coaching history. Switching modes does not import, merge or overwrite either
history. On a new server account, configure a new coaching profile; import
activity history using the coaching panel's documented input format if needed.
Coaching operations are saved automatically. Export this history through the
coaching panel. Calculation is request-driven, not a background scheduled job:
opening the app or reviewing missed sessions advances the plan.

Use **Save this device's data to server** to explicitly back up imported workout
files, recent cached FIT recordings (normally the last seven), profile settings
and the manual calendar. Referenced built-in workouts are saved as copies so
calendar entries retain their workout IDs on another device. Other built-in workouts remain supplied by the app. These
device backups are manual, not live multi-device synchronization, and do not
include Bluetooth pairing, active ride sessions, third-party credentials or local
coaching history. Save again after changing device data. A backup can be
downloaded as JSON, including base64-encoded FIT files.

On another browser, sign into the same server and confirm **Restore server backup
and reload**. Restore merges saved workouts and recordings by ID and replaces
profile settings and the manual calendar. Existing unrelated workout/recording
IDs are preserved. Storage failures are reported; if settings storage fails after
the IndexedDB merge, retry the restore. Stop recording before account actions or
restoring. Server coaching is already available after signing in without restore;
restore the profile FTP too before executing a server plan created with another FTP.

There is no silent offline fallback for server coaching. If the server is
unavailable, changes fail visibly; FIT recording remains local. Reconnect and
import the ride manually if its coaching update failed. You can explicitly
switch to **local-only** to use the separate on-device coach. This does not end
the HTTP session; **Sign out** revokes it. Signing in again or reloading retrieves
the latest state after a conflicting edit from another browser/tab.

## Development

Use Node.js 22.18 or newer. The backend has no third-party runtime dependencies;
it uses Node's HTTP, crypto and SQLite modules.

```sh
AUUKI_INSECURE_COOKIES=1 npm run server
# In another terminal:
npm start
```

Parcel proxies `/api/server` to port 3000. Use the `http://localhost:1234` Parcel
URL (if it selects another port, set `AUUKI_ORIGIN` accordingly). For HTTPS
development set the matching `AUUKI_ORIGIN` and leave secure cookies enabled.

```sh
npm run test:server
npm test -- --runInBand test/server test/coaching test/views/training-calendar.test.js
```

## Deployment

The default `compose.yaml` still deploys only the static website. Add the
backend override to build both services:

```sh
AUUKI_ORIGIN=https://cycling.example.com \
  docker compose -f compose.yaml -f compose.server.yaml up --build -d
```

Terminate TLS at a trusted reverse proxy in front of port 8080. Forward the
browser's `Origin` header unchanged. The backend is accessible only on the
Compose network, not a published host port. Nginx forwards `/api/server/` to it.
Without that service, the optional API is unavailable and the local app still
works. The included nginx resolver uses Docker's internal DNS; non-Docker nginx
deployments must configure their own backend address and resolver.

For an HTTP trial on localhost only, set `AUUKI_INSECURE_COOKIES=1`. This setting
is rejected for non-localhost origins. Keep Secure cookies enabled on real
deployments. An origin is an exact scheme/host/port, with no trailing slash.

| Environment | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | Backend listening port |
| `AUUKI_ORIGIN` | `http://localhost:1234` (CLI), `http://localhost:8080` (Compose) | Exact allowed browser origin |
| `AUUKI_DATABASE` | `./data/auuki.sqlite` | Persistent SQLite path |
| `AUUKI_INSECURE_COOKIES` | `0` | Set to `1` only for local HTTP |

SQLite uses WAL and stores accounts, hashed sessions and per-account documents.
Compose keeps these in the `auuki-server-data` volume; do not use
`docker compose down -v` unless you intend to delete all server data. Back up
this volume consistently with SQLite's backup tooling or stop the backend before
copying the database and WAL files. Protect backups and restrict filesystem
access: training data and email addresses are **not encrypted at rest**.
Operate one backend process against this database; horizontal scaling is not
provided. Each backup/coaching document and incoming JSON request is capped at
32 MiB. Long coaching histories can reach this limit and should be exported.

Passwords use salted scrypt. Session cookies are HttpOnly, SameSite=Strict and
Secure by default, expire after seven days and are stored hashed on the server.
Writes require the configured Origin, JSON content type and client header.
Authentication attempts are limited per socket IP; behind nginx this is shared
by its clients, conservatively limiting all of them to 20 attempts per 15 minutes.
Configure additional public-edge rate limiting and registration access controls
for an internet-facing deployment. There is no email verification, password reset,
account recovery or operator UI in this initial backend; use a password manager.
Never expose the backend directly on public HTTP.

Deleting an account from the panel deletes its live coaching data, backup and
sessions, but not device data. Operators must apply their own retention policy to
database backups. Server storage is opt-in and may include physiological data
and subjective feedback: inform users where your server runs and who operates
it, secure it appropriately and establish a retention policy before accepting
other users' data.

## API

All routes are under `/api/server/`, separate from existing integration APIs.
Successful responses and errors are JSON with `Cache-Control: no-store`; errors
contain `error`. Authenticated requests use the session cookie. Writes require
`Origin: <AUUKI_ORIGIN>`, `Content-Type: application/json`, and `X-Auuki-Client: 1`.

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

Allowed coaching methods are `configure`, `generate`, `archive`,
`importActivities`, `recordRide`, `resolve`, `updateFeedback`, `advance`, using
the existing `CoachingService` signatures. The server chooses the clock.
Backup and coaching revisions are independent; writes with a stale revision
return 409 instead of silently overwriting another client's edits.
