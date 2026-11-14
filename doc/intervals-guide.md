# Intervals.icu integration guide

Athlima connects directly from your browser to `https://intervals.icu/api/v1`.
There is no Athlima account, proxy or backend. Coaching and imported history
remain in browser storage; Intervals.icu itself is an external online service.

## Connect

1. Get your personal API key from Intervals.icu Settings.
2. Open Athlima Settings and enter the key and history start date.
3. Choose **Test & connect**. Athlima resolves your athlete ID from `/athlete/0`
   and uses that ID for subsequent profile, workout and upload requests.
4. Choose **Import history**.

The key is stored in local storage in this browser profile. Requests use HTTPS
Basic authentication with username `API_KEY`; the key never appears in a URL
or local backup. It is not encrypted against someone with access to your browser
profile, and same-origin scripts can read it. Use a trusted browser profile and
revoke the key in Intervals.icu if it is exposed.

## Local history and coaching

Sync imports all sports in 31-day date batches. Activities are mapped and
validated before being committed to the local Coach's IndexedDB state. Only
cycling contributes to cycling coaching and plan adaptation. Available summary
metrics, activity types and compact power/heart-rate profiles are retained.

Progress is saved after each batch. A failed or interrupted import resumes from
the saved date on retry. New syncs recheck the last seven days since the previous
successful sync, preserving subjective feedback and resolved session outcomes.
Invalid activities are explicitly listed as skipped in Settings.

A connected app starts a sync when opened. There is no background server:
closing the app stops the import. Overdue sessions are reviewed after the
final import batch, so completed rides can be matched first. Failed imports
leave existing history intact and show an error; choose **Sync now** to retry.

## Planned workouts, routes and uploads

- The calendar fetches planned workouts directly for its visible date range and
  saves fetched workouts locally so they remain available after reload or offline.
- **Use Intervals.icu FTP / weight** imports available rider settings.
- **Route & data** fetches full-resolution measurement streams and route
  geometry on demand. These are held in browser memory, with CSV export.
- Uploading a recorded ride sends its FIT file as multipart form data to the
  resolved athlete. A stable `athlima:` external ID prevents re-import from
  duplicating the local recording.

Some provider-origin activities, including Strava-origin data, may not expose
streams or routes through the Intervals.icu API.

## Offline use and disconnect

Workout execution, local recordings, saved history and coaching do not require
Intervals.icu or a network connection. Sync, planned-workout refresh and uploads
require internet access and Intervals.icu browser CORS support.

**Disconnect** removes the locally stored key and connection settings but retains
imported coaching history. Reconnect separately on another browser or device;
backup files intentionally do not include API keys.

Authentication, rate-limit, network and malformed-response failures are shown
explicitly. No request falls back to an Athlima server.

## Code and tests

- [Browser integration](../src/models/intervals.js)
- [Provider activity mapping](../src/models/intervals-data.js)
- [Integration tests](../test/models/intervals.test.js)
- [Local coaching](../src/coaching/service.js)
