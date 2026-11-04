# Intervals.icu integration guide

This document explains the Intervals.icu code path in plain language so a non-developer can understand how the app connects, imports, syncs and uploads rider data.

## What this part of the app does

Athlima can connect to Intervals.icu using the rider's personal API key. Once connected, the server can:

- read the athlete profile
- fetch planned workouts and calendar events
- import historical ride data
- upload new FIT recordings
- keep the rider's athlete number and API key separate and encrypted

The important idea is that this is not done in the browser. The server stores the credentials and handles the API calls. This keeps the API key out of the browser and out of the public repo.

## Main moving parts

### 1. Server setup

The code lives in [server/intervals.mjs](../server/intervals.mjs). It creates a small service that manages Intervals.icu state for each account.

The service keeps data in the app's SQLite database, including:

- the encrypted API key
- the Intervals athlete ID
- the import start date
- the last successful sync date
- the current status (`connected`, `queued`, `running`, `error`, etc.)

### 2. Connection flow

When the user enters their API key in Settings:

1. The app validates the key format.
2. It asks Intervals.icu for the athlete profile using the athlete endpoint.
3. It reads the athlete number from the response.
4. It validates that the API key can access the account.
5. It stores the encrypted key and the athlete ID for that user.

The athlete ID matters because Intervals.icu uses account-specific identifiers, and it is not always `0`.

### 3. Import flow

After a successful connection, the app can import historical rides:

1. It chooses a date window to fetch.
2. It requests activity data from Intervals.icu.
3. It converts the raw provider data into Athlima's normalized activity format.
4. It saves the data into the user's coaching history.
5. It moves the date cursor forward so the next sync can continue from where it left off.

This is designed to be resumable. If the app restarts or the sync is interrupted, the process continues from the saved cursor instead of starting over from the beginning.

### 4. Sync worker

The `tick()` function is the background importer. It runs when the server decides there is a queued job.

The worker:

- checks whether another job is already running
- reads the encrypted API key
- fetches the next date batch
- normalizes the raw activities
- saves them into the user's coaching data
- updates the cursor and success/error state

The goal is to avoid duplicate imports and to keep sync state predictable even when the server restarts or the network fails.

### 5. Upload flow

Athlima also uploads new FIT files back to Intervals.icu.

For uploads, the app:

- checks the FIT file is valid
- uses the saved athlete ID
- sends the file as multipart form data
- tags the uploaded activity with a stable external ID so it does not create duplicate rides when re-imported

### 6. Error handling

The code uses explicit error messages instead of silent failures:

- invalid API key
- expired/changed server key
- invalid date range
- temporary network outage
- rate limiting with `Retry-After`
- malformed server responses

This makes it easier for a user to understand what needs to be fixed without debugging the code itself.

## Why athlete ID matters

The old pattern assumed a fixed athlete endpoint such as `/athlete/0`. That is not correct for all users.

The correct behavior is:

- fetch the athlete profile once
- keep that athlete number in the account
- use it for all later calls such as planned workouts, uploads and activity syncs

This is exactly what the code now does.

## How the tests are organized

The file [server/test/intervals.test.mjs](../server/test/intervals.test.mjs) covers the critical behaviors with short scenarios.

The tests check:

- valid API-key connection and encryption
- invalid inputs and rejected credentials
- upload + sync safety around disconnects
- date-window logic and cursor resumption
- retry behavior for rate limits and transient errors
- coalescing multiple sync requests into one job
- preserving athlete-specific settings during API-key-only proxying
- account isolation so one user cannot read another user's data

The tests are written as small examples of real user flows, not as abstract internals. This makes the expected behavior easier to follow.

## Typical user flow

A normal Intervals.icu setup looks like this:

1. The server operator configures `ATHLIMA_INTEGRATION_KEY`.
2. The rider signs in to Athlima.
3. The rider enters their Intervals.icu API key in Settings.
4. The app resolves the athlete ID.
5. The import worker starts fetching historical activity history.
6. Planned workouts and FIT uploads use that stored athlete ID.
7. If the key changes or the server key is lost, the app reports a reconnect requirement instead of silently breaking.

## Practical rule of thumb

If a user asks: "Why did this not work?" the answer is usually one of these:

- the server key is missing
- the public browser origin does not match the trusted origin
- the API key is wrong
- the athlete ID was never resolved and stored
- the date window is invalid or too large
- a network or rate-limit error interrupted the import

The code is designed to fail loudly and explain the problem clearly.
