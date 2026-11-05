# Adaptive cycling coaching

The **Coach** view contains the account's deterministic cycling coach. It is
training decision support, not medical diagnosis or medical advice. No injury,
medical condition, or biological readiness is inferred. No LLM or third-party
AI account is used for planning. Calculations reuse the same
pure coaching modules as the original on-device implementation.

The platform requires sign-in and stores Coach data on its self-hosted server.
The workout player and trainer engine still run locally in the browser; see
the [backend guide](backend.md) for storage, recovery and integration details.

## Using the coach

**Coach** guides you through four numbered steps:

1. **Check your rider profile.** FTP and body weight come from **Settings**;
   body weight is required, and without FTP sessions use effort (RPE) guidance.
2. **What are you training for?** Goal name, type, priority and a time frame
   (about 6 weeks, 3 months, 6 months or a year). Event details such as an exact
   event date, distance, climbing and targets are optional; an event date
   replaces the time frame.
3. **When can you ride?** The longest ride per weekday in minutes (0 for rest
   days), an indoor/outdoor preference per day, a long-ride day, weekly hours
   and experience.
4. **Create your plan.** Recorded Athlima rides are included automatically; for
   better targets connect **Settings > Intervals.icu** first, or import rides
   later under **Ride history and backup**. The existing Athlima activity
   summaries contain only duration, and the FIT cache retains only seven rides.
   **More options** holds the start date, time zone, heart-rate values and
   equipment.

Once a plan is active, Coach shows the goal countdown, current phase, next
session and upcoming sessions, plus post-ride feedback, plan adjustments and a
**Why this plan?** explanation. Day to day:

- Start generated sessions from the calendar, or export individual ZWO files.
   Day preferences, purpose, expected RPE and the reason for each session are
   recorded. ZWO powers are fractions of FTP, not absolute watts.
   In-app Start is available only for today's unresolved sessions in the active
   plan; future/archived sessions cannot accidentally be executed as today's
   prescription. Without FTP, follow the duration/RPE guidance instead of
   executing power targets.
- Recorded Athlima rides update the coach automatically. Imported rides can match
   sessions too. Confirm a duration-only ride with **Use substitute**; duration
   alone is intentionally insufficient for automatic matching.
- Submit post-ride feedback, mark unsuccessful sessions **Not completed**, mark
   missed sessions, or choose **Make upcoming training easier**. Overdue sessions are reviewed
   when the app opens, after a recording, or with **Review missed sessions**.
   The server's Intervals.icu import worker can continue while the browser is closed.

The first implementation supports one athlete and one active goal at a time,
over a 1-366 day horizon. Archive a plan before reconfiguring or generating a
replacement. Archived revisions and their goal definitions remain in history.
FTP is captured from the existing profile when configuring; after changing FTP,
archive and regenerate before starting a generated workout. The player rejects
a coaching selection with a different FTP rather than silently raising watts.
Other profile changes likewise require reconfiguration for future plans.
Do not stack the coach's prescription with separate library or Intervals.icu
sessions; choose a substitution and let the completed ride update the coach.

## Architecture and API

All calculations use seconds, watts, kilograms, kilometres for goal distances,
metres for goal elevation and minutes for availability and weekly volume.
Activity distance/elevation retain the source input in metres. ISO instants must
include a time-zone offset; calendar dates are `YYYY-MM-DD` in the athlete's
declared IANA time zone. Pure calculations take explicit dates and timestamps.

| Responsibility | Module / public function |
|---|---|
| Activity Normalizer | `normalizer.js`: `normalizeActivity`, `fromRecordedRide` |
| Rider State Estimator | `state.js`: `estimateState`, `powerDuration`, `estimateCriticalPower`, `intensityDistribution`, `estimateDurability` |
| Goal Demand Model | `demands.js`: `modelGoalDemand` |
| Gap Analyzer | `demands.js`: `analyzeGaps` |
| Periodisation Engine | `planner.js`: `periodise` |
| Weekly Target Generator | `planner.js`: `weeklyTargets` |
| Workout Progression Engine | `workouts.js`: `progressWorkout` |
| Workout Scheduler | `planner.js`: `scheduleWorkouts` |
| Workout Matcher | `adaptation.js`: `matchWorkout` |
| Adaptation Engine | `adaptation.js`: `adaptPlan` |
| Explanation Engine | `explanations.js`: phase, week, workout and adaptation reasons |
| Validation and Safety Guard | `domain.js` validators and `planner.js`: `validatePlan` |

`generatePlan({profile, goal, state, startDate, generatedAt})` composes the pure
planning modules. Goal weights are in the extensible `GOALS` registry; callers
can supply a registry with additional five-element capability weight vectors.
The initial types are general fitness, FTP improvement, gran fondo, climbing,
time trial, road race, criterium, sprint and long-distance completion.

`CoachingService(storage, clock)` composes history, snapshots, matching and
revision persistence. Mutating methods are asynchronous and must be awaited:
`configure`, `importActivities`, `generate`, `recordRide`, `resolve`,
`updateFeedback`, `advance`, `archive`. `clock` returns an ISO timestamp.
`resolve` accepts `completed`, `substituted`, `failed`, `missed`, `recovery`,
`feedback` or `unplanned` triggers as appropriate; completed/substituted outcomes
require an actual activity, and a ride cannot satisfy two workouts. Prefer
`updateFeedback` for feedback on an already matched activity.

Browser initialization uses `initializeCoaching()`. `coachingData()` returns
null while initialization is pending; actions require `coachingService()`.
Storage failures are surfaced, not replaced with an empty successful result.

## Domain and provenance

The existing profile's `ftp`, `weight` and `measurement` are reused, rather than
adding another profile UI for equivalent fields. Coaching adds athlete `id`,
experience, time zone, typical/maximum weekly hours, `availableDays`,
`maxSessionMinutes`, `longRideDay`, optional per-day `dayPreferences`,
equipment booleans, and optional maximum/threshold/resting heart rate.
Profiles and goal inputs are frozen into decision snapshots/plan history.

Goals have `id`, `name`, `type`, `date`, priority A/B/C, active state and optional
`distanceKm`, `elevationM`, `expectedDurationMinutes`, `terrain`, `targetPower`,
`targetFTP`, `targetWKg`, `finishTimeMinutes` and `completionObjective`.
Long or mountainous declared demands change capability weights. Explicit FTP
and W/kg targets inform threshold gaps. There is no fabricated conversion from
terrain or finish time into predicted event power or physiological capacity.

Normalized rides retain source summaries in `original`, an optional
`rawReference`, `source`, `externalId`, `providerIds`, `syncedAt`, stream
availability, quality warnings and a calculation version. Recorded rides are
retained before a Coach profile exists; initial configuration recalculates
history with the declared athlete time zone and FTP where source values are absent.
Load metrics contain value, source, version, confidence, formula and inputs.
Normalized power is either source-supplied/weighted power or explicitly derived
from rolling 30-second averages' fourth powers. Average power is **never**
silently treated as normalized power. A derived normalized power requires
at least 30 contiguous one-second samples covering at least 90% of the ride.
Recorded timestamps with gaps do not become contiguous streams.

* IF = normalized power / FTP used for that ride.
* Power TSS = elapsed duration hours x IF squared x 100.
* Session-RPE load = elapsed duration minutes x RPE (0-10).
* HR load = elapsed minutes x HR-reserve fraction squared, using supplied
  average, resting and maximum HR. This is a labelled HR proxy, **not** TSS or
  clinical TRIMP. Invalid or missing HR-reserve inputs yield unavailable load.
* Work uses supplied kJ, otherwise integrated available power or an explicitly
  labelled average-power/duration estimate.

The load model chooses **one scale for a snapshot**, never a sum of power TSS,
HR load and RPE load. It prefers complete power load, then complete RPE load,
then complete HR load, otherwise duration minutes. Missing older values on the
selected scale are flagged. Load values from snapshots with different scales
are not directly comparable. Planned power-load points are normalized-power TSS forecasts from ideal
execution of the interval steps, not measured load, and are labelled separately.
They use the same rolling-power calculation as actual streams, including
interval transitions; a simple mean of squared interval powers would
underestimate variable-intensity load.

Data levels: A = power/HR streams plus RPE; B = summary power/HR plus RPE;
C = HR plus RPE; D = duration plus RPE; E = duration only or incomplete richer
inputs. Actual available metrics are retained even when feedback is missing.
Weak inputs never acquire fabricated power or capability values.

## Defaults and limits

Defaults are versioned in `domain.js`, not universal physiological laws.
Historical windows, time constants and multi-zone thresholds can be supplied
to `estimateState` through its options argument.

| Setting | Initial value / rule |
|---|---|
| Short / medium / long history | 7 / 28 / 84 days |
| Chronic / acute exponential time constants | 42 / 7 days; daily coefficient `1 - exp(-1 / days)` |
| Weekly metrics / ramp-rate difference | Last 7 days / chronic-load difference over 7 days |
| Recent subjective concerns | Last 3 days |
| Supported-data threshold | At least 8 medium-window rides, each level A or B |
| Weekly volume/load growth ceiling | 5%; 2.5% with weaker data |
| Growth reference | Maximum scheduled volume/load in preceding four weeks, with absolute availability caps |
| Initial duration | No greater than typical/maximum hours, day capacity, medium-window weekly average and recent weekly duration |
| No history / recent inactivity | At most 90 initial minutes, further bounded by history and availability |
| Initial power-load envelope | Also bounded by observed recent and medium-window average power load, when on a power scale |
| Recovery | Every fourth training week, 70% of the preceding envelope |
| Taper | 55% of the envelope; starts 7 / 4 / 2 days before an A / B / C goal |
| Hard sessions | At most 2/week (1 for beginners), none with weak data or recovery concerns |
| Hard-session separation | At least one easy/rest day |
| Demanding interval time | No more than 20% of weekly scheduled time |
| Minimum useful session | 10 minutes; shorter or overloaded sessions are omitted with warnings |
| Subjective recovery reduction | 30% |
| Missed/failed/low-quality outcome reduction | 15% |

Recovery re-entry may return to a previously scheduled envelope, not jump beyond
the four-week envelope plus its growth ceiling. Recovery is not allowed to
compound into permanent volume decay. Both duration **and** step-based load are
validated; intensity progression cannot bypass the load ceiling.

Short lead times under 21 days use preparation and taper rather than compressing
build training. Other plans use assessment when data is weak, base, build,
specificity, peak, recovery, taper and event phases as time permits. The event
day is represented but not prescribed as another training session. There are no
guaranteed target FTP gains, finish times or inferred readiness-to-race claims.

Workout families cover recovery, endurance, durability, threshold, aerobic and
sprint work. Bounded progression levels increase interval duration, not intensity,
with conservative warm-up/recovery/cool-down steps. The scheduler respects
availability, long-ride preference, per-day duration and hard-session spacing.
Unschedulable targets are reduced and explained, never forced into another day.

## Estimation limitations

The load model initializes at zero over the supplied history. Missing imported
rides cannot be distinguished from rest, and CTL-like, ATL-like and form-balance
values are **modelled load indicators**, not direct biological measurements.
No history produces unavailable load estimates with low confidence.

Power-duration values are rolling observed bests at 5/15/30/60/180/300/720/
1200/1800/2400/3600 seconds, with watts, W/kg, date and context. Recent and longer
baselines are stored separately. An absent recent maximal effort is never
interpreted as a decline. Stream-derived bests do not declare themselves maximal.

The versioned CP fit uses least-squares `power = CP + W-prime / seconds`.
It requires three explicitly maximal efforts with distinct durations from
120-1200 seconds spanning at least 3:1. Fits need R-squared >=0.95, CP 50-600 W
and W-prime 1-50 kJ. These initial plausibility gates can reject unusual athletes;
unavailable is preferable to a fabricated fit. FTP remains separate from CP.
MAP is unavailable without a validated assessment protocol.

Power and HR zone seconds remain separate, with reference, thresholds and
version. Default power thresholds are 55/75/90/105/120/150% FTP; default HR
thresholds are 60/70/80/90% declared maximum HR. Three-zone summaries use
75/105% FTP and 70/90% maximum HR respectively. These are labelled heuristics,
not measured lactate/ventilatory thresholds. Summary-only rides cannot supply
time-in-zone distributions.

Durability observations require at least 60 minutes of paired one-second
power/HR data, discard the first 10 minutes, require steady 50-75% FTP power
(coefficient of variation <=10%) and valid HR. Power fade and HR/power decoupling
compare the remaining halves. Best-effort context records observations after
60 minutes. Unavailable data returns null with a reason; these measures do not
diagnose fatigue, illness or injury.

## Adaptation and persistence

Successful outcomes review but do not automatically increase already-planned
work. Failure, low completion quality, missed work and subjective concerns
reduce future prescriptions. Large unplanned rides consume the week's remaining
load budget. Later substitution/feedback does not count the same ride's load
twice. Completed and past-dated workout prescriptions remain unchanged; future
workouts retain their stable identifiers when modified. There are no catch-up
sessions, automatic FTP increases, or increased levels in response to missing
maximal efforts.

Every adaptation records its trigger, old/new revisions, source snapshot,
observations, added/removed/moved/modified/resolved workouts as applicable, load
change, deterministic reason, validation warnings, version and timestamp.
Resolved outcomes update completion/success statistics in the new snapshot.
Repeated imports, recordings and identical feedback are idempotent.

The dedicated `athlima-coaching` IndexedDB database stores the complete coaching
bundle in an atomic transaction: normalized history, versioned snapshots,
complete plan revisions and adaptation records. It is independent of the
seven-ride FIT cache and does not inherit localStorage's small quota.
Transactions resolve only after commit; a failed write preserves the previous
in-memory revision and reports an error. Concurrent-tab writes are rejected
instead of silently overwriting history. The UI can export the complete bundle
as JSON for inspection/backup; raw JSON rides can be imported, but restoring an
entire exported bundle through the UI is not implemented.

Storage is browser-local and browser quotas/eviction still apply. Export a
backup before clearing site data. Coaching never uploads history itself;
existing activity-upload integrations continue to operate independently.

## Verification

```sh
npm test -- --runInBand test/coaching test/views/training-calendar.test.js
npm run build
```

Tests cover exact load formulas and provenance, all data levels, rolling best
powers, synthetic known CP/W-prime, rejected fits, configurable windows,
separate zones, suitable/unsuitable durability inputs, every initial goal type,
availability/date matrices, initial and progressive load bounds, periodisation
and recovery re-entry, structured player/ZWO compatibility, matching,
future-only adaptation, immutable revision history, duplicate events, failed
persistence, IndexedDB restoration/conflicts, and the calendar form workflow.
