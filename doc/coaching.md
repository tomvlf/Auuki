# Adaptive cycling coaching

The **Coach** view is a deterministic training support system, not a medical
professional. It does not diagnose illness or injury, and it does not infer a
biological state of readiness. It uses no LLM or third-party AI account for
planning. Calculations reuse pure coaching modules; outcomes are heuristics, not
validated physiological predictions.

Coaching, planning, the workout player and trainer engine run locally in the
browser. No login or backend is required. See the [storage and migration
guide](backend.md) for local backups and recovery details.

On the Ride screen, choose a library workout before starting. Finishing a ride
shorter than one minute offers the choice to save or discard it. In Activities,
delete an Athlima recording to remove its local FIT file and coaching history.
Previous plan decisions and uploads to external services are not undone;
an external copy may reappear when that service is synchronized. Existing
downloaded backup files are not changed until you create new ones.

Consumer power meters, heart-rate sensors and other wearable data can be
incomplete, noisy or inaccurate. Missing data is not evidence of rest or
readiness. HRV is not currently used; neither HRV nor sleep quality should be
used as an isolated verdict about whether to train.

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
**Why this plan?** explanation. The **Training plan** page shows the whole plan:
progress towards the goal and the next session, a colour-coded phase timeline
with a plain-language legend, and the plan week by week (this week open, the next
four weeks listed, earlier and later weeks folded away). Recent plan changes and
the technical planning rationale are kept in collapsed sections.

Sessions come from the built-in workout library where possible. For each day,
the Coach decides the session family, available duration and earned progression
level, then selects a safe library workout that fits. Dose fit is ranked ahead
of variety; variety breaks near-equal fits. Approved gentle cadence sessions
may be selected for optional skill practice in suitable endurance slots when
their fit is close to the best candidate. During adaptation, an already
selected workout is retained when it can be fitted safely. Adjustments appear
under the session ("Adjusted for you: …"). An interval template is reduced only
by complete repetitions. Warm-up, interval recovery and cool-down steps marked
as protected are not shortened to make a session fit. Library workouts with
unsupported free-ride sections, targets above the configured power limit, tests
and unapproved technique drills are not prescribed. When no safe template fits (for
example, a sprint slot), the Coach explains that it generated a conservative
session instead.

Progression levels are based on successfully completed or substituted sessions
with a sufficient match-quality score, not on how many workouts were scheduled.
After the configured number of successful sessions in a family, a later workout
may progress one level only if there is unused weekly load capacity. Missed,
failed or low-quality work does not earn progression. Day to day:

- Start generated sessions from the calendar, or export individual ZWO files.
   Day preferences, purpose, expected RPE and the reason for each session are
   recorded. ZWO powers are fractions of FTP, not absolute watts.
   Calendar session details show the coaching explanation with the workout metrics
   and power profile, with export and other available controls on a separate row.
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
   Direct Intervals.icu sync runs only while the app is open; its progress is
   saved locally for retry.

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
| Library Workout Fitter | `library.js`: `zwoTemplate`, `coachCatalogue`, `fitWorkout`, `chooseLibraryWorkout`, `prescribeWorkout` |
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

`CoachingService(storage, clock, rules)` composes history, snapshots, matching
and revision persistence. `rules` is optional and defaults to `DEFAULTS`;
validated rules are frozen into state snapshots and generated plan metadata.
Mutating methods are asynchronous and must be awaited:
`configure`, `importActivities`, `generate`, `recordRide`, `resolve`,
`updateFeedback`, `advance`, `archive`. `clock` returns an ISO timestamp.
`resolve` accepts `completed`, `substituted`, `failed`, `missed`, `recovery`,
`feedback` or `unplanned` triggers as appropriate; completed/substituted outcomes
require an actual activity, and a ride cannot satisfy two workouts. Prefer
`updateFeedback` for feedback on an already matched activity.

Browser initialization uses `initializeCoaching()`. `coachingData()` returns
null while initialization is pending; actions require `coachingService()`.
Storage failures are surfaced, not replaced with an empty successful result.

## Decision priority

The Coach applies decisions in this order; a lower item cannot override a
higher one:

1. **Validate inputs and data quality.** Invalid profiles, unsupported goals,
   malformed workouts and incompatible measurements are rejected or marked
   unavailable. Weak history disables hard sessions rather than being treated
   as evidence of fitness.
2. **Apply safety and capacity limits.** Readiness concerns, available days,
   daily/weekly time, load progression, hard-session spacing, power limits and
   demanding-time limits constrain which session families and workout doses
   are eligible.
3. **Choose phase and goal focus.** The date and goal-weighted capability
   priorities select a phase and, when allowed, the highest-priority hard
   capability.
4. **Fit eligible templates to the slot.** Candidates must match the session
   family and pass structural, duration, power and intensity-time checks before
   they are scored.
5. **Minimize dose changes, then use variety as a tie-breaker.** Approved
   cadence practice is an optional exception in endurance slots when its fit
   score is within the configured tolerance. During
   adaptation, preserve the current template if it still fits safely. If no
   template fits, use an explained conservative fallback; if even that cannot
   fit the weekly budget, omit the session.
6. **Validate the complete plan.** `validatePlan` rechecks the schedule and
   raises an explicit error instead of returning an unsafe plan.

## Configuration guide

`DEFAULTS` in `src/coaching/domain.js` is the versioned developer configuration
for historical windows, readiness signals, CP/W-prime fit gates, periodisation,
progression, library fitting and schedule safety limits. `validateCoachingConfig`
merges overrides with defaults and rejects inconsistent ranges. The pure state
API accepts overrides as its fourth argument:

```js
estimateState(activities, profile, asOf, {
    readinessHighRpe: 8,
    progressionSuccessfulSessionsPerLevel: 4,
});
```

`CoachingService(storage, clock, rules)` accepts the same rules object. A
generated plan stores its effective `coachingConfig` and successful-session
baseline so later validation and adaptation use the same decisions. These are
developer-level settings, not athlete-facing recommendations. Changing a
threshold does not make it physiologically valid: thresholds and rule changes
must be reviewed against representative data and independently validated before
use. Do not tune a safety threshold merely to make a plan pass.

## Decision-flow example

For illustration, take a gran-fondo goal with a declared 160 km distance,
2,500 m climbing and a 6-hour expected duration. Its base weights are
endurance 5, threshold 3, aerobic 2, sprint 1 and durability 4. The long-event
and climbing rules add 2 to durability and 2 to threshold, giving weights
`[5, 5, 2, 1, 6]`, normalized by their total of 19. With no explicit FTP or
W/kg target, the threshold gap remains **unknown**; it is not fabricated.

If the plan is in a build phase, history is sufficiently complete, readiness
has no caution signal, and the athlete has room for a hard session, threshold
is the first eligible hard capability in the goal-priority ordering. The
scheduler then allocates an available slot (for example 45 minutes) and
respects the hard-session count and spacing limits. The fitter parses the
threshold templates, rejects any candidate that exceeds its power or demanding
time limits, preserves complete interval repetitions and protected steps, and
compares the remaining templates by the amount of dose adjustment. Variety is
considered only among near-equal fits. The selected steps must sum to exactly
45 minutes; load and weekly constraints are checked before the entire plan is
accepted. If no template fits, the Coach explains its generated fallback or
omits the session if the load budget cannot accommodate it.

## Domain and provenance

| Term | Meaning in this implementation |
|---|---|
| FTP | Athlete-declared functional threshold power; it is not inferred from CP. |
| IF | Normalized power divided by the FTP used for that ride. |
| Power TSS | Duration in hours × IF² × 100; a modelled training-load estimate. |
| CP / W′ | Two-parameter fit `power = CP + W′ / seconds`; CP is watts and W′ is joules. |
| Readiness `caution` | Combined configured subjective signal score reaches its threshold; not a diagnosis. |
| Readiness `monitor` | Subjective signals are present but below the combined caution threshold; they do not reduce training. |
| Progression level | A bounded workout-template dose level earned from successful completed sessions. |
| Hard session | A workout family marked hard by the planner; its count and spacing are independently constrained. |

These terms describe implementation values and are not interchangeable with
clinical measurements or validated laboratory thresholds.

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
Historical windows, time constants, readiness limits, CP/W-prime fit gates,
progression criteria, library dose limits and schedule caps can be supplied to
`estimateState` or `CoachingService` through their rules/configuration argument.
All defaults are initial engineering heuristics, not scientifically validated
athlete-specific thresholds.
Configuration validation also requires the caution threshold to exceed the
sleep-only score, so sleep quality cannot independently trigger a readiness
caution.

| Setting | Initial value / rule |
|---|---|
| Short / medium / long history | 7 / 28 / 84 days |
| Chronic / acute exponential time constants | 42 / 7 days; daily coefficient `1 - exp(-1 / days)` |
| Weekly metrics / ramp-rate difference | Last 7 days / chronic-load difference over 7 days |
| Recent subjective concerns | Configured 3-day window |
| Sleep-quality signal | One point toward the default three-point caution threshold; never an isolated verdict |
| Other subjective signals | High RPE, low leg freshness and high soreness add 2 points each; high stress adds 1 |
| Supported-data threshold | At least 8 medium-window rides, each level A or B |
| Weekly volume/load growth ceiling | 5%; 2.5% with weaker data |
| Growth reference | Maximum scheduled volume/load in preceding four weeks, with absolute availability caps |
| Initial duration | No greater than typical/maximum hours, day capacity, medium-window weekly average and recent weekly duration |
| No history / recent inactivity | At most 90 initial minutes, further bounded by history and availability |
| Insufficient (low-confidence) history | Never starts below the no-history 90 minutes; a single short test ride cannot shrink the plan |
| Initial power-load envelope | Also bounded by observed recent and medium-window average power load, when on a power scale and the data level is sufficient |
| Recovery | Every fourth training week, 70% of the preceding envelope |
| Taper | 55% of the envelope; starts 7 / 4 / 2 days before an A / B / C goal |
| Hard sessions | At most 2/week (1 for beginners), none with weak data or recovery concerns |
| Hard-session separation | At least one easy/rest day |
| Demanding interval time | Library template <=18% of its slot; full plan <=20% of weekly time |
| Minimum useful session | 10 minutes; shorter or overloaded sessions are omitted with warnings |
| Subjective recovery reduction | 30% for non-sleep caution signals |
| Missed/failed/low-quality outcome reduction | 15% |
| Short-term adaptation window (`adaptationWindowDays`) | 7 days; reductions apply only inside it, are held until it ends and never change later sessions |
| High-RPE readiness signal (`readinessRpeMargin`) | RPE above `max(readinessHighRpe, planned expected RPE + 2)`, capped at 10 |
| Workout progression | One level per 3 successful sessions in that family, only within unused load budget |
| CP fit | At least 3 explicit maximal efforts, 120-1200 s, >=3:1 span, R-squared >=0.95 |
| CP plausibility gate | 50-600 W CP and 1-50 kJ W-prime |

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
sprint work. Progression levels are earned from successful outcomes, not
scheduled-workout counts; a next-level dose is used only when it fits the
remaining weekly load budget. Complete interval repetitions and any
template-designated warm-up/recovery/cool-down steps are preserved. The
scheduler respects availability, long-ride preference, per-day duration and
hard-session spacing. Unschedulable targets are reduced and explained, never
forced into another day.

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
Its default gates require three explicitly maximal efforts with distinct
durations from 120-1200 seconds spanning at least 3:1. Fits need R-squared
>=0.95, CP 50-600 W and W-prime 1-50 kJ. These initial plausibility gates can
reject unusual athletes; unavailable is preferable to a fabricated fit. The
gates are configurable but have not been independently validated for every
athlete population. FTP remains separate from CP. MAP is unavailable without a
validated assessment protocol.

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

Successful outcomes can earn a later progression after the configured number
of sufficiently well-matched completed/substituted sessions in that family;
the change is only made when weekly load headroom permits it. Failure, low
completion quality, missed work and non-sleep subjective caution signals reduce
future prescriptions. Poor sleep alone is monitoring only. Large unplanned
rides consume the week's remaining load budget. Later substitution/feedback
does not count the same ride's load twice. Completed and past-dated workout
prescriptions remain unchanged; future workouts retain their stable identifiers
when modified. There are no catch-up sessions or automatic FTP increases, and
missing maximal efforts never earn progression.

Short-term reductions are bounded in time and structure:

* Reductions (caution, missed, failed or low-quality outcomes) only change
  sessions inside the next `adaptationWindowDays` (7). Sessions after the
  window keep their exact planned family, duration and steps. Every reduced
  future workout keeps an `original` snapshot recording the planned dose, the
  window end (`until`), the reduction factor and whether it was made easy.
* A reduction is held until its window ends. A later, less cautious event
  inside that window (feedback, a missed session after "Make upcoming training
  easier", a good completion) cannot lengthen or harden a held session. A
  stricter event (lower factor, or easy when the held session was not) can
  still tighten it, and the window then moves to the new end date.
* Reduced sessions from plans adapted before windows were recorded (an
  `original` without `until`) are restored to their planned dose by the next
  adaptation, with the note "Restored to the planned session after the
  short-term adjustment ended."
* Missed or failed sessions shorten nearby sessions within the same workout
  family; they do not convert the plan to recovery rides. Only a readiness
  caution or the "Make upcoming training easier" action lowers intensity.
* When a week cap must shrink, the reduction is shared proportionally across
  that week's sessions. The adapter first shortens a session within its
  planned family (5-minute steps, never below the 10-minute minimum) and only
  falls back to a recovery ride if no in-family dose fits.
* The ramp envelope is seeded with the plan's initial limits. Each week stores
  its validated planned dose (`plannedMinutes`, `plannedLoad`). The growth
  ceiling uses the larger of the scheduled and planned dose of earlier weeks
  (`rampReference`, clamped to the week's targets), so a short-term cut does
  not lower the cap of later weeks. A week still never exceeds its own
  original dose, and no catch-up is added.

Every adaptation records its trigger, old/new revisions, source snapshot,
observations, added/removed/moved/modified/resolved workouts as applicable, load
change, deterministic reason, validation warnings, version and timestamp.
Resolved outcomes update completion/success statistics in the new snapshot.
Repeated imports, recordings and identical feedback are idempotent.

In local mode, the dedicated `athlima-coaching` IndexedDB database stores the complete coaching
bundle in an atomic transaction: normalized history, versioned snapshots,
complete plan revisions and adaptation records. It is independent of the
seven-ride FIT cache and does not inherit localStorage's small quota.
Transactions resolve only after commit; a failed write preserves the previous
in-memory revision and reports an error. Concurrent-tab writes are rejected
instead of silently overwriting history. The UI can export the complete bundle
as JSON for inspection; raw JSON rides can be imported. Settings > Local backup
downloads and restores the entire coaching bundle together with device data.

Storage is browser-local and browser quotas/eviction still apply.
Export a backup before clearing site data. There is no automatic synchronization
between browsers, devices or old server accounts.

## Adding a workout template

1. Append a well-formed ZWO string to `src/workouts/workouts.js`; do not
   reorder existing templates because their built-in IDs are index based.
2. Use elements the fitter understands: `Warmup`, `Cooldown`, `Ramp`,
   `SteadyState`, and `IntervalsT`. Avoid `FreeRide` and tests
   for Coach-eligible templates. Power values are FTP fractions.
3. Ensure interval work is represented as complete on/off repetitions.
   Warm-up, interval recovery and cool-down are protected when parsed; the
   fitter removes only complete repetitions and trims only unprotected easy
   riding. Its default minimum is two repetitions (or all repetitions if the
   template has fewer). Optional `Cadence` and `CadenceResting` targets are
   retained through fitting, playback and export; missing cadence is not
   replaced by an invented target.
4. Add or verify its category-to-family mapping in
   `src/coaching/library.js` (`CATEGORY_FAMILIES`). For a template requiring
   stricter minimums, add `minimumEfforts`, `minimumWarmupSeconds` and/or
   `minimumCooldownSeconds` to `TEMPLATE_RULES`, keyed by the exact template
   name. A template with missing structure or out-of-range power is rejected.
   Technique sessions are excluded unless explicitly reviewed and added to
   `TECHNIQUE_TEMPLATES`; do not approve a session solely because its category
   is Technique. Its cadence steps must be suitable for gentle endurance
   practice and are protected from shortening or repetition removal.
5. Add parser, minimum-dose, exact-duration, power-limit and hard-time-share
   tests to `test/coaching/library.test.js`. Run that test file and the broader
   coaching suite before using the template in plans.

### Recently added library workouts

The library includes three additional long aerobic options (2h, 2h45 and
3h15), a 2x20 tempo session, a 4x8 sweet-spot session, a 3x8 threshold
template and a 4x4 VO2 session. The Coach can reduce interval repetitions to
stay within the configured hard-time limit. The long rides stay within the configured
endurance power ceiling and include reminders to pace and fuel them sensibly.
These are original Athlima templates informed by established workout formats,
not copied workout files or guarantees of a particular adaptation.

References consulted:

* [Seiler et al., "Adaptations to aerobic interval training: interactive
  effects of exercise intensity and total work duration"](https://pubmed.ncbi.nlm.nih.gov/21812820/)
  (peer-reviewed study; informs interval duration/structure, not a universal
  power prescription).
* [British Cycling indoor training sessions](https://www.britishcycling.org.uk/knowledge/skills/article/izn20150901-Indoor-Training-Sessions-0)
  (examples of structured indoor session design).
* [TrainerRoad sweet spot training overview](https://www.trainerroad.com/blog/sweet-spot-training-everything-you-need-to-know/)
  (practical context for sweet-spot intensity).

The Coach still selects and fits templates against each rider's available
time, family, progression level, safety limits and load budget. A listed
2-hour-or-longer template is not automatically prescribed at full length; the
planned dose and the rider's current constraints take priority.

### Cadence practice

The original Cadence Foundations 30, Cadence Control 40 and Cadence Endurance 50
templates alternate moderate cadence targets at easy power, with warm-up and
cool-down. They are inspired by the general practice of varying cadence on easy
rides, not copies of a specific workout. [TrainerRoad's cadence overview](https://www.trainerroad.com/blog/whats-the-most-efficient-cycling-cadence-and-how-cadence-drills-can-make-you-faster/)
discusses individual and situational variation; its benefit claims should not be
interpreted as proof that any particular drill is necessary or effective for a
given rider.

The Coach explicitly opts in only those three built-in templates, never the
older, more demanding Cadence Drills. They are eligible only in endurance slots
in assessment, base or build phases, not recovery, taper, hard or long-ride
slots. Caution readiness schedules recovery instead. By default, new selections
are at least seven days apart (`libraryTechniqueSeparationDays`), and their
fitting score must be within 0.15 (`libraryTechniqueFitTolerance`) of the best
eligible template. Existing time, power, intensity and weekly load constraints
still apply. Adaptation can retain an already selected drill when it still fits,
but does not introduce new technique sessions, and forced-easy adaptations do
not use them. The cadence-targeted intervals, including recoveries, are never
trimmed or removed; if they do not fit, another session is chosen.

This is optional practice, not evidence that the rider has a cadence deficiency
or a prescribed optimal cadence. Library cards show the target range and
whether other parts are self-selected; details show each target. Keep the pedal
stroke relaxed, choose a comfortable cadence if bouncing or uncomfortable, and
stop for pain. Coaching support does not diagnose illness or injury.

## Adding a readiness rule

1. Add its threshold to `DEFAULTS` in `src/coaching/domain.js` and validate its
   range in `validateCoachingConfig`; do not add an unvalidated magic number to
   the planner.
2. Add the observation and reason to the readiness classification in
   `src/coaching/state.js`. Keep missing values explicitly unavailable. Sleep
   and any future HRV signal are context only unless corroborated by a distinct
   non-sleep signal; no one consumer metric is a verdict.
3. Decide explicitly whether the rule is `monitor` or `caution`. Only readiness
   status `caution` reduces training or suppresses hard sessions based on
   readiness; missed/failed outcomes have their own adaptation rules. Do not
   diagnose illness or injury.
4. Add tests for missing data, a single signal, corroborating signals,
   configured threshold overrides and the resulting plan/adaptation.
5. Document the rationale and limitations, and have the threshold reviewed
   against representative data by qualified domain experts before deployment.
   Passing software tests is not physiological validation.

## Verification

```sh
npm test -- --runInBand test/coaching test/views/training-calendar.test.js
npm test -- --runInBand   # full suite, including IndexedDB, service-worker and backup tests
npm run build
```

Tests cover exact load formulas and provenance, all data levels, rolling best
powers, synthetic known CP/W-prime, rejected fits, configurable windows,
separate zones, suitable/unsuitable durability inputs, every initial goal type,
availability/date matrices, initial and progressive load bounds, periodisation
and recovery re-entry, structured player/ZWO compatibility, matching,
future-only adaptation, immutable revision history, duplicate events, failed
persistence, IndexedDB restoration/conflicts, and the calendar form workflow.

### Threshold validation with representative data

The defaults were exercised with synthetic rider archetypes (beginner with RPE
only, intermediate, advanced, time-crunched, returning, no history) across all
goal types and lead times: 162 plans, all valid and non-empty. Readiness was
simulated over 26 weeks for normal, hard-block, life-stress and fatigued
riders; after comparing high RPE with the planned effort, false caution rates
fell (normal 13% to 10%, hard block 38% to 31%, life stress 35% to 28%) while
the fatigued rider was still flagged on 82% of days. A single caution used to
keep only about 68% of the remaining planned volume because every future
session was downgraded. Across 90 adaptation dates of a 26-week plan, a
caution now keeps 97.1% of the remaining planned volume (69% inside the 7-day
window) and a missed session keeps 98.5% (84% inside the window). No session
outside the window changed, and every adapted plan passed `validatePlan`.

The coached workflow was also tested end-to-end in the browser: plan creation,
starting today's session from the calendar, step targets matching
`prescribeWorkout`, skipping intervals, finishing and saving the ride, and the
resulting adaptation (families preserved, only in-window sessions shortened).

These simulations use synthetic data. They check software behaviour and
plausibility; they are **not** physiological validation of the thresholds.

### Known limitations

* With little or no history the plan starts at about 90 minutes per week split
  into short sessions, even with more availability, and grows only by the
  low-data ramp. Archive and regenerate the plan once enough rides are recorded.
* The per-session hard-time cap (18%) means threshold days use sweet-spot style
  sessions; true threshold/VO2 blocks would need a weekly hard-time budget.
* Planned recovery and taper weeks contain recovery-family rides only.
* Small leftover budget can produce 10-20 minute filler sessions.
* A very short recorded ride matched to today's session counts as a
  low-quality completion and triggers the 15% short-term reduction.
* The installed PWA service worker can serve outdated bundles during
  development; unregister it and clear caches before manual testing.
