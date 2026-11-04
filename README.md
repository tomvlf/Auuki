<img alt="Auuki Indoor Cyling app for Structured Training" src="https://github.com/user-attachments/assets/292a3216-2f52-4994-9b15-614446e41912" />

# Auuki
Auuki is a powerful, no-nonsense app built for hammering out **structured workouts** on a smart trainer, right in your browser. No installs, no dependencies, no slow updates taking from precious training time.

**Key Features**:
* Run Zwift **.ZWO workouts**
* Connect via **Bluetooth** to smart trainers, power meters, heart rate monitors, the moxy monitor, and many more
* Full control with **ERG mode**, **Grade Simulation**, and **Resistance mode**
* Workouts with **Slope-based targets** for realistic effort control
* Record **.FIT activities** in a cross-industry standard
* Recording of native **RR intervals** in the .FIT file
* Built-in structured workouts to get you started
* Schedule workouts from your library in a **monthly training calendar**, view workouts planned in Intervals.icu, and start a workout directly from the calendar
* **OpenBikeControl** support for Bluetooth virtual gear shifting and handlebar controls
* **Intervals.icu and Strava** integrations for seamless syncing and uploads
* On-device **adaptive cycling coaching** with dated goals, availability-aware
  periodisation, structured workouts and deterministic post-ride adaptation
* Private **server accounts**, account-scoped device backups and server-side
  adaptive coaching
* A desktop training platform and a dedicated **`/mobile` ride companion**,
  built around the same browser-native workout and trainer engine

The coach is available in **Coach**, with sessions in **Training Calendar** and
**Training Plan**, and works without an LLM.
See the [coaching guide](doc/coaching.md) for setup, history import, calculation
defaults, safety limits and known data limitations. It provides training decision
support, not medical diagnosis or medical advice.

Built as a **progressive web app (PWA)**, Auuki is fully browser-based and runs independently. It makes use of some of the most advanced Browser APIs like: Web Bluetooth, Web Serial, and Web Components. The web version is **free and open-source**, keeping everything on your device by default. Server storage and computation are opt-in.
Train with full control directly in your browser without an account, including
the `/mobile` companion. Sign in only for optional server features; workout
execution and device recording remain local. There is no runtime
frontend framework or external CDN dependency.

_Status_: Currently working on creating a full suite of Apple platform native apps (iOS, iPadOS, tvOS, watchOS).

# The Web App
- You can find the web app at [auuki.com](https://auuki.com)
- There is also a special development version which has the latest features available for preview: [dev.auuki.com](https://dev.auuki.com)
- [How to create a Profile and Connect Intervals.icu](https://forum.intervals.icu/t/auuki-com-intervals-icu-integration/87105)

## Development

Install [Node.js](https://nodejs.org/) 22.18.0 or later, then install the dependencies and start Parcel:

```sh
npm install
AUUKI_INSECURE_COOKIES=1 npm run server
# In a second terminal:
npm start
```

Parcel prints the local URL when it starts. To run the test suite or create a production build, use:

```sh
npm test
npm run build
```

For HTTPS development, `npm run starttls` uses `dev_cert/cert.pem` and
`dev_cert/key.pem`; provide those local certificate files first.

## Run with Docker Compose

The default Compose stack runs the frontend and backend images published to
GitHub Container Registry. For a local HTTP trial, start both services with:

```sh
AUUKI_INSECURE_COOKIES=1 docker compose up -d
```

Then open [http://localhost:8080](http://localhost:8080). To stop it, run
`docker compose down`. The backend stores its data in the persistent
`auuki-server-data` volume. The images must first be published by the GitHub
Actions workflow; if a package is private, authenticate to GHCR before pulling.

To build both images from a local checkout instead, use:

```sh
AUUKI_INSECURE_COOKIES=1 docker compose -f compose.yaml -f compose.server.yaml up --build -d
```

The app uses browser device APIs that require a secure context. `localhost`
works for local use; deployments accessed from another host need HTTPS, typically
provided by a reverse proxy. For HTTPS deployments, set `AUUKI_ORIGIN` to the
exact public browser origin (scheme, hostname and port), and leave insecure cookies
disabled. The default `http://localhost:8080` only allows that browser URL, not
a LAN address or public proxy hostname. For additional trusted URLs, set
`AUUKI_ADDITIONAL_ORIGINS` to a comma-separated list of exact origins.

## Self-hosted accounts and integrations

The desktop platform and `/mobile` open in guest mode by default. Workouts,
BLE/ANT+ controls, FIT recording/downloads, recovery, the calendar and local
coaching need no account or backend. Choose **Sign in / Create account** for
server coaching, private backups and server-side integrations. Guest data is
kept separately and is not automatically uploaded to an account.
See the [backend guide](doc/backend.md) for deployment, data storage,
API-key encryption and Intervals.icu synchronization.

Create an account or sign in after starting the stack. Use **Settings >
Intervals.icu** to connect a personal API key. This requires a persistent
`AUUKI_INTEGRATION_KEY`; see the backend guide for configuration. The previous
Intervals.icu OAuth proxy has been replaced by this server-side connection.

## Sponsors 💖
So, if you’re loving what Auuki’s bringing to the table, consider supporting the project on [GitHub Sponsors](https://github.com/sponsors/dvmarinoff)? Think of it as buying me a coffee or, heck, a whole power meter to keep this thing cranking. Hit that sponsor button and let’s keep the good times rolling!

## Supported Browsers and Platforms

### MacOS, Windows, Android

Please use either Chrome, Edge, Opera, Samsung Internet, or Brave. These browsers include built-in bluetooth.

Web Bluetooth also requires a **secure context**: HTTPS with a trusted
certificate, or `http://localhost` on the device running the browser. Chrome
does not expose Bluetooth on an HTTP LAN address such as `http://192.168.1.10:8080`.
This includes Android accessing a self-hosted server: use HTTPS, not the server's
HTTP LAN URL. On Android, open the URL directly in Chrome rather than an in-app
browser. If Bluetooth is still unavailable over HTTPS, check browser Bluetooth
permissions and the Linux setup below.

| Chrome | Edge | Opera | Chrome Android | Samsung Internet | Brave | Firefox | Safari | Safari iOS | Chrome iOS |
|--------|------|-------|----------------|------------------|-------|---------|--------|------------|------------|
| yes    | yes  | yes   | yes            | yes              | yes*  | no      | no     | no         | no         |

If using Brave browser, you'll need to [manually enable bluetooth support](https://community.brave.com/t/can-you-enable-web-bluetooth-api-in-brave/522553/2).

### Linux
On Linux you might need to turn on the experimental platforms feature flag in your browser:

- Chrome: `chrome://flags/#enable-experimental-web-platform-features`

- Edge: `edge://flags/#enable-experimental-web-platform-features`

- Opera: `opera://flags/#enable-experimental-web-platform-features`

Relaunch the browser after changing the flag. The HTTPS/localhost requirement
still applies; enabling the flag does not enable Bluetooth on insecure pages.

### iOS
Not Supported by the Web version

## Supported Trainers

### FTMS, FE-C over BLE, or WahooCPS

Works with all trainers that implement the bluetooth Fitness Machine Service (FTMS) or the Tacx FE-C over BLE solution.

The following table is copied from [DC Rainmaker Trainer Guide](https://www.dcrainmaker.com/2020/11/smart-cycle-trainer-recommendations-guide-winter.html/#technical-considerations) and shows current protocol support across the industry.

```
- Elite:    ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Gravat:   ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers
- JetBlack: ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Kinetic:  ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Minoura:  ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Saris:    ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- STAC:     ANT+ FE-C and Bluetooth FTMS on all 2020 smart trainers.
- Tacx:     ANT+ FE-C on all ‘Smart’ branded trainers (except Satori). FTMS on all non-NEO models. FEC over BLE on NEO.
- Wahoo:    ANT+ FE-C on all smart trainers. FTMS on all 2020 smart trainer.
- 4iiii:    ANT+ FE-C and Bluetooth FTMS on Fliiiight (--Ed)
- Schwinn:  Bluetooth FTMS on the IC8 / 800IC (--Ed)
```

### ANT+

ANT+ FE-C smart trainers and ANT+ heart-rate monitors are supported through a compatible USB ANT+ adapter. The browser must expose Web Serial or WebUSB, and the app must be served from a secure context (HTTPS or localhost). Connecting prompts you to select the adapter; availability depends on the browser, operating system, and adapter.

## Manual
- [How to create a Profile and Connect Intervals.icu](https://forum.intervals.icu/t/auuki-com-intervals-icu-integration/87105)
- [How-To: Using the connection settings](https://github.com/dvmarinoff/Auuki/discussions/91)
- [How-To: Using Auuki and another app concurrently](https://github.com/dvmarinoff/Auuki/discussions/101)

## Backers
<div>
    <a href="https://github.com/KlausMu" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/14290221?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/TClin76" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/96434118?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/fvolcic" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/59806465?s=64&v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/napfbike" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/192727271?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/sharalds" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/25537910?v=4" width="48" height="48" />
    </a>
    <a href="https://github.com/BenSimpsonAnalytics" target="_blank">
        <img style="display: inline-block;" src="https://avatars.githubusercontent.com/u/81325092?v=4" width="48" height="48" />
    </a>
</div>
