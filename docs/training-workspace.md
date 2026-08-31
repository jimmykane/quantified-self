# Training Workspace Architecture and Maintenance Guide

This document is the implementation guide for the authenticated `/training` workspace. It is intended for product
engineers, data engineers, reviewers, and AI coding agents. Update it whenever the Training product contract, a derived
metric payload, the sports-lib durability protocol, or the refresh pipeline changes.

Current compatibility baseline:

- Quantified Self derived-metric schema: `18`
- `@sports-alliance/sports-lib`: `20.3.0`
- Training sport families: Running, Cycling, Swimming, Rowing, Walking & Hiking, Nordic Skiing, Strength, and Paddling
- Imported FTP/VO2 capacity disciplines: Running and Cycling only
- Rolling power-system capacity: every exact canonical activity type with usable persisted power curves
- Calendar boundaries: UTC unless a section explicitly says otherwise

## Product Contract

Training is a curated analytical workspace, not a second configurable dashboard. Its purpose is to answer:

1. What is the athlete doing now compared with their normal training?
2. What caused the change in load?
3. How are fitness, fatigue, freshness, and intensity changing?
4. What recent performance evidence supports imported settings such as FTP or VO2 max, and what does the rolling
   power-duration evidence support for CP, W′, and Pmax?
5. Is long-session durability changing?
6. How does the current build compare with a deliberately selected historical build?
7. What recovery and sleep context was recorded alongside those builds?
8. What do the available current load and recorded recovery signals say right now?

The following rules are architectural constraints:

- The frontend must not query activity or event history to calculate Training insights.
- The frontend must not download or reparse source files to calculate Training insights.
- Historical and comparative Training calculations belong in derived-metric builders or sports-lib, not Angular
  components. Readiness uses one environment-neutral formula in `shared/readiness.ts`: the frontend applies it to live
  Form/ramp plus bounded sleep evidence, while Functions applies it at each daily cutoff for the historical series.
- Dashboard remains the user's modular chart and map surface. The current TSS-only Training state and recovery-aware
  Readiness are fixed parts of the optional Dashboard Today summary rather than configurable tiles, while Training owns
  their deeper current and historical presentation.
  Curated Training-only insights do not become hidden Dashboard dependencies. An explicitly configured Dashboard Aerobic
  Capacity or Aerobic Durability tile may opt into only its matching Training snapshot kind.
- Missing TSS, zones, pace, sleep, power, heart rate, or durability evidence remains unavailable. Missing values are not
  converted to zero.
- Merged benchmark events are excluded from Training. Multisport parent events are retained, but their normalized child
  activities are classified and counted separately.
- Changing the Training destination changes presentation only. **All training** owns global state, readiness, load,
  sleep, body-weight, intensity, and the compact cross-sport mix. A sport destination owns that family's detailed mix,
  Best Build, rolling power types, and capability-matched specialist evidence. Neither destination nor shortcuts change
  derived calculations or discard a sport from the account.
- Sleep is context. It never changes the Training state and is not presented as a causal explanation of performance.
- Imported FTP and VO2 max values are settings or source observations. They are not silently relabeled as new estimates.
- Durability shown on Training comes only from the persisted sports-lib `Durability Evidence` activity stat.
- Standard mountain biking retains the steady-aerobic Cycling durability protocol. Enduro MTB and Downhill Cycling are
  gravity contexts: they use reliable recorded summaries only, are volume-only for Training load/intensity, and are
  explicitly ineligible for durability. Training does not infer downhill runs or lift/uplift segments.
- Rowing participates in Training Mix and Best Build, but it does not have a durability adapter in this release.
- The parser does not generate CP, W′, Pmax, or three-dimensional workout strain. Rolling power-system capacity is a
  Training-derived snapshot built from persisted activity power curves and Sports-lib's public dated-capacity fitter.
- Rolling capacity is isolated by exact canonical activity type. It is separate from TSS, Form, Readiness, and imported
  FTP, and only components that pass Sports-lib's `ready` gates expose a value.
- Power systems remains available to every authenticated user, but its exact activity types are routed into the matching
  registered sport destination. Canonical types outside the registry are routed to **Other power activities**. No
  combined all-sports capacity value is created.
- Complex cards lead with a plain-language conclusion, followed by an explicit, calm evidence-quality statement. A
  `What to look at next` prompt appears only when the available evidence supports that specific follow-up; it is never a
  workout prescription. Numeric tables remain compact source-of-truth comparisons and retain their deltas.
- In athlete-facing Training copy, a recorded sport leg is called a **workout**. `Activity` remains the technical term
  for normalized Firestore and sports-lib records, and `sleep session` remains the term for overnight sleep data.
- Bounded current scores use the shared lightweight metric indicator rather than a chart instance. Readiness uses a
  0–100 track with its canonical 55 and 75 category boundaries; eligible source sleep scores use a 0–100 track without
  inventing new thresholds. Four discrete segments communicate readiness signal coverage independently from score and
  confidence. HRV and Overnight HR use a baseline-centered ±20% display while retaining the exact ratio text and the
  metric-specific direction (lower Overnight HR may be supportive). Score fills start at zero and remain visible beneath
  their threshold markers. Missing evidence leaves an empty track, never zero.
- Training-time and workout-count comparisons may use the same baseline-centered visual, but CTL, ATL, Form, ramp,
  ACWR, monotony, strain, FTP, VO2 max, recovery time, and power-system capacity must not be normalized into arbitrary
  0–100 bars. Those metrics retain exact values, semantic status/delta treatments, or their existing time-series charts.
  The shared indicator is native HTML/CSS for accessibility and low per-row cost; ECharts remains reserved for actual
  trends, distributions, forecasts, and interactive chart surfaces.

## Ownership: Sports-lib Versus Quantified Self

| Concern | Owner | Source of truth |
| --- | --- | --- |
| Canonical activity types and activity groups | sports-lib | `src/activities/activity.types.ts` in sports-lib |
| Sport-aware Cadence versus Stroke Rate semantics | sports-lib | `src/activities/activity.metric-semantics.ts` in sports-lib |
| Activity-level durability input selection | sports-lib | `src/events/utilities/activity-durability.ts` |
| Activity-level durability eligibility and formulas | sports-lib | `activity-durability.ts` and `data.durability-evidence.ts` |
| Compact durability stat creation and invalidation | sports-lib | `activity.utilities.ts` and the durability source fingerprint |
| Power-curve interpolation and window comparison | sports-lib | `src/events/utilities/power-curve-sampling.ts` |
| Dated power-duration envelope and confidence-gated CP/W′/Pmax fitting | sports-lib | `src/events/utilities/three-dimensional-capacity.ts` |
| Curated Training disciplines | Quantified Self shared layer | `shared/training-disciplines.ts` |
| Joining normalized activities to parent events | Quantified Self Functions | `functions/src/derived-metrics/derived-metrics.service.ts` |
| Exact-type 42-day window policy and rolling capacity history | Quantified Self Functions | `training_power_systems` builder in `derived-metrics.service.ts` |
| Current, usual, weekly, and benchmark windows | Quantified Self Functions | derived-metric builders |
| Derived snapshot persistence and refresh | Quantified Self Functions | coordinator, triggers, ingress worker, and derived worker |
| Workspace destination and shortcut preferences | Quantified Self frontend | owner-writable `appSettings.trainingWorkspace` |
| Training benchmark settings | Quantified Self Functions/shared contracts | authenticated benchmark callable and `shared/derived-metrics.ts` |
| Payload validation and view models | Quantified Self frontend | `dashboard-derived-metrics.service.ts` and Training helpers |
| Shared readiness scoring, labels, and confidence | Quantified Self shared layer | `shared/readiness.ts` |
| Historical 14-day readiness series | Quantified Self Functions | `training_readiness` derived builder |
| Layout, wording, empty states, and charts | Quantified Self frontend | `training-workspace.component.*` and child components |

In short:

```text
sports-lib answers:       Is durability valid, and what CP/W′/Pmax fit is supported by the dated curves supplied?
Quantified Self answers:  Which exact-type curves belong in each 42-day window, and how is the result persisted and shown?
```

Do not duplicate sports-lib durability formulas or the CP/W′/Pmax fitter inside Functions. Functions owns the dated
window policy and passes the resulting curves to Sports-lib. Do not move Training history queries into the frontend.

## Architecture Overview

```mermaid
flowchart TD
    A["Imported or uploaded event"] --> B["sports-lib parses activities and stats"]
    B --> C["Normalized event document"]
    B --> D["Normalized child activity documents"]
    B --> E["Compact Durability Evidence stat"]
    E --> D
    C --> F["Event/activity write ingress"]
    D --> F
    S["Sleep session write"] --> G["Targeted sleep ingress"]
    S --> P["Bounded 30-day live sleep listener"]
    U["Training benchmark callable"] --> H["Training settings"]
    U --> I["Mark training_build_comparison dirty"]
    V["Destination and shortcuts"] --> W["Direct owner Firestore write: appSettings.trainingWorkspace"]
    F --> J["Derived-metrics coordinator"]
    G --> J
    I --> J
    H --> K["Derived-metrics worker"]
    J --> K
    C --> K
    D --> K
    S --> K
    K --> R["training_readiness: Form seed + bounded sleep envelope"]
    R --> L["Per-kind derived snapshot documents"]
    K --> PS["training_power_systems: exact-type [D-42, D) capacity fits"]
    PS --> L
    K --> L
    L --> M["Angular snapshot listeners"]
    M --> N["Payload normalizers and view-model helpers"]
    N --> O["Curated Training workspace"]
    W --> O
    M --> Q["Shared live readiness formula"]
    P --> Q
    Q --> O
```

The page is eventually consistent. A complete event/activity historical scan happens in the worker, never in the
browser. The browser can continue showing the latest complete payload while a newer generation is building. The only
live contextual read added by Readiness is the bounded sleep-session listener shown above; it does not read event or
activity history. A readiness-only worker refresh reuses a compatible Form snapshot seed and fetches only the bounded
sleep envelope, so it does not perform a new event or activity scan. Event-driven all-metric builds still share their
already-loaded Form history, and the existing sleep-triggered Best Build comparison retains its broader dependencies.

## Route and Frontend Entry Points

- Route: `src/app/app.routing.module.ts`
- Public SEO overview: `/features/training-analysis` via `src/app/components/public-seo/public-seo-pages.content.ts`
- Lazy routing module: `src/app/training.routing.module.ts`
- Angular module: `src/app/modules/training.module.ts`
- Workspace controller: `src/app/components/training/training-workspace.component.ts`
- Workspace template: `src/app/components/training/training-workspace.component.html`
- Workspace styles: `src/app/components/training/training-workspace.component.scss`
- Shared readiness formula: `shared/readiness.ts`
- Shared readiness snapshot validator: `shared/training-readiness-metric.ts`
- Historical readiness builder: `functions/src/derived-metrics/derived-metrics.service.ts`
- Benchmark dialog: `src/app/components/training/training-build-benchmark-dialog.component.*`
- Sport-shortcuts dialog: `src/app/components/training/training-sport-visibility-dialog.component.*`
- Mobile destination sheet: `src/app/components/training/training-mobile-destination-sheet.component.*`
- Swimming chart: `src/app/components/training/training-swim-performance-chart.component.*`
- Durability trajectory: `src/app/components/training/training-durability-trajectory-chart.component.*`
- Readiness history chart: `src/app/components/training/training-readiness-trend-chart.component.*`
- Body-weight trend chart: `src/app/components/training/training-body-weight-trend-chart.component.*`
- Shared status/comparison cards: `src/app/components/shared/training-summary/training-summary-cards.component.*`
- Shared exact-value metric grid: `src/app/components/shared/training-summary/training-metric-grid.component.*`
- Snapshot service: `src/app/services/dashboard-derived-metrics.service.ts`
- Shared payload contracts: `shared/derived-metrics.ts`
- Shared discipline registry: `shared/training-disciplines.ts`
- User help copy: `src/app/shared/help.content.ts`

Training is available to signed-in users from the sidenav. Its route header uses the shared `app-page-header` route
primitive, with a Feedback action that opens the configured support email with a Training-specific subject, plus direct
**Calendar** and **Dashboard** route actions. Dashboard offers **Open Training** and **Calendar** route actions, but does
not add curated Training snapshots as default Dashboard dependencies or configurable tiles.

The lightweight status/comparison cards and exact-value load grid are shared presentation primitives. The authenticated
Training workspace supplies their live, normalized view models; the public homepage supplies a static example view model
and selects the compact preview density. These components own the repeated semantic markup, numeric token formatting,
indicator placement, and responsive layout, but they never subscribe to data, calculate a metric, initialize a chart,
or access browser-only APIs. Training remains the source of truth for calculations and athlete-specific wording, while
the homepage remains safe to render during SSR and prerendering.

The authenticated `/training` route is deliberately `noindex`. Its public, prerendered `/features/training-analysis`
overview is the indexable search entry point: it describes the curated workspace, sports, derived-data boundaries, and
non-prescriptive treatment of readiness and sleep without exposing account-specific data. Keep that public page, the
Features hub, homepage link, Help link, sitemap, and `robots.txt` aligned when the Training product contract changes.

### Product analytics

The app-wide, consent-gated Firebase `screen_view` already records `/training` route visits, so Training must not emit a
second custom page-view event. The workspace records only these low-volume configuration outcomes through
`AppAnalyticsService.logEvent`:

- `training_destination_saved`: overview, sport, or Other destination type; registered sport family when applicable; and
  desktop-shortcut, desktop-selector, or mobile-selector source.
- `training_sport_shortcuts_saved`: automatic or fixed mode and saved-shortcut count.
- `training_benchmark_saved`: set or cleared action and discipline; successful saves also include event/manual reference
  mode and duration preset.

These events never include activity or benchmark IDs, dates, names, device details, sleep data, chart interaction, or
free text. Keep analytics at completed user-intent boundaries; do not add events for derived snapshot updates, scrolling,
hovering, search keystrokes, or chart rendering.

Frontend transformation responsibilities are intentionally split into focused helpers:

| Helper | Responsibility |
| --- | --- |
| `training-analysis.helper.ts` | Overall 28-day comparison and state inputs |
| `current-training-state.helper.ts` | Shared current Form/ramp source selection, CTL/ATL context, and TSS-only Training state for Training and Dashboard Today |
| `training-capacity.helper.ts` | Imported FTP/VO2 marker provenance |
| `training-power-systems.helper.ts` | Strict rolling-capacity normalization, registry/Other destination grouping, exact-type selector data, cards, and sparse trends |
| `training-derived-metrics.helper.ts` | Strict normalization of explanation, durability, and readiness-history payloads |
| `training-durability-view.helper.ts` | Context grouping, comparison rows, tones, and weekly trajectory models |
| `training-explanation-view.helper.ts` | Load, contributor, sport-driver, rhythm, and coverage cards |
| `training-power-profile.helper.ts` | 90-day versus one-year power retention |
| `training-card-guidance.helper.ts` | Plain-language outcomes, evidence quality, and evidence-gated next steps for build, load, and intensity cards |
| `dashboard-training-insights.helper.ts` | Live readiness adapter and bounded sleep window |
| `training-readiness.helper.ts` | Training-specific readiness wording, driver freshness, implication, and trend data |
| `training-recovery-estimate.helper.ts` | Imported recovery countdown wording |
| `training-sport-visibility.helper.ts` | Automatic/fixed shortcut resolution, four-slot ranking, refresh-stable slot reconciliation, legacy fallback, and off-shortcut destination placement |
| `training-swim-performance.helper.ts` | Swim pace units plus pool/open-water conclusions and evidence-gated chart model |

## Firestore Data Model

Training reads or writes these user-scoped paths:

```text
users/{uid}/events/{eventId}
users/{uid}/activities/{activityId}
users/{uid}/sleepSessions/{sleepSessionId}
users/{uid}/config/settings
users/{uid}/derivedMetrics/coordinator
users/{uid}/derivedMetrics/{metricKind}
```

### Events

Parent event documents provide event identity, date, tags, merged-event classification, parent TSS, and display metadata.
Overall load and top contributors use parent-event TSS to avoid double-counting a multisport event.

The shared classifier treats `mergeType: 'benchmark'` and legacy `isMerge: true` as merged benchmark events. A
`mergeType: 'multi'` parent is a standard multisport event and remains eligible so its child legs can be analysed.

### Activities

Normalized child activity documents provide sport-specific stats and activity types. They are joined to their parent using
`eventID`. A child activity is ignored when:

- `eventID` is missing;
- its parent event does not exist;
- the parent is a merged benchmark event;
- its effective date is missing.

The join deliberately uses activity-level stats. Parent stats and `endDate` must not leak into a child leg. Provider and
device provenance may fall back to the parent when the child does not carry it. Functions creates one canonical joined
activity source per valid parent/child relationship. When Training Explanation is dirty, unsupported activity types
remain in that source with no curated discipline so it can report them as Other or Unclassified. When
`training_power_systems` is dirty, those sources are also retained so every canonical activity type with a usable power
curve can be fitted independently. Registry-driven Training Summary and Best Build builders use the eight curated
families and ignore unregistered sources; Explanation retains unregistered sources only for Other/Unclassified coverage.
The join retains references to the selected child and parent data instead of cloning a second activity metric object.

### Sleep sessions

Training uses main overnight sleep sessions for contextual comparisons. Naps are excluded. The backend has two narrow
sleep sources: `training_build_comparison` fetches the 28/84-day and selected build ranges, while `training_readiness`
fetches a bounded sleep-end envelope of about 43 days. That envelope lets each of the 14 daily cutoffs independently
apply the canonical 30-day sleep lookback without querying event or activity history. Separately, Training Readiness and
the fixed Dashboard Today Readiness summary each use the same bounded live-query contract: it is lower-bounded to the
last 30 days, keeps an open upper bound for newly imported nights, and never loads event or activity history. A local
refresh timer re-evaluates the shared result when a future-dated record becomes eligible, the latest night reaches its
48-hour limit,
or a night leaves the 30-day baseline window; it reschedules after every boundary and caps long browser timers. Both
live and backend paths reject unknown providers or invalid sleep dates, ignore non-positive physiological samples, and
discard unusable timezone offsets instead of letting malformed evidence change or break the result. The backend readiness
projection must include average and minimum sleep HR as well as HRV fields; the shared formula gives average sleep HR
priority when building the single Overnight HR driver.

Sports Lib 20.3 stores normalized Sleep aggregates in an internal versioned canonical JSON envelope alongside the
rollback-safe legacy scalar fields. Both backend Training field masks select only their required nested envelope slots
and strictly rehydrate them before applying the existing sleep evidence rules; the bounded live frontend path uses the
same shared decoder. Legacy, mixed, and new-only scalar documents therefore produce the same readiness and Best Build
inputs. This changes no
formula, derived payload, schema version, refresh dependency, provider rule, or public MCP projection.

### Settings

The settings branch is:

```ts
settings: {
  appSettings: {
    trainingWorkspace?: {
      preferredDestination?: 'overview' | TrainingSportId | 'other-power';
      sportShortcuts?: TrainingSportId[] | null;
    };
  };

  trainingSettings: {
    /** Deprecated: read only as a migration fallback for sport shortcuts. */
    visibleDisciplines?: TrainingSportId[];
    buildBenchmarks?: Partial<Record<TrainingSportId, TrainingBuildBenchmarkSelection>>;
  };
}
```

`preferredDestination` is account-scoped UI state. Missing, malformed, or unknown values normalize to `overview`.
`sportShortcuts: null` explicitly selects automatic shortcuts; a valid array pins one to four registry-ordered sports.
When `sportShortcuts` is absent, the frontend reads the legacy `trainingSettings.visibleDisciplines` value as a
compatibility fallback until a new shortcut preference exists. If neither exists, automatic selection ranks current
28-day evidence by duration and workout count, with a valid saved benchmark keeping an otherwise inactive sport eligible.
The legacy field is no longer written.
Benchmark selections remain independent per discipline and stay under server-owned `trainingSettings`.

### Derived snapshots

Every metric kind has its own snapshot document. The important fields are:

```ts
{
  entryType: 'snapshot';
  metricKind: DerivedMetricKind;
  schemaVersion: number;
  status: 'ready' | 'building' | 'failed' | 'stale';
  updatedAtMs: number;
  builtFromEventMutationVersion?: number | null;
  sourceEventCount: number;
  payload: unknown | null;
  lastError?: string | null;
}
```

The coordinator owns `generation`, `eventMutationVersion`, dirty kinds, processing state, timestamps, and the last error.
A generation claim prevents an old Cloud Task from overwriting a newer request.

## Training Sport Registry and Contexts

`shared/training-disciplines.ts` is the Quantified Self sport registry. Sports-lib owns canonical activity types and alias
resolution; this registry owns Training families, context separation, presentation metadata, capability flags, and
analysis policies. Builders, callables, destination grouping, shortcut normalization, and generic profile-metric
rendering derive from it.

| Training family | Registered contexts and profiles | Conservative canonical membership |
| --- | --- | --- |
| Running | Running (`endurance`), Trail running (`vertical-endurance`), Indoor running (`endurance`) | Running; Trail Running; Treadmill, Indoor Running, Virtual Running |
| Cycling | Cycling and Indoor cycling (`endurance`), Mountain biking (`endurance`), Enduro MTB (`mixed-gravity`), Downhill MTB (`gravity`) | Cycling, E-Biking, Hand Cycle, Velomobile; Indoor Cycling, Virtual Cycling; Mountain Biking; Enduro MTB; Downhill Cycling |
| Swimming | Pool swimming (`pool`), Open-water swimming (`open-water`) | Swimming; Open Water Swimming |
| Rowing | Indoor rowing and On-water rowing (`rowing`) | Indoor Rowing; Rowing |
| Walking & Hiking | Walking and Hiking (`vertical-endurance`) | Walking, Nordic Walking; Hiking, Trekking |
| Nordic Skiing | Snow and Roller skiing (`vertical-endurance`) | Crosscountry Skiing, Nordic Skiing; Roller Skiing |
| Strength | Strength (`strength`) | Strength Training, Weight Training, Kettlebell |
| Paddling | Canoeing, Kayaking, Paddling, and Stand-up paddling (`paddling`) | Canoeing; Kayaking; Paddling; Stand Up Paddling |

Important behavior:

- Every registered family supports Training Mix and Best Build. Specialist surfaces are capability-gated: durability,
  imported capacity, power profiles, and swimming performance are enabled only where declared. Reusable context
  summaries are driven directly by each context's profile and metric declarations.
- Standard Mountain Biking is an endurance Cycling context. Enduro MTB and Downhill Cycling stay in Cycling but use
  `mixed-gravity` and `gravity` profiles with `volume-only` load and intensity policies. Strength is also volume-only
  and omits distance. Other registered contexts use recorded load/intensity and distance when available.
- A triathlon or multisport aggregate type is not classified. Its normalized registered child legs are classified
  individually.
- Each child leg counts as a session in its discipline.
- One multisport parent event can anchor a separate benchmark for every registered family represented by a child leg.
- Known unsupported sports are reported as `Other` in load explanation when possible. Unknown strings are
  `Unclassified`.
- Membership is intentionally conservative. CrossFit, ski touring/backcountry skiing, snowshoeing, surfing, sailing,
  and other unlisted types remain Other rather than inheriting a nearby Training profile.
- The overall state and explanation remain on **All training**. Sport shortcuts affect navigation only and never filter
  global calculations or remove a registered family from the complete selector.

The registry also declares context metrics and their aggregation semantics: additive distance/time/ascent/descent,
descent time and jumps; the maximum recorded jump distance across contributing workouts; arithmetic-mean grit, flow,
stroke rate, and stroke distance; and distance-weighted 500 m rowing pace. Stroke rate is available to swimming,
rowing, and paddling contexts. Each emitted metric carries its contributing
activity count. A future family or context should be added to this registry with focused registry, builder, normalizer,
presentation, and documentation tests; it must not require another set of family-specific accumulators or UI branches.

## Derived-Metric Refresh Pipeline

### Metric registry

All metric kinds and their payload contracts live in `shared/derived-metrics.ts`. The backend build registry in
`derived-metrics.service.ts` declares source dependencies per kind. The worker uses those declarations to avoid fetching
settings, sleep, swim lengths, or activity documents for unrelated metrics.

| Metric kind | Training use | Primary source |
| --- | --- | --- |
| `form` | Form/load chart and CTL/ATL state inputs | Parent event TSS |
| `recovery_now` | Imported recovery-remaining card | Bounded parent event recovery stats |
| `acwr` | Load metrics | Parent event TSS |
| `ramp_rate` | State and load metrics | Parent event TSS |
| `monotony_strain` | Load metrics | Parent event TSS |
| `form_now`, `form_plus_7d` | Current/projected freshness values | Parent event TSS |
| `freshness_forecast` | Zero-future-load scenario chart | Parent event TSS |
| `intensity_distribution` | Global intensity chart | Parent event power/HR zones |
| `training_summary` | Overall comparison, eight-family Training Mix, and context/profile summaries | Joined normalized activities |
| `training_capacity` | Imported FTP and VO2 max observations | Joined activities |
| `training_power_systems` | Exact-type current CP/W′/Pmax capacity and 12-week sparse history | Persisted activity power curves plus parent event eligibility |
| `power_curve` | Running/Cycling one-year curves and 90-day retention | Persisted activity power curves |
| `training_explanation` | What drove this | Parent events plus joined child activities |
| `training_durability` | Current/usual durability and 12-week trajectory | Persisted activity durability stats |
| `training_build_comparison` | Eight-family Best Build, context/profile summaries, and sleep context | Activities, settings, parent events, sleep |
| `training_readiness` | Readiness 14-day trend | Form snapshot seed plus bounded sleep sessions |
| `body_weight_trend` | Neutral body-weight context: latest value, 7/28-day medians, and sparse 28-day trend | Persisted positive Sports-lib `Weight` values from form documents |
| `training_swim_performance` | Pool/open-water pace and contextual SWOLF | Activities plus active swim lengths |

The workspace also requests registered Easy/Hard and efficiency metrics because it currently uses the complete derived
scope. They are not standalone Training cards. Do not assume every requested snapshot maps one-to-one to visible markup.

The legacy MCP daily briefing uses only the two headline snapshots from this table: `training_summary` for the
current-versus-usual 28-day Training context and `training_readiness` for current readiness. The additive
`get_daily_report` tool reuses that same strict Training Summary projection but combines it with the live Dashboard
Today-equivalent readiness path and safe latest sleep HRV/heart-rate aggregates. Both project a compact identity-free
total and the frozen public Running/Cycling/Swimming breakdown, not the rest of the Training workspace. Internal
schema-16 snapshots contain all eight families and context/profile fields; MCP projection removes those fields and
folds the five additional families into Other where an explanation payload needs a complete composition total. Form,
CTL/ATL, ACWR, ramp,
recovery, capacity, durability, power systems, and other specialist snapshots remain independently queryable rather
than being silently recast as a daily workout recommendation.

Training currently watches `TRAINING_WORKSPACE_DERIVED_METRIC_KINDS`, which is all registered derived kinds. Training-only
kinds are excluded from the default Dashboard subscription and freshness scope. Dashboard adds `training_capacity` or
`training_durability` to that scope only while a matching explicitly configured tile exists.
`training_power_systems` has no Dashboard tile and is never added to normal Dashboard subscriptions. Opening a normal
Dashboard therefore does not create a hidden Training dependency or freshness probe for those kinds.

`body_weight_trend` is also Training-only. It is calendar-sensitive because its current 7- and 28-day UTC windows
advance at midnight, but it is not projection-sensitive: it reads only persisted Weight values and does not reuse the
Form projection seed.

### Shared Dashboard and Training insight reuse

The configurable Dashboard can present a narrow, read-only view of selected Training evidence, while the current
Training state and Readiness are fixed inside the optional Today summary:

- **Aerobic Capacity** selects the most recent imported running or cycling VO2 max, displays its provider/source
  provenance, and compares only observations from the same source. FTP settings and rolling CP/W′/Pmax capacity never
  become VO2 values.
- **Aerobic Durability** uses the persisted `training_durability` payload and the existing sports-lib evidence protocol.
  The card selects the current context with the most eligible samples, then uses eligibility ratio and discipline priority
  as deterministic tie-breakers, followed by the lexical context key when every meaningful signal is equal. Running,
  Cycling, and Open water show aerobic decoupling; Pool shows pace retention. Missing weeks remain gaps.
- **Training state** is one TSS-only interpretation shared between the Training header and Dashboard Today. Both surfaces
  call `current-training-state.helper.ts`, which prefers the current UTC-day Form series for Form and seven-day CTL
  ramp, then uses the compact Form/Ramp snapshots only while the series is unavailable. It resolves the accompanying
  CTL/ATL context and passes the same four values to `training-state.helper.ts`; there is no Dashboard-specific state
  formula. Both surfaces render the state as plain heading text rather than a status tag. Dashboard Today intentionally
  shows the compact label, caption, and `TSS only` qualifier, while Training provides the full Material info control with
  the contributing values and state boundaries.
- **Readiness** uses the environment-neutral formula in `shared/readiness.ts` in both surfaces. Dashboard Today applies
  it to current Form/ramp and bounded live sleep. Training uses that same live current result and also reads a
  backend-derived
  `training_readiness` snapshot containing 14 UTC-aligned daily cutoffs. Each historical day uses the Form state for that
  day, its seven-day CTL change, and only sleep evidence that had ended by that cutoff; a night older than 48 hours is
  ineligible. HRV, average-heart-rate, and minimum-heart-rate baselines use up to 14 prior nights from the same provider
  and require at least three prior values for the matching measure. Average and minimum HR are not independent score
  drivers: their ratios are bounded to `0.8..1.2`, then combined into one Overnight HR ratio at 70% average and 30%
  minimum, with fallback to whichever is available. Lower HR relative to personal baseline supports that driver. The
  live sleep query is lower-bounded to 30 days and keeps an open upper bound so an open page can
  receive newly imported nights. The backend sleep query is bounded at both ends to the envelope required for all 14
  cutoffs, and the formula then applies its own 30-day lookback at each cutoff. Future records are ignored. Training
  replaces the final chart point with the live current result only when the retained snapshot is for the current UTC day,
  so the headline and today's dot stay in sync without plotting a new score on yesterday after a day rollover. Score,
  status, confidence, timestamp, driver freshness, baseline evidence count, and missing values stay separate. Persisting
  the baseline count lets the frontend verify historical confidence against the shared formula instead of accepting only
  a plausible range. The combined load freshness uses the oldest contributing Form/ramp timestamp so one fresh input
  cannot hide a stale one. The result is not a medical score, VO2 estimate, workout prescription, or change to the
  curated Training state; the implication text remains neutral and asks the user to inspect evidence rather than obey a
  score. Dashboard Today shows the same four driver groups and stops its bounded listener when Today is hidden. The
  retired pre-release raw value `KpiReadinessConfidence` has a narrow cleanup predicate for local preview settings; it
  is not part of the active dashboard chart-type union, renderer, manual choices, presets, or recommendations. Equal-time
  sleep records use stable provider, date, and ID tie-breakers so live and historical calculations
  cannot select different latest evidence because query order changed. MCP's additive `get_today_readiness` tool applies
  this same live formula, current Form/ramp preference, bounded 30-day sleep source, and same-provider baselines. It
  exposes only an explicit identity-free driver projection with safe aggregate HRV/heart-rate values and evidence
  states. The additive `get_daily_report` reuses that live projection plus the safe latest-night aggregate values and
  compact Training Summary; the frozen daily briefing remains unchanged.
- **Body-weight trend** reads only positive persisted Sports-lib `Weight` values, in canonical kilograms. Multiple values
  on the same UTC day reduce to a daily median; the snapshot retains the latest 28 UTC days with missing days as null
  points, the latest recorded value, and current 7- and 28-day medians. Its change values compare each current window
  to the immediately preceding equal-length window and are withheld unless each side has at least three recorded days.
  The frontend formats values with the user's weight-unit setting and displays the trend with ECharts without bridging
  chart gaps. This is neutral context,
  not a health assessment, training prescription, or input to Readiness, Form, or the TSS-only Training state.

Dashboard Manager recommendation eligibility may inspect existing snapshot documents to decide whether these tiles are
useful. Activity-backed recommendations require evidence in the default 90-day tile window, Sleep requires evidence in
its default 14-day window, and Power Curve uses each discipline's prepared 1-year snapshot. It does not request a rebuild
merely because the manager dialog was opened.

### Writes and ingress

- Event creates, updates, and deletes enqueue debounced derived-metric ingress.
- Activity creates, updates, and deletes enqueue the same ingress.
- Sleep writes enqueue `training_build_comparison` and `training_readiness` and do not increment the event mutation
  version. Readiness itself has no activity dependency and can reuse the Form seed; the pre-existing build comparison
  still owns the wider activity/settings scan needed for build-range recovery context.
- The benchmark callable marks only `training_build_comparison` dirty.
- Destination and shortcut changes write only `appSettings.trainingWorkspace` through the normal owner-authorized
  Firestore settings path. They do not dirty or rebuild derived metrics because they are presentation state.

Ingress is debounced by UID and a short time bucket. Deterministic task names coalesce bursts of event/activity writes.
The ingress worker marks the relevant kinds dirty and queues one derived worker generation.

Admin queue observability treats these as two separate Cloud Tasks queues: derived ingress shows invalidations waiting to
coalesce, while derived workers show snapshot builds waiting to run. The global Cloud Tasks depth and the Admin Dashboard
Derived Metrics row include both queues so ingress backlogs cannot disappear from headline health totals.

### Frontend freshness probe

On `/training`, the frontend:

1. Subscribes directly to each requested snapshot document.
2. Converts unknown or malformed data through a payload normalizer.
3. Treats an old schema or a ready-but-invalid payload as stale.
4. Calls authenticated, App-Check-protected `ensureDerivedMetrics`.

Missing, failed, or stale kinds have a 30-second request cooldown. Healthy scopes still receive a lightweight freshness
probe with a five-minute cooldown. The callable compares coordinator/snapshot state, the calendar day, mutation versions,
and the latest event update before deciding whether to queue work.

Readiness payload validity is also checked in the callable with the same environment-neutral runtime validator used by
the frontend. A `ready` document that predates a required history field or otherwise fails that contract is therefore
treated as stale by both layers. Snapshot-specific freshness failures enqueue only the affected kinds even when the
initial page probe contains the complete Training scope, so this case queues only `training_readiness`. A mixed probe
queues the ordered union of hard snapshot failures and calendar-stale kinds; if the latest-event fallback detects a
missed event trigger, it queues the complete requested scope. That targeted repair reuses a compatible Form snapshot
seed and the bounded sleep envelope; it does not trigger an event or activity history scan. Keep the validator shared
when the readiness payload evolves so backend freshness cannot call an invalid document fresh while the frontend remains
indefinitely on Preparing.

The readiness payload also carries `formulaVersion: 3`. This is intentionally independent of the global derived schema:
changing the current/historical readiness formula or its persisted input projection invalidates only
`training_readiness`, preserving compatible snapshots for every unrelated kind.

This probe is important in local development and recovery scenarios: opening Training can repair missing or stale
snapshots even when no new Firestore write arrives.

### Worker lifecycle

`ensureDerivedMetrics` runs with 512 MiB of memory, a 120-second timeout, and at most 100 instances. It performs the
authenticated freshness check, reads the coordinator and requested snapshot metadata, validates the narrowly scoped
payload contracts, and queues only the metric kinds that need rebuilding. Full-history derived calculations remain in
the separate worker below.

`processDerivedMetricsTask` runs with 2 GiB of memory and per-instance concurrency `1` because a single full-history
Training build can hold large event and activity source sets. Cloud Run must scale separate instances for concurrent
builds instead of placing multiple full-history generations in one JavaScript heap. The worker creates one canonical
parent/activity join and shares that same array across sleep-range resolution, curated builders, and explanation
builders; do not restore separate joined copies or per-activity spread clones.

The derived worker:

1. Claims the expected coordinator generation.
2. Marks requested snapshots `building`.
3. Resolves source requirements for only the dirty kinds.
4. Fetches events, normalized activities, bounded recovery events, settings, swim lengths, and sleep only as required.
5. Builds payloads with a single `buildAtMs` anchor.
6. Re-checks the user deletion guard before every write stage.
7. Writes all requested snapshots `ready` with the same mutation version.
8. Completes the generation or requeues newly dirtied kinds.

Failures mark affected snapshots failed, preserve an error, and are rethrown so the Cloud Tasks retry policy can apply.

## Page Lifecycle and Destination Navigation

The workspace subscribes to the authenticated user and resets all state when the UID changes. It never allows a previous
user's dialogs or view models to survive an account switch.

The shared route header owns one stable context line above the `Training` title. Its static Material monitoring icon,
40 px title row, and `headline-small` title role match Calendar and the embedded Dashboard Today header; Today remains a
semantic level-two heading because it is a Dashboard section. When the visible scope is healthy, the normal `28-day
training analysis` eyebrow remains above the title and a Dashboard-style `Data through <weekday, UTC date>` subtitle
appears below it. The subtitle uses the validated `training_summary` snapshot's `asOfDayMs`; it
represents the actual derived-data cutoff, never the browser clock. While any snapshot that backs a visible Training
surface is missing, queued, processing, building, or stale, the projected status context replaces that eyebrow instead
of inserting a banner into the analytical content. A stale snapshot says that any available last completed values
remain visible while the replacement finishes. A failed visible snapshot takes precedence,
uses the same line, and adds a Material Retry action that force-requests the complete Training metric scope. When the
visible scope is healthy, the normal eyebrow returns. The status scope follows the selected destination: Overview
evaluates global surfaces, a sport evaluates only its summary/build and declared
specialist capabilities, and Other power activities evaluates rolling power systems. The optional imported recovery
snapshot participates only while its active `Recovery left` estimate is visible on Overview, so missing, failed, or
elapsed optional recovery does not keep the route header in an updating state. Compact Form Now, Ramp Rate, and Form +7
snapshots participate only when the primary Form or freshness-forecast
series cannot supply the displayed fallback value. Dashboard uses the same continuity rule in its existing top
summary-header slot before Today and the tiles. Below the tablet breakpoint, Training moves its route actions to one
dedicated non-wrapping row and compacts every action to an accessible icon-only control. Retry therefore cannot wrap
the header or change its height when a single-sport label is selected. At 640 px and below, the row retains its 48 px
Material touch targets but leaves only an 8 px external gap before the first section divider. The destination navigation
owns that single divider; the first rendered section begins without adding a second border. These fixed header slots
prevent derived status changes from moving the value cards or initially presenting stale values without context.

The route has three destination kinds:

- **All training** (`overview`, the default) renders the global state, readiness and recovery context, What drove this,
  Form/freshness/load, compact current-versus-usual cards for every recorded registered family, the global intensity
  distribution, and body-weight context. It does not duplicate specialist or exact-type power panels.
- **Registered sport** renders exactly one family's Best Build card, detailed Training Mix, and the specialist surfaces
  enabled by that sport's registry capabilities. Sleep inside Best Build compares the same date windows but is explicitly
  labeled as not sport-filtered.
- **Other power activities** renders only exact rolling-power types that cannot be resolved into the Training registry.
  The destination is discoverable when such evidence exists and remains renderable as an honest empty state if it was
  the account's saved destination before that evidence disappeared.

Desktop uses one intrinsic-width Material button-toggle group for **All training** plus at most four sport shortcuts,
with the complete **All sports** selector and shortcut editor grouped at the opposite edge. The toggle outline must end
with its final choice rather than stretch across unused row space. Selecting a sport outside the four saved slots
temporarily places it in the visible toggle group without mutating the saved shortcut set. At intermediate desktop/tablet
widths the compact shortcut group occupies its own row. At 800 px and below, a horizontally swipeable rail of compact
Material text buttons exposes **All** plus the same automatic or pinned shortcuts as one-tap destinations. The selected
button uses a tonal state, and each 40 px visual button retains Material's 48 px touch target. A fixed 48 px Material icon
button with the accessible **All sports** label preserves more width for that rail and opens a viewport-bounded Material
bottom sheet. The sheet keeps **All training** first, groups automatic or pinned shortcuts next, sorts the remaining
available destinations by label, marks the current view, and places **Manage sport shortcuts** in its stable footer.
As independently loaded snapshots hydrate or refresh, any destination that remains visible keeps its existing shortcut
slot and a newly eligible destination fills an open or vacated slot. This prevents the active button and its neighbors
from changing order under the user while still allowing the automatic top-four membership to update.
Choosing an off-shortcut registered sport temporarily places it at the front of the rail's sport slots and returns the
rail to its leading edge. The selected destination is intentionally not encoded in the URL or browser history.

Sport shortcuts have two modes:

- **Automatic:** rank registered families with current 28-day activity by duration and then workout count; saved Best
  Build benchmarks provide fallback eligibility; registry order resolves remaining ties. Keep at most four.
- **Fixed:** retain the user's persisted non-empty one-to-four-sport subset.

Missing new shortcut state falls back to legacy `trainingSettings.visibleDisciplines`; explicit `null` bypasses that
fallback and restores automatic mode. Shortcuts affect navigation only. Every registry sport remains available in the
complete selector, Overview totals remain global, and all derived snapshots/calculations are unchanged.

Destination changes update the view optimistically and persist the last choice to the current account. Rapid changes
coalesce to the latest queued destination. Every queued write carries the expected UID and a workspace generation so an
account switch drops stale queued work and optimistic state. A failed write keeps the requested view open, removes the
saving indicator, and explains that only the account default failed to save. Because Firestore can publish a local-cache
settings echo before the server accepts the write, that echo does not retire the optimistic destination until the matching
write is acknowledged. Intermediate echoes from coalesced choices and unrelated stale settings emissions likewise cannot
replace the latest requested view.

On supported mobile coarse-pointer devices, a real destination change uses the shared selection haptic. A final failed
preference write uses one error haptic; these presentation cues do not change destination, persistence, or reconciliation
semantics.

## Page Sections and Calculations

The sections retain the following relative order when their destination renders them.

### 1. Compared With Your Usual 28 Days

Overview only.

The section combines `training_summary`, form/load metrics, `recovery_now`, and the recovery comparison stored in
`training_build_comparison`.

#### Training summary

For every discipline:

- Current window: today plus the preceding 27 UTC days.
- Baseline: the immediately preceding 84 UTC days, multiplied by `28 / 84` to produce a normalized 28-day value.
- Workouts: child activity count.
- Time: sum of activity `Duration` stats.
- Intensity: power zones when present, otherwise heart-rate zones.
- Easy: zones 1-2.
- Moderate: zones 3-4.
- Hard: zones 5-7.

The summary and Best Build payloads also preserve each observed registered context. Contexts emit only the metrics
declared by the shared registry: distance, moving/elapsed time, ascent/descent, descent time, jumps, longest jump,
grit/flow, swimming/rowing/paddling stroke rate, rowing 500 m pace, and stroke distance as applicable. Additive metrics
are summed; longest jump is the maximum persisted `Maximum Jump Distance` across the window; grit, flow, stroke rate,
and stroke distance are arithmetic activity means; rowing pace is distance-weighted. Elapsed time prefers a stored
elapsed stat, then timestamps, then duration. Stroke rate prefers canonical `Average Stroke Rate` and reads pre-19
persisted `Average Cadence` only as a compatibility source for Sports Lib activity types that use stroke-rate
semantics. Each metric includes its source-activity count.

The 84-day summary baseline normalizes activity counts, additive metric values, and metric source counts by `28 / 84`.
Maximum, mean, and distance-weighted values retain their actual aggregate rather than being scaled. Best Build windows
use their raw 8-, 10-, or 12-week totals and counts.

The top training time and workout values sum all eight registered families and appear only on Overview.
Gravity Cycling and Strength contexts contribute reliable time/workout volume, but their profile policy prevents zones
or TSS from being presented as sport-specific intensity/load evidence. Strength omits distance.

#### Training state

The frontend classifies existing form signals in this order:

| State | Rule |
| --- | --- |
| Starting | `fitness < 5` and `fatigue < 10` |
| Overload | `form <= -30`, or `form <= -20` while `fatigue > fitness * 1.25` |
| Fatigued | `form <= -10` |
| Building | `rampRate >= 1` and form is missing or `< 6` |
| Fresh | `form >= 8` and ramp is missing or `<= 0` |
| Detraining | `rampRate <= -3` and form is missing or `> -8` |
| Balanced | any other available signal combination |

If all state inputs are missing, the page shows an awaiting-data state rather than guessing.

The Material info control appears directly beside the calculated State label. It identifies Form as `CTL - ATL`, shows
the current formatted Form, CTL, ATL, and seven-day CTL ramp values (with unavailable inputs explicit), and explains the
selected state. The State label remains a plain heading rather than a status tag. For Balanced it also states the
specific Building boundary: a ramp of at least `+1` with Form below `+6` or unavailable. Sleep, sessions, and the 28-day
time comparison do not change the label. A Form refresh can temporarily
mark the TSS/load chart as building while the snapshot service retains the prior valid Form series. In that case the
State card keeps the last complete label for continuity, but adds **Updating from the latest completed TSS calculation…**
so it is never mistaken for a new result.

Training and Dashboard Today call `current-training-state.helper.ts` before rendering this table. The helper prefers the
current UTC-day Form series, then falls back to compact Form/Ramp snapshots only until that series is available; it
also resolves current CTL and ATL from that same series. The Dashboard Today row repeats the exact label and caption
with an explicit **TSS only** qualifier. Training alone exposes the detailed explanation below.

This follows the Dashboard KPI interaction pattern: the same structured State explanation opens in a `qs-menu-panel`
Material menu on larger viewports and a viewport-bounded Material dialog at `767px` and below. Do not use `MatTooltip`
for this multi-value explanation; it is hard to read and can be clipped or rendered as an opaque transient bubble on
mobile.

#### Readiness today

Training renders one wide Readiness card instead of separate top-level readiness and sleep cards. The current result is
contextual rather than causal or prescriptive. It calls the same shared formula as the fixed Dashboard Today summary and
combines only:

- the current UTC-day Form series as one 40% Load driver (with the Form Now/Ramp snapshots used only when the series cannot provide the needed value);
- sleep score when recorded, otherwise a duration-based score centered on eight hours, at 25%;
- latest-night HRV versus up to 14 prior nights from the same provider, at 20%; and
- one 15% Overnight HR driver that blends same-provider average sleep HR (70%) and minimum sleep HR (30%).

Each available HR ratio is bounded to 80–120% of its own baseline before blending; if one HR measure is unavailable,
the other supplies the driver. Lower HR supports the score only relative to the user's own provider-matched baseline
and is not a universal medical claim. Missing drivers are excluded and available weights are renormalized rather than treating
missing evidence as zero.

Provider coverage follows the normalized sleep document rather than assumptions about a device. The current Suunto
mapper persists average and minimum sleep HR, the COROS mapper persists average sleep HR, and the Garmin Health sleep
summary mapper currently persists neither normalized sleep-HR measure. The score therefore uses only the measures that
are actually present; provider-specific omissions remain missing and do not become neutral or zero-valued evidence.

The sleep listener is lower-bounded to 30 days, excludes naps, ignores future-dated records, and accepts a latest night
only through 48 hours after its end. The card also refreshes when a future record becomes eligible or baseline evidence
leaves the 30-day window, even if Firestore emits nothing. Score, status, confidence, calculation timestamp, signal
count, driver values, and driver freshness are shown separately. Combined Form/ramp freshness is the oldest contributing
timestamp. The training implication is deliberately non-prescriptive: it summarizes whether evidence is supportive,
mixed, or strained and directs attention to the drivers rather than choosing a workout. Failed Form/ramp reads and a
failed sleep listener are identified separately from genuinely missing evidence. Sleep already loaded before a listener
failure remains visible only while it is still eligible; load-only readiness remains available afterward.

Readiness is the recovery-aware companion to the load model, not a replacement for it. It adds recorded sleep, HRV, and
overnight heart-rate evidence to the Form/ramp driver when those signals are available. Form/Freshness, CTL, ATL, Ramp,
Load Status, and the zero-load forecast remain deliberately TSS-only; recovery evidence never changes their values or
the Training state. The UI calls this distinction out in the Readiness header and in the Form/Freshness information
controls so athletes do not interpret a sleep change as a recalculation of training load.

The same card plots a backend-derived 14-day series. `training_readiness` declares only `formDocs` and
`trainingReadinessSleepDocs`; it never declares activities or settings. On a readiness-only refresh, the worker accepts a
schema-compatible Form snapshot seed, avoids a full event scan, and queries a bounded sleep-end envelope covering every
daily cutoff's own 30-day lookback. Each daily point evaluates the shared formula at that UTC day's final millisecond,
except today, which uses the worker build timestamp. Missing scores remain chart gaps and the frontend rejects malformed,
non-contiguous, or internally inconsistent payloads, including confidence that does not match the recorded signal and
baseline evidence counts. The latest complete series may remain visible while its status is updating or after a failed
refresh. The live current calculation replaces today's plotted score only when the snapshot's `asOfDayMs` is the current
UTC day, so newly imported sleep can update the card without waiting for a historical snapshot and a stale series cannot
mislabel a new score as yesterday's. An open Training route schedules a narrow UTC-day rollover refresh for `form_now`,
`ramp_rate`, `form_plus_7d`, `freshness_forecast`, `training_readiness`, and `body_weight_trend`. The first five
projection-sensitive kinds can reuse a compatible Form seed and do not require an event or activity scan;
`body_weight_trend` reads its narrow persisted Weight source so its UTC windows stay current.

The compact ECharts chart uses a fixed 0–100 score axis, with the 75 and 55 Readiness thresholds marked so changes
remain interpretable across days. Its shared app-standard hover or tap tooltip reports the UTC date, score,
status, confidence, available-signal count, and recovery-baseline-night count. Missing scores remain null series
values, so ECharts leaves visible gaps rather than interpolating them.

#### Recovery remaining

`recovery_now` combines supported imported post-workout recovery estimates. An active estimate appears as the compact
**Recovery left** row at the start of the Recovery context inside Readiness, directly before Sleep history. Its live
countdown includes the estimated local finish clock, remains visible while the sleep details are collapsed, and explicitly
stays separate from the Readiness score and Freshness/Form. It replaces the former top-level status tile so the same timer
is not presented twice. Dashboard Today uses the same **Recovery left** label, remaining duration, and estimated local
finish clock beneath its score. Both surfaces remove the row without a placeholder when the estimate elapses. The timer
uses the stored end time, is contextual rather than a second recovery model, and never changes Readiness, Freshness, or
the Training state. The worker scans a bounded 16-day event window; no events in that window is a valid empty result for
new or inactive users and is logged as informational rather than a warning.

#### Recovery context and sleep history

Recovery context groups the optional active Recovery left estimate with the always-available Sleep history summary.
Sleep history remains independently expandable through explicit **Show sleep details** and **Hide sleep details**
controls; collapsing its details never hides an active countdown. The expandable Sleep history inside Readiness uses:

- Current: the current 28-day window.
- Reference: the immediately preceding 84-day window.
- Main overnight sleep only; naps excluded.
- Metrics: average sleep per night, a typical local sleep window, recorded-night coverage, bedtime variation, and median overnight HRV.

Comparative deltas require the same provider and sufficient coverage in both windows. The minimum is at least seven
nights and at least half of each window (`14/28` and `42/84` for the normal comparison). Bedtime regularity requires a
usable timezone; the builder must not fabricate local bedtime from UTC timestamps. Garmin normally supplies this as
`startTimeOffsetInSeconds`, while COROS can supply explicit offsets or its start/end timezone fields, and Suunto can
supply an offset-bearing sleep timestamp. The build-comparison projection includes that historical Suunto timestamp and
prefers a valid normalized `timezoneOffsetSeconds` before falling back to its embedded offset. Any provider can omit that
evidence, and older backfilled records can predate offset persistence. Those nights still contribute valid duration and
overnight HRV when available, but not local timing metrics. The typical sleep window is the circular-medoid local start
and end clock time across at least five main sleeps with both trustworthy local endpoints; it is a representative clock
pattern, not a duration-derived or UTC-inferred time. Recovery-comparison tables render the start and end clock times on
separate lines for each window. The table compares a start-time shift as earlier/later without
presenting one direction as inherently better. The frontend must therefore accept missing sleep-window and bedtime-
variation evidence independently of total recorded-night count. It renders only the missing metric as unavailable,
explains the local-time or HRV evidence requirement, and keeps other valid recovery metrics visible. Comparison copy must
not imply that every metric is available.

`training_build_comparison.payload.recoveryVersion` tracks this recovery interpretation independently of the global
derived-metric schema. When it changes, both the frontend normalizer and backend freshness gate request only a new
build-comparison snapshot, leaving unrelated derived metrics fresh.
Provider mappers preserve null or blank timezone fields as missing rather than coercing them to UTC; COROS can still fall
back from a missing explicit offset to its start/end timezone fields.

Sleep values remain visible without deltas when coverage or provider comparability is insufficient.

### 2. Best Build vs Now

Registered sport destinations only; exactly one sport card is built and rendered.

`training_build_comparison` builds one independent card per visible registered family. All eight families support one
saved benchmark; specialist rows remain capability- and evidence-gated.

#### Benchmark selection

Each discipline can store one selection:

```ts
type TrainingBuildBenchmarkSelection =
  | { mode: 'event'; durationWeeks: 8 | 10 | 12; eventId: string }
  | { mode: 'period'; durationWeeks: 8 | 10 | 12; endDayMs: number };
```

- Event mode: the selected event anchors the build; benchmark end is the day before the event.
- Period mode: the selected UTC date is the benchmark end.
- Current and historical windows always have the same 8, 10, or 12-week length.
- The benchmark must end before the current window begins.
- The anchor event is not part of the historical workload.
- Selecting an event never adds or changes its `Race` tag.
- Exact case-insensitive `Race` tags only affect suggestion priority.

The picker shows up to 20 tagged races and up to 100 other historical events. It can filter all history, the latest year,
or earlier history, and sort by latest, longest, or highest load. Generic `New Event` names are suppressed; date and
available distance, duration, and TSS provide identity.

The Best Build card identifies event-mode selections as a **Selected reference event** and explains that the event day is
excluded from the compared workload. It shows a meaningful selected-event name when one exists. Default, blank, or
timestamp-like event names are never repeated as a card heading: event-mode benchmarks instead show `Event on <UTC
anchor date>`, while manual selections remain labeled as a historical period.

#### Callable validation

`setTrainingBuildBenchmark` requires authentication and App Check. It validates:

- discipline;
- selection shape and duration preset;
- Firestore-safe event ID;
- UTC-normalized period date;
- non-overlap;
- event existence;
- deletion-guard state;
- merged-event exclusion; and
- at least one child activity belonging to the requested discipline.

The callable writes only `trainingSettings.buildBenchmarks.{discipline}`. Clearing uses field deletion. It then dirties
only `training_build_comparison` without incrementing the event mutation version.

Save failures remain visible in the dialog and are also announced through the shared Material snackbar, because the
inline error can sit below the viewport in the long mobile event picker. Known App Check failures use actionable
secure-session copy instead of exposing raw Firebase transport details.

#### Compared workload

Each current and benchmark window contains:

- child activity count;
- duration;
- distance when available;
- TSS and its source count when available;
- active weeks;
- longest activity;
- easy/moderate/hard zone time when available;
- context-matched durability;
- distance-weighted pool pace; and
- distance-weighted open-water pace.

It also contains the same registry-driven context summaries as Training Mix. The frontend renders the available profile
metrics generically, so adding a context metric to the registry does not require another family-specific table. Enduro
and Downhill comparisons can show reliable distance/time, ascent or descent, descent time, jump count, longest recorded
jump, grit, and flow when recorded, but they do not synthesize run segments and do not show zone/TSS intensity as
gravity evidence. Strength uses elapsed time and omits distance. Indoor and on-water rowing remain separate and can
show distance-weighted 500 m pace, stroke rate, and stroke distance when those sources exist. Pool and open-water
swimming, plus canoeing, kayaking, paddling, and stand-up paddling, can also show stroke rate when recorded.

Pool and open-water pace are never combined. Swimming distance uses swim units. Pace deltas are described as faster or
slower, where lower seconds per 100 m/yd is better.

Durability rows are comparable only when the exact context exists in both windows and each side has at least two eligible
activities. For example, cycling power cannot be compared with running speed, and a 25 m freestyle pool context cannot be
combined with a 50 m breaststroke context.

Every ready card also compares sleep over the exact current and historical build ranges using the same provider and
coverage rules as the top recovery context. To avoid duplicating the full recovery card, Best Build shows a compact
key-metric summary by default and reveals its complete metric table, evidence limitations, and source text only when the
user opens **Details**. Sleep differences under 15 minutes are summarized as similar; exact values remain in the table.

Card states are `not-configured`, `updating`, `invalid`, `unavailable`, and `ready`. Optimistic pending selections remain
updating until the snapshot's stable selection key matches the saved choice.

Ready Best Build cards put the outcome above their comparison table (for example, whether the current build is longer,
shorter, or similar in total time), then state the number of current/reference workouts and TSS coverage. A next-step
prompt appears only when both windows have enough intensity evidence and a material time difference. The detailed table
retains exact values and text deltas without adding inline comparison bars.

### 3. What Drove This

Overview only.

`training_explanation` compares the current 28 days with the median of three distinct preceding 28-day blocks.

It intentionally separates parent-event load from child-activity composition:

- Parent events determine total TSS and top contributors. This avoids double-counting multisport legs.
- Child activities determine the eight registered families plus Other/Unclassified composition and rhythm.

The cards show:

- overall TSS relative to the baseline median;
- up to three of the top five current parent-event contributors;
- the sport bucket with the largest absolute TSS change; and
- the discipline with the largest active-day change.

The rhythm card never selects a dormant discipline (zero sessions and active days in both windows). When active-day
changes tie, it prefers the discipline with more observed active days, then sessions, before using a lexical tie-break.

Rhythm includes session count, active days, active weeks, longest inactivity gap, and longest session. Coverage text makes
missing parent TSS and unclassified child activity types visible. A sparse one-off baseline must not be described as a
confident usual pattern.

The four driver cards use one balanced row on wide screens, a two-by-two tablet layout, and a single mobile column.
Within each card, the card heading, plain-language outcome, supporting explanation, and coverage note use distinct type
levels. The outcome uses language such as `Above usual load` or `Same rhythm`; exact TSS and workout counts stay in the
supporting sentence rather than competing with the conclusion. Contributor events render as separate list items so an
event label and its load share do not split into an ambiguous separator-delimited sentence. The two selected sport-driver
headings state both the overview rule and its result, for example `Largest sport load change · Cycling` and
`Largest rhythm change · Cycling`, so they cannot be mistaken for Cycling-destination cards. If the selected sport's
effective load delta is under 0.5 TSS or its active-day delta is zero, the corresponding heading uses the neutral
`Sport load comparison` or `Sport rhythm comparison` label instead of claiming a change. Registered-family driver
headings reuse the shared registry icon activity type; overall load, contributor, Other, and Unclassified cards remain
text-only.

The section-level conclusion and evidence-quality line appear before the cards. They make TSS coverage explicit without
turning missing data into a negative or positive training judgment.

### 4. Load Trajectory

Overview only.

This section reuses global derived load metrics:

- Form chart.
- Seven-day freshness forecast.
- CTL.
- ATL.
- Ramp rate.
- ACWR.
- Monotony.
- Strain.
- Form now.
- Form after seven zero-load days.

Daily load is TSS on UTC days. CTL and ATL use exponentially decaying recurrences with 42-day and 7-day time constants:

```text
CTL_today = CTL_previous + (load_today - CTL_previous) / 42
ATL_today = ATL_previous + (load_today - ATL_previous) / 7
Form      = CTL - ATL
```

Every Training and Dashboard “current” load surface resolves this same model through the current UTC day. If no TSS
has been recorded on an intervening day, that day is explicitly zero load; CTL and ATL still decay at their respective
rates, so TSB and Ramp Rate can change without a new workout. CTL, ATL, Form Now/TSB, and Ramp Rate are all taken from
this one current-day Form series. Ramp Rate is `CTL(today) - CTL(today - 7 UTC days)`. The last real workout’s TSS is
shown separately and is never replaced by an assumed zero.

The forecast is a scenario with zero future load, not a prediction of what the athlete will actually do. All of these
load metrics are intentionally independent of sleep, HRV, overnight heart rate, and imported recovery timers. Those
signals appear only in Readiness today, which adds recovery context without changing Freshness/Form or the Training
state.

The card starts with a concise interpretation of Form (recent fatigue relative to longer-term fitness) and labels the
model as TSS-backed workouts only. When the no-workout forecast exists, the only follow-up prompt is to compare that
scenario with today; it does not imply that the athlete should stop training.

### 5. Training Mix

Overview renders the compact cross-sport form; registered sport destinations render the detailed single-sport form.

Discipline cards use `training_summary` for:

- Current 28-day child activity count and duration.
- Current zone percentages.
- Normalized preceding-84-day zone percentages.

The compact Overview cards also use the matching-cutoff `training_explanation` snapshot for each family's current
activity TSS and usual TSS. Its usual TSS is the median of the three preceding 28-day blocks, rather than the
summary's normalized 84-day count/duration baseline. TSS stays unavailable (`--`) when the family has no eligible
sport-specific recorded load (including intentionally volume-only contexts), or while the two snapshots do not share
the same cutoff; it is never treated as zero.

Power zones take priority over heart-rate zones per activity. If neither exists, that activity contributes to count and
duration but not to the zone denominator.

The global Intensity Distribution keeps that denominator visible: each weekly stacked bar's height is the total recorded
zone time, and its Easy/Moderate/Hard color segments show the composition. The header and tooltip show both zone time
and percentage for the selected week. It must not normalize every week to an equally tall 100% bar, because a short
hard-only workout would otherwise look equivalent to a high-volume hard week.

On Overview, each recorded registered family is a compact workout-count, duration, and available TSS card. Workout
and duration use normalized usual values; TSS carries the separate preceding-block median described above. The
separate intensity-distribution chart remains global and can include any activity with eligible power or heart-rate
zone data. A sport destination replaces that compact card with the existing detailed current-versus-usual zone/context
analysis for exactly one family and omits the global intensity chart.

Each discipline summary states whether its current zone balance is close to usual or whether easy/hard work has shifted.
It explicitly excludes workouts without usable zones, and points to the weekly distribution only when that shift is
material enough to investigate.

On a sport destination, the detailed summary keeps activity totals at the top and uses the available vertical space for
a clear current-versus-usual intensity balance: each zone has a current share, normalized baseline share, current fill,
and baseline marker. It deliberately does not add redundant load, readiness, or capacity metrics just to fill the card.
Overview's compact sport grid and global chart collapse responsively at tablet and mobile widths.

Within one discipline card, every observed context after the first starts below a matching theme-aware divider. This
keeps Cycling, Mountain biking, Enduro MTB, and Downhill MTB visually distinct while preserving one shared card surface.

### 6. Power Systems

Registered sport destinations with matching exact-type evidence, plus the Other power activities destination.

`training_power_systems` is the capacity-first use of Sports-lib's dated three-dimensional capacity fitter. It supports
every exact canonical activity type with a usable persisted Power Curve and has no combined or all-sports capacity.
The frontend resolves each exact type through the shared Training sport registry, places registered types under their
sport destination, and places unmatched canonical types under **Other power activities**. It never guesses a nearby
family.

A registered sport renders Power systems only when at least one matching exact type exists. Other power activities
retains the section and its confirmed-empty state when selected even if its previously available evidence disappears.
Overview deliberately omits the section because every exact type has a dedicated destination.

Policy version 1 is fixed:

- For an effective UTC day `D`, supply only same-type power curves in the closed-open interval `[D - 42 days, D)`.
- The workout on `D`, later workouts on `D`, and every future workout are excluded. A result can therefore be used for
  that workout date without learning from the workout itself.
- The current snapshot is effective today.
- Historical points are calculated only for distinct qualifying workout UTC dates in the latest 84 days, plus today.
  Rest dates are not manufactured as chart points.
- Related sports remain separate. Cycling, Indoor Cycling, Mountain Biking, Rowing, and every other canonical type each
  get their own input history and fit.
- Repeated type/day calculations are cached within one build.
- Functions passes the dated curves directly to `fitThreeDimensionalCapacityModel`. There is no fallback window, FTP
  substitution, population default, or Quantified Self fitting formula.

The bounded payload persists:

- policy version, UTC boundary, 42-day window, 84-day history bound, and effective-day exclusion;
- exact canonical activity type;
- current overall status and reason;
- CP watts, W′ joules, and Pmax watts with independent component status and reason;
- Sports-lib source fingerprint;
- usable-curve count, history span, malformed and isolated-spike rejected-point counts, sustained/short anchor coverage,
  the distinct activities that actually supplied each component's retained envelope anchors, fit error,
  candidate-method spread, and—only when W′ is withheld for method disagreement—the count and minimum/maximum range
  of the three candidate W′ values; plus leave-one-anchor-out stability and whole-workout source-removal diagnostics;
- compact dated component statuses and values for the 12-week sparse history; and
- current-window candidate, usable-curve, and excluded-evidence counts.

The Sports-lib fingerprint identifies the dated curve inputs and contains no estimator-generation label. Quantified
Self's derived schema and pinned Sports-lib package are the compatibility boundary: a future fitting-behavior change
must increment `DERIVED_METRIC_SCHEMA_VERSION` so existing snapshots rebuild.

A component value exists only when Sports-lib marks that component `ready`. `partial`, `insufficient-evidence`,
`poor-fit`, `unstable`, and `invalid-input` remain explicit states and are never converted to zero. The frontend rejects
non-canonical types, invalid dates, malformed source fingerprints, impossible count/diagnostic combinations,
inconsistent overall/component statuses, duplicate types, unsorted or out-of-range history, and a history endpoint that
does not equal the current result. A rejected `ready` payload is treated as stale so the normal snapshot self-healing
path requests a rebuild.

`sourceCount` means curves with usable standard-duration evidence; it does not mean every source determined the fit.
The component contributor counts are the number of distinct activities that won at least one retained CP/W′ or Pmax
envelope anchor. Sports-lib also attempts a CP/W′ refit after removing each complete sustained-envelope source, reporting
successful/failed refits and the largest component change. This exposes dependence on one workout without treating
several duration anchors from that workout as independent efforts. These diagnostics are not a second QS readiness
gate.

CP and W′ stability are independent after the shared fit-error gate passes. Stable CP remains visible in a `partial`
result when W′ method or anchor sensitivity exceeds its limit; W′ is `unstable`, Pmax is unavailable because it depends
on W′, and the complete model remains absent. A top-level `unstable` result now identifies unstable CP. For an unstable
W′ result, the UI adds a plain-language explanation: whether all retained sustained anchors came from one workout,
whether removing it leaves no CP/W′ refit, the competing W′ candidate range, and why Pmax remains withheld. Candidate
values are competing estimates, not a replacement W′ result. The UI also reports method spread, anchor-removal
sensitivity, and whole-workout removal sensitivity separately so the reason is not misidentified.

The UI shows an exact activity-type selector only when multiple types are available, current CP/W′/Pmax cards with
plain-language modeled-parameter descriptions, status/reason copy, evidence coverage, contributor-aware diagnostics grouped as
a semantic list, and three aligned sparse 12-week ECharts trends in watts, kilojoules, and watts. Their UTC time axes
are fixed to the same 84-day interval, their value axes retain a zero baseline, unavailable observations remain gaps,
and the chart hosts resize with the page. Each canvas exposes an accessible summary of ready-value count and current
availability. On narrow screens the three charts stack at a touch-readable height. The section labels the model as
capacity evidence, not TSS, FTP, fitness, fatigue, Readiness, or a workout prescription.

#### Parser and continuous-stream boundary

The pinned Sports-lib parser does not generate CP, W′, Pmax, or three-dimensional strain while parsing one activity. Quantified
Self uses the already persisted mean-max Power Curve summary for rolling capacity, so derived snapshot rebuilds use
existing data without source-file reprocessing or a data migration. Historical `Three Dimensional Strain Evidence` stats
remain deserializable for compatibility, but event Performance does not expose the retired strain tab.

The capacity estimator includes 720 seconds in newly generated default curves. New curve calculation removes isolated
one-sample recording artifacts from a calculation copy before persistence without mutating the activity stream.
The fitter also rejects and counts the corresponding 1–3-second arithmetic-decay signature in older stored curves, so
existing curves remain usable without reprocessing; older curves that lack an exact 720-second point can still provide
the other sustained anchors and report their actual coverage.

A power curve is sufficient for capacity estimation but not for later workout-strain reconstruction: it records the best
mean power achieved at each duration and discards the second-by-second ordering of work and recovery. A future strain
phase must read each workout's original continuous power stream, select the capacity snapshot effective on that workout's
date, and calculate strain without allowing that workout into its own capacity window. Activities without an original
continuous stream will remain unavailable. This release does not reparse files, calculate strain, aggregate strain, or
calibrate fitness/fatigue response.

### 7. Settings vs Recent Evidence

Registered sport destinations only, capability-gated by the selected sport.

This section contains capability-gated imported capacity observations, swimming performance, durability, and
Running/Cycling power profiles. Generic context/profile summaries live with each family's Training Mix and Best Build
cards rather than creating eight bespoke specialist sections.

#### Imported capacity observations

Imported capacity observations are limited to Running and Cycling. Swimming must not render FTP or a power curve.

For each power discipline:

- FTP setting: the latest stable imported FTP observation, with provider/device provenance and prior value when
  comparable.
- Imported VO2 max: the latest stable source-matched observation.

An FTP value that exactly matches the session-derived `95% of 20-minute power` heuristic is not treated as an imported
long-lived setting. `training_capacity` does not fit CP or W′ and does not read the aggregate `power_curve` snapshot.

VO2 max is never directly compared with FTP or rolling power-system capacity because it answers a different question and
may originate from a device estimate or laboratory observation.

#### Swimming pace and SWOLF

`training_swim_performance` provides twelve UTC-aligned weekly points with separate pool and open-water series.

- Pace uses an explicit Average Swim Pace stat.
- Pace is distance-weighted; elapsed duration is not used because rests would distort it.
- Missing pace stays `null` while weekly activity count and distance remain available.
- SWOLF uses active swim lengths only.
- One dominant stroke and pool-length context is selected across the 12-week range.
- SWOLF values from different strokes or pool lengths are never combined.
- CSS is not inferred from ordinary workouts.

The chart has a full-height layout and an inverted pace axis, because lower seconds per 100 m/yd means faster swimming.
Units follow the user's swim pace settings.

Its header states whether pool and open-water pace are both available or only one environment has evidence, then states
the number of explicit-pace weeks. The x-axis uses the shared compact `W35` marker convention; the visible key defines
`W` as a Monday–Sunday UTC week and the tooltip retains the full week number and date range. The card never derives
pace from elapsed duration or combines environments. A SWOLF follow-up appears only when the displayed value has one
matching stroke and pool-length context.

#### Power profile

Running and Cycling compare the 90-day best curve with the one-year best curve at:

```text
5 seconds, 1 minute, 5 minutes, 20 minutes, 1 hour
```

The shared sports-lib sampler:

- prefers an exact duration;
- keeps the strongest duplicate;
- interpolates in reciprocal-duration (`1/t`) space;
- requires neighboring durations within a 1.25 ratio by default; and
- never extrapolates outside the stored curve.

Retention is `recent / reference * 100`. Delta is retention minus 100 percentage points. The chart itself shows the
one-year curve; summary chips explain the 90-day retention.

The profile summary is a non-growing header above the embedded Power Curve. Its horizontal inset matches the chart
header so the summary, chart title, benchmark values, and plot remain aligned at every responsive width.

It also states the strongest supported conclusion before the chart, describes the number of recent/annual power workouts
and comparable duration points, and only highlights a duration for follow-up when it is materially below its annual best.

### 8. Body-weight Context

Overview only.

Body-weight context is the final Training section, after Settings vs Recent Evidence. Keeping it separate and last makes
the recorded measurements available without presenting them as a performance marker or a primary training signal.

The card shows the latest recorded value, current 7- and 28-day medians, eligible equal-window changes, and the sparse
28-day trend described in the shared Dashboard and Training insight reuse section. It remains neutral context and does
not affect Readiness, Form, TSS, the Training state, or any workout recommendation.

## Durability Deep Dive

Durability is shared between sports-lib, Training, Best Build, and event detail. It measures whether an athlete maintains
external output for a similar cardiovascular cost during a long, reasonably steady aerobic session. It is not a generic
score for every workout.

### Supported activities

The engine currently supports:

- Running, Treadmill, Indoor Running, Virtual Running, and Trail Running.
- Cycling, Indoor Cycling, Biking, Virtual Cycling, E-Biking, Hand Cycle, Velomobile, and standard Mountain Biking.
- Swimming and Open Water Swimming.

Support means the engine understands the activity type. An individual activity can still be explicitly ineligible.
Enduro MTB and Downhill Cycling are recognized separately as gravity MTB and always produce
`unsupported-context` ineligibility. They must never enter steady-aerobic Cycling durability, even if an older compact
stat marked them eligible. Quantified Self defensively rejects that legacy evidence until the matching sports-lib
release has been installed and affected sources have been reparsed. The policy stays on protocol v1; it does not add a
durability v2 or attempt downhill-run/lift segmentation.

Rowing and the other four newly curated families have no durability adapter in this release. Their generic Training and
Best Build summaries remain available without implying a long-session durability result.

### Input selection

| Context | Output | Required response/context |
| --- | --- | --- |
| Cycling and MTB | Power | Heart-rate stream |
| Running and trail | Grade-adjusted speed preferred | Heart-rate stream |
| Flat/indoor running fallback | Raw speed | Heart rate; indoor type or at least 80% flat grade coverage within +/-2% |
| Open-water swimming | Speed | Heart-rate stream |
| Pool swimming | Active-length pace | Dominant comparable stroke and pool length; SWOLF optional |

Cycling does not fall back to speed. Outdoor running does not use raw speed on arbitrary terrain. Pool swimming uses a
different consistency protocol because a one-hertz HR/output model is inappropriate for length-based data.

### Aerobic protocol v1

Protocol constants:

| Parameter | Value |
| --- | --- |
| Smoothing window | 60 seconds |
| Warm-up excluded | 10 minutes |
| Cool-down excluded | 5 minutes |
| Minimum activity duration | 40 minutes |
| Minimum qualifying paired data | 30 minutes |
| Minimum total and per-half coverage | 60% |
| Maximum output coefficient of variation | 0.25 |
| Maximum zones 4-7 ratio | 20% |

After warm-up and cool-down exclusion, the comparison window is divided into fixed wall-clock halves. Output and heart
rate are smoothed, but samples remain aligned to elapsed seconds. Aerobic efficiency is:

```text
efficiency = output / heart_rate
decoupling_percent = (first_half_efficiency - second_half_efficiency)
                     / first_half_efficiency * 100
output_retention_percent = second_half_output / first_half_output * 100
heart_rate_drift_bpm = second_half_heart_rate - first_half_heart_rate
```

Lower absolute decoupling and HR drift are interpreted as steadier. Higher output retention is interpreted as better.

Hard-zone exclusion uses power zones for power output when available, otherwise heart-rate zones. Zones 4-7 above 20%
make the workout too intense for this steady aerobic protocol. Missing zone stats do not create a hard-zone failure; the
variability and coverage gates still apply.

### Pool protocol v1

Pool durability:

1. Keeps active lengths only.
2. Rejects drill, unknown, mixed, IM, medley, and individual-medley stroke contexts.
3. Groups lengths by exact pool length and normalized stroke.
4. Selects the dominant context by length count.
5. Requires at least 24 comparable lengths and at least 8 lengths in each outer third.
6. Requires 40 minutes total activity duration, 30 minutes qualifying context duration, 60% context coverage, acceptable
   intensity, and pace coefficient of variation no greater than 0.25.
7. Compares the first and final thirds.

```text
pace_retention_percent = first_pace_seconds_per_100m
                         / final_pace_seconds_per_100m * 100
swolf_change = final_swolf - first_swolf
```

Higher pace retention is better. Lower SWOLF change is steadier. SWOLF remains unavailable if it is not recorded.

### Eligibility and missing evidence

Persisted ineligibility reasons include:

- `missing-output`
- `missing-heart-rate`
- `insufficient-duration`
- `insufficient-coverage`
- `insufficient-halves`
- `too-variable`
- `too-intense`
- `unsupported-context`

Unsupported activity types produce no durability summary. Supported activities produce a compact summary even when
ineligible, allowing Training to explain exclusions rather than treating them as zero.

### Persistence and invalidation

The activity stat is `DataDurabilityEvidence`, serialized as `Durability Evidence`. It stores:

- protocol version;
- deterministic source fingerprint;
- discipline and output source;
- optional pool context;
- duration and coverage;
- eligibility details; and
- compact eligible evidence.

It never stores the display timeline or a second copy of long streams.

Frontend event sanitization relies on sports-lib's `DynamicDataLoader` registry to retain serialized stats. The
`event-json-sanitizer.spec.ts` regression test therefore checks the literal persisted `Durability Evidence` key against
the real sports-lib registry without importing `DataDurabilityEvidence`; importing the class in that test could register
it as a side effect and mask a bundling or tree-shaking regression. Add an explicit runtime registration import only if a
deployed bundle reproduces the missing-registration warning.

The source fingerprint includes the protocol, effective activity type and duration, selected adapter policy, relevant
output/HR/grade streams, zone durations, and pool-length context. When any effective input changes, sports-lib
recalculates the stat. An unchanged, canonical stat is reused. A valid summary-only stat is preserved when raw inputs are
no longer available, except that a gravity MTB activity can always replace stale eligible evidence with the explicit
policy-only `unsupported-context` summary because that decision needs no retained stream.

Compact aerobic evidence rounds its persisted base output and heart-rate values before calculating efficiency, retention,
decoupling, and drift. This keeps the serialized summary arithmetically self-consistent at its stored precision, including
low-speed open-water evidence, so constructor validation cannot reject evidence produced by the analyzer itself.

Merged parent event summaries explicitly exclude child durability evidence because multiple contexts cannot be reduced to
one trustworthy event-level value.

### Quantified Self durability aggregation

Functions validates the persisted stat through sports-lib's canonical normalizer. It never reconstructs evidence from
average power, pace, HR, or raw streams.

Aggregation uses exact context keys:

```text
scope | output source | output unit | pool length or - | stroke or -
```

For each context, the worker stores medians for duration, coverage, decoupling, output retention, HR drift, pace retention,
and SWOLF change. Training compares:

- Current 28 days.
- Median of the three prior 28-day blocks.
- Twelve fixed UTC weeks for the trajectory.
- Up to five recent supporting eligible activities.

The workspace formats those supporting activities from their exact start instant in the viewer's local timezone; it does
not render an imported activity name as a date. Snapshots written before the exact instant was retained are invalid for
this metric only and automatically queue a durability rebuild. The MCP projection remains identity-safe: it exposes the
existing UTC day bucket, never that exact activity start.

The swimming-pace and durability trajectory x-axes use compact `W35` markers only on phone viewports; their visible
key defines `W` as a Monday–Sunday UTC week. Wider viewports show the week-start date instead, while tooltips retain
the full week number and date range. The durability summary remains a fixed twelve UTC weeks, but, when a later
candidate workout exists, its chart collapses only a leading uninterrupted run of weeks with zero candidates into a
short note. Any later zero-candidate week remains visible in the plot so training interruptions are not hidden.

The 12-week chart is a durability trend, not a general power-availability chart. For cycling power contexts, the
frontend reports candidates, activities whose processed durability evidence confirms recorded power, eligible samples,
and the primary ineligibility reasons already present in the snapshot. The power-confirmed count is the evidence count
minus `missing-output` and `unsupported-context` exclusions; it does not query activity history. Gravity Cycling receives
`unsupported-context` before Sports Lib inspects a power stream, so that evidence must not be presented as confirmed
power. Bar height shows power-recorded activities, the compact bar label shows `eligible / power-recorded`, and the line
appears only for eligible aerobic-decoupling evidence. A stored Power Curve alone therefore does not guarantee a
durability point. Sports-lib records one primary eligibility reason per activity, so aggregate exclusion copy must call
these **primary exclusions** rather than implying an exhaustive list of every threshold that activity missed.

Training shows a durability scope tab only when that scope has recorded candidate or summary evidence in a retained
current, usual, baseline, or weekly window (or a recorded supporting workout). This applies to every supported scope,
not only Pool and Open water: a no-data capability must not create an empty tab beside a scope with evidence. Scopes with
recorded candidates remain visible even if none is eligible, so their missing-evidence and primary-exclusion copy stays
inspectable. When a selected sport has no recorded durability evidence in any of its scopes, Training shows one explicit
empty state instead of tabs.

Cycling has one fixed durability context, `cycling|power|W|-|-`. When a valid Cycling scope has no eligible summary in any
retained window, the frontend materializes that known context so the 12-week evidence chart remains mounted. This does
not synthesize a durability metric: the line stays absent, and the snapshot's candidate, power-confirmed, eligible,
missing-evidence, and primary-exclusion counts remain visible. Missing processed evidence stays distinct from a confirmed
`missing-output` exclusion; the chart labels it as power unknown rather than no power.

The trajectory chart host is conditionally mounted only after its view model exists. Its Angular view query must remain
dynamic and initialize through the shared ECharts host controller when that element appears; a static query resolves
before the conditional view and leaves the chart blank. Conditional removal can also race the controller's lazy ECharts
load: disposal invalidates both the pending result and every caller waiting on that lifecycle, then the controller
serializes a fresh initialization against the replacement element. Otherwise a completed chart can bind to the detached
host and leave the visible replacement blank. The component lifecycle spec must exercise delayed host insertion and a
remove/reinsert cycle during pending initialization rather than only assigning a synthetic element before testing chart
options. A Material durability-tab animation also explicitly refreshes its active trajectory after the animation ends,
so the ECharts canvas measures the visible tab body rather than a transitional layout.

The usual value is withheld unless evidence exists in at least two baseline blocks with at least two samples in total.
Best Build requires at least two samples on both sides of the exact context.

Coverage distinguishes:

- candidate activities;
- activities with any durability stat;
- eligible activities;
- missing evidence;
- ineligible evidence; and
- exclusion reasons.

Older activities parsed before the durability stat existed can remain `missingEvidenceActivityCount` until a sports-lib
reparse processes them. If the original source is unavailable, missing evidence remains honest and permanent.

Sports-lib reparse persistence keeps event, activity, and metadata writes behind the account-deletion guard. Its Firestore
transaction writes use a bounded retry for transient transaction failures, including Firestore's retryable
`INVALID_ARGUMENT: Invalid transaction` response, and emit phase logs for `write_all_event_data`, `merge_metadata`,
`delete_stale_activities`, and `processing_metadata`. Use those phase logs to identify which persistence step failed in
long-running heavy reparse jobs before changing queue retry policy.

### Event detail reuse

Event detail uses the same sports-lib analyzer and may request a transient timeline for visualization. This does not alter
the Training rule: aggregate Training snapshots use only persisted compact activity evidence.

The event performance-chart region uses a shared `23.1vh` height. On extra-small viewports, the durability eligibility
summary starts collapsed behind an accessible disclosure button so the plot retains useful vertical space. Expanding the
summary keeps its list height bounded and scrollable instead of allowing evidence rows to squeeze out the chart. Desktop
viewports continue to show the summary by default. The event summary translates the aerobic protocol rather than exposing
implementation labels such as `decoupling`, `paired coverage`, or `qualifying data`: it states whether a steady-effort
comparison is available, the total duration and matched output/heart-rate duration after warm-up and cool-down exclusion,
then narrates the second-half change in output relative to heart rate, output retained, and average heart-rate change.
When every supported selected activity has only `missing-output` evidence and no timeline can render, Event Details hides
the Durability tab and shows a compact data-requirements notice instead. Other ineligible states keep the tab because their
per-activity eligibility explanation remains useful.
For cycling, a positive stored decoupling becomes “Power relative to heart rate was <n>% lower in the second half.” The
event durability ECharts grid reserves explicit left and bottom insets for numeric axis labels; do not rely only on
automatic outer-bound containment, which can crop the leading digit on narrow plot hosts.

Both event detail and the Training Durability panel expose a **How to read durability** info control. It uses a
desktop Material menu and a mobile Material dialog instead of a short opaque tooltip. The guidance explains that a lower
later output-to-heart-rate ratio is meaningful as a possible fade only when the athlete intended a comparable steady
effort; intentional easing, changing terrain, coasting, or a pace change can legitimately produce the same pattern. It
also explains that Training is for repeated comparable-session trends (smaller absolute decoupling/heart-rate drift and
higher output retention are steadier), and that a missing result means no suitable comparison—not zero durability.
The trigger uses the same compact 20 px Material title-info control and 16 px icon as other chart headers.

## Status and Empty-State Semantics

Snapshot status and payload validity are separate concerns. A `ready` document with the wrong schema or an invalid payload
is treated as stale and re-requested.

UI principles:

- The Training route root uses the shared `qs-workspace-page` shell, so its outer 1440 px width and responsive gutters
  match Dashboard, Calendar, Routes, and Compare files. Training cards and charts retain their own responsive constraints
  inside that shell.
- Primary numeric and stat values use the app's locally bundled Barlow Condensed family with tabular numerals. In mixed
  stat copy, only numeric expressions and their attached units use Barlow Condensed; comparison words and other context
  inherit Inter. Headings, labels, status words, and narrative explanations remain in Inter. ECharts continues to use its
  shared Barlow Condensed font token so chart typography matches the surrounding Training metrics.
- On desktop, Training uses a 15 px route base with 14 px card-body copy, 13 px captions, 12 px microcopy, and 11 px fine
  print. Mobile restores the compact 14/13/12/11/10 px scale. Card titles stay at 16 px and secondary key stats at 20 px,
  matching embedded Dashboard charts. The four primary **What Drove This** comparison claims use 24 px to lead their cards.
  Hero summaries remain intentionally larger, while dense comparison tables, supporting chart values, and evidence captions
  remain intentionally smaller.
- Training-specific ECharts tooltips use the shared viewport-safe tooltip surface on larger screens so card and scroll
  containers cannot crop them. Narrow screens retain tap-triggered interaction; charts that fit their card remain
  confined, while the horizontally scrollable durability chart also uses the viewport-safe surface.
- Responsive icon-only Training actions use plain Material buttons rather than outlined containers, hide only their
  projected text label, and reset Material's icon-and-text margins. This keeps their visible icons consistent with
  Dashboard header actions while preserving Material focus, ripple, and touch-target elements.
- Readiness history and body-weight trend use compact ECharts canvases inside their parent card surfaces rather than
  nested neutral containers. Their null observations remain visible gaps, and their shared safe tooltip surface keeps
  the detail readable without being cropped by the card.
- Durability evidence and its trajectory inherit their parent Training card surface. Borders and dividers preserve the
  hierarchy without stacking gray inset surfaces inside the card.
- `missing`, `queued`, `processing`, `building`, and `stale` show a preparing/updating state.
- `failed` shows a retry-oriented unavailable state.
- A previous valid payload may remain visible while a replacement builds.
- Dashboard and Training surface a route-level derived status before any retained values, using existing fixed-height
  header slots rather than conditionally inserting a content banner. The status distinguishes building from refreshing
  any available retained values, and failed refreshes expose Retry in the same header. Optional snapshots participate
  only when they currently back a visible value or configured tile.
- A chart with no previous payload is not mounted while its snapshot builds. Training shows a compact, bounded status card
  instead, so chart minimum heights and overlays cannot stretch or bleed during the initial load.
- A valid payload with zero eligible data shows a domain-specific empty state, not a spinner.
- A durability week without an eligible sample must expose candidate/input counts, missing processed evidence, and
  primary exclusion reasons rather than using an unexplained `Empty` label. Unknown processed evidence must remain
  distinct from a confirmed missing output signal.
- Null optional metrics render as an em dash or unavailable copy, never zero.
- Compact loading cards remain readable without reserving the full chart canvas. Ready empty states keep the full chart card
  height so their domain-specific explanation is not compressed.
- Comparison colors use metric semantics: more is not automatically better. Lower pace, lower absolute decoupling, lower
  bedtime variation, and lower SWOLF change have inverse semantics.

Frontend payload normalizers are security and resilience boundaries. Treat Firestore payloads and user settings as
untrusted input even though Functions produced them.

## Security and Write Safety

The metric-affecting Best Build setting continues through `setTrainingBuildBenchmark`. That callable requires:

- Firebase Authentication;
- App Check;
- strict request normalization;
- a user deletion guard before work; and
- a second deletion guard inside the write transaction.

The frontend must not write `trainingSettings` directly. Benchmark writes use merge semantics and touch only the
requested discipline branch, so clearing one benchmark cannot overwrite another discipline's benchmark.

Destination and shortcut preferences are non-metric UI state. The frontend writes only
`appSettings.trainingWorkspace` through `AppUserSettingsQueryService` and the normal owner-authorized
`users/{uid}/config/settings` Firestore rule. Each write verifies the expected signed-in UID, uses merge semantics, and
propagates failures to the UI. The service accepts only `preferredDestination` and `sportShortcuts`, validates the
destination against the registry, and canonicalizes only `null` or a unique non-empty list of at most four supported
shortcuts before writing. Firestore rules continue to reject all client mutations of `trainingSettings`, including the
deprecated legacy visibility field. `setTrainingVisibleDisciplines` is retired from source and the Functions manifest;
remove its already-deployed endpoint separately after the compatible frontend release is available.

Derived triggers and workers also check deletion state before enqueueing and before writes. Never add user-scoped async
state without extending recursive deletion handling and deletion guards.

## Extending Training Safely

### Adding an activity to an existing discipline

1. Add or normalize the activity type in sports-lib.
2. Add the exact canonical type to one existing context in `TRAINING_SPORT_DEFINITIONS`; duplicate assignment fails at
   registry initialization.
3. Confirm the context's profile, load/intensity/distance policies, metrics, and family capabilities are still correct.
4. Update the registry membership and resolver tests, including an explicit nearby type that must stay Other.
5. Decide independently whether sports-lib durability has a physiologically valid adapter. Add sports-lib tests when it
   should be supported; otherwise leave it unsupported or add an explicit policy ineligibility when stale evidence must
   be invalidated.
6. If sports-lib changed, rebuild and publish it before updating Quantified Self dependency locks.

Do not add provider aliases directly to the Training builder.

### Adding a new Training discipline

Add one definition to `TRAINING_SPORT_DEFINITIONS` with its presentation metadata, disjoint contexts, exact canonical
activity types, profile, policies, metrics, and capabilities. The registry-derived family union, visible-discipline and
benchmark contracts, accumulators, callable validation, automatic/fixed shortcuts, destination grouping, and generic profile tables should
then extend without another family branch. Add focused tests that prove those consumers picked it up, plus help and this
document. If a new requirement cannot be expressed as registry data or a reusable capability, add one reusable policy
primitive rather than branching on the new family throughout the backend and UI.

Imported FTP/VO2 capacity support must remain independently modeled. Do not grant a new discipline the `capacity`
capability merely because it joins Training; `POWER_CAPACITY_DISCIPLINES` derives automatically from that explicit
capability. Rolling power-system capacity does not require a curated Training discipline; a canonical exact activity
type and a usable persisted power curve are its capability boundary.

### Adding a new durability context

Prefer a capability-based sports-lib adapter with:

- explicit supported activity types;
- output-source priority;
- physiological response source;
- eligibility rules;
- comparison segmentation; and
- a stable context key.

Do not reuse raw outdoor speed where terrain, current, wind, motor assistance, or machine resistance makes it
physiologically incomparable. Rowing would require a separately justified adapter and validation before gaining the
durability capability. Strength, team sports, climbing, gravity MTB, downhill skiing, and multisport aggregates need
different fatigue models rather than this steady aerobic protocol.

### Adding a derived metric

1. Add the kind and payload to `shared/derived-metrics.ts`.
2. Decide whether it is default, projection-sensitive, calendar-sensitive, Dashboard-visible, or Training-only.
3. Add a backend build-registry entry with the narrowest source dependencies.
4. Add a pure builder and focused Functions tests.
5. Add a strict frontend normalizer and focused tests.
6. Register snapshot status/context parsing in `DashboardDerivedMetricsService`.
7. Add explicit loading, failed, empty, and ready UI states.
8. Bump `DERIVED_METRIC_SCHEMA_VERSION` only when existing snapshots must be invalidated.
9. Add the exact redacted payload contract to the exhaustive
   `functions/src/mcp/derived-output-schemas.ts` map. Update the positive fixture and identity/provenance leakage
   canaries in `functions/src/mcp/tool-output-schemas.spec.ts`; a new kind without both must fail build or tests.
10. Update this document and user help.

Do not read settings or sleep unconditionally in the worker. Source requirements are part of the performance contract.

### Exposing Training snapshots through MCP

The read-only MCP server does not recalculate Training metrics and does not scan activity history for a derived tool call.
`get_training_metric` accepts only a kind registered in `DERIVED_METRIC_KINDS` and reads the normal
`users/{uid}/derivedMetrics/{metricKind}` snapshot. It returns only a `ready`, current-schema payload plus schema, update,
and source-count metadata. Building, stale-schema, failed, and missing snapshots remain unavailable instead of being
interpreted as zero.

`list_training_metrics` is the lightweight discovery path. Its human title, description, category, and period label map
is compile-time exhaustive against `DERIVED_METRIC_KINDS`; it is presentation metadata, not a competing calculation or
kind registry. For the optionally searched kinds it reads only snapshot identity/status/schema/update/source-count
envelope fields, validates the entry type and metric kind, and reports
ready/building/failed/stale/missing/schema-mismatch. It never returns payloads, worker error text, event identity, or
device/provider provenance. Clients should use it before `get_training_metric` so a missing or rebuilding snapshot is
not mistaken for an unsupported Training capability.

The explicitly named live `get_today_readiness` tool is not a derived-snapshot projection. It requires both
Training-metric and sleep grants, reads the ready Form/Form Now/Ramp snapshots plus one bounded normalized sleep query,
rebuilds the same current UTC-day zero-load decay used by Dashboard Today, and calls the shared readiness evaluator. It
exists because the persisted 14-day `training_readiness` point can lag newly imported sleep and because the registered
daily-briefing schema is frozen. The additive `get_daily_report` shares that live loader and evaluator, exposes only
average/overnight HRV plus average/minimum sleep HR for the latest grouped main sleep, and adds the existing strict
Training Summary projection. `shared/training-load.ts` owns the canonical daily load builder and CTL/ATL constants used
by the frontend, live MCP projection, and derived-metric backend, while `shared/readiness.ts` owns scoring and evidence
selection. Never replace either MCP allowlist with raw snapshot, provider, or sleep-session documents.

The built-in Assistant consumes this same strict `get_training_metric` projection. Its optional deterministic chart
adapter takes Training titles from the MCP catalog and plots only supported trend arrays. For the `form` payload it
passes the projected daily loads through `shared/training-load.ts` so CTL, ATL, and Form match the workspace and derived
backend exactly; it does not maintain another formula. The adapter refuses an implausible expansion beyond 20 years,
downsamples the resulting display series within the shared Assistant payload budget, and never exposes raw snapshots or
provider/device provenance to Gemini as visual configuration.

There is deliberately no separate MCP metric-discovery registry. A newly registered kind is discoverable, but its payload
must still pass the MCP privacy boundary in `functions/src/mcp/data.service.ts` and the exhaustive safe-payload schema map
in `functions/src/mcp/derived-output-schemas.ts`. The server recursively removes event/activity IDs, names, and labels,
including identities nested under event- or activity-named parents. It also removes source fingerprints and imported
device/provider provenance (`sourceKey` and `previousSourceKey`). The strict schema then rejects any undeclared field
before serialization. If a new payload introduces another identity- or provenance-bearing field, extend the redaction,
exact schema, positive contract fixture, and negative leakage canary before release rather than relying on client
behavior.

Use `.agent/skills/mcp-metric-surface/SKILL.md` for every derived-kind change. The MCP contract suite must prove that
`Object.values(DERIVED_METRIC_KINDS)` exactly matches the safe schema and fixture maps, that the advertised
`get_training_metric` conditional selects the matching payload, and that `structuredContent` validates for every kind.
The transport, scopes, query bounds, sleep projection, and Sports Lib event-stat discovery are documented in
`docs/mcp-server.md`.

## Testing and Verification

### Sports-lib

From `../sports-lib`:

```bash
npm test -- --runInBand \
  src/events/utilities/activity-durability.spec.ts \
  src/events/utilities/power-curve-sampling.spec.ts \
  src/events/utilities/three-dimensional-capacity.spec.ts
npm run build
```

Run the full sports-lib suite before publishing a version that changes serialized evidence or public exports.

### Functions

From the Quantified Self root:

```bash
npm --prefix functions test -- \
  src/derived-metrics/derived-metrics.service.spec.ts \
  src/derived-metrics/set-training-build-benchmark.spec.ts \
  src/tasks/derived-metrics-worker.spec.ts \
  src/tasks/derived-metrics-ingress-worker.spec.ts
npm --prefix functions run build
```

Also run trigger and Cloud Tasks tests when refresh plumbing changes. Run Firestore/Storage rules tests when security rules
or persisted write paths change.

### Frontend

Run the closest helper/component specs, including:

```text
training-workspace.component.spec.ts
training-build-benchmark-dialog.component.spec.ts
training-sport-visibility-dialog.component.spec.ts
training-analysis.helper.spec.ts
training-capacity.helper.spec.ts
training-power-systems.helper.spec.ts
training-derived-metrics.helper.spec.ts
training-durability-view.helper.spec.ts
training-explanation-view.helper.spec.ts
training-power-profile.helper.spec.ts
dashboard-training-insights.helper.spec.ts
training-readiness.helper.spec.ts
training-recovery-estimate.helper.spec.ts
training-swim-performance.helper.spec.ts
training-durability-trajectory-chart.component.spec.ts
durability-reading-guide.component.spec.ts
training-readiness-trend-chart.component.spec.ts
training-body-weight-trend-chart.component.spec.ts
training-summary-cards.component.spec.ts
training-metric-grid.component.spec.ts
event-json-sanitizer.spec.ts
```

Then verify:

```bash
npx tsc --noEmit -p src/tsconfig.app.json
npx ng build --configuration local
git diff --check
```

### Browser QA matrix

Inspect authenticated `/training` at desktop, tablet, and narrow-mobile widths. Cover:

- Overview, every registered sport, and Other power activities;
- automatic and fixed one-to-four-sport shortcuts, legacy fallback, and a selected off-shortcut sport;
- desktop hybrid navigation, intermediate-width wrapping, and the mobile shortcut rail plus complete-destination sheet;
- rapid destination switching, a pre-acknowledgement local Firestore echo, failed persistence, and an account switch
  during an in-flight preference write;
- benchmark unset, saving, updating, invalid, cleared, and ready;
- event and manual benchmark flows for 8/10/12 weeks;
- no TSS, no zones, no pace, no SWOLF, and no sleep;
- limited and cross-provider sleep;
- Readiness today preparing, unavailable, partial, full-evidence, 48-hour expiry, stale history, chart-gap, active and
  elapsed Recovery left, and expandable Sleep history states;
- Dashboard Today Training state and Readiness with full, partial, and missing evidence, matching Form/ramp fallbacks,
  plus Today hidden and retired local-preview tile cleanup;
- durability missing evidence, ineligible evidence, sparse baseline, and ready comparison;
- one and multiple imported-capacity cards;
- no, one, and multiple exact Power systems types, including registered non-Running/Cycling types and unmatched types
  under Other power activities;
- Power systems ready, partial, insufficient-evidence, poor-fit, unstable, invalid-input, and stale-payload states;
- loading, stale, failed, and valid empty snapshots;
- dark and light themes;
- no horizontal overflow; and
- no browser console errors.

## Local Development and Diagnostics

Start with the repository workflows in `.agent/workflows/serve-local.md` and
`.agent/workflows/start-emulators.md`. Build Functions before starting the emulators.

Functions runtime code must import `FieldValue`, `Timestamp`, and `FieldPath` from `firebase-admin/firestore`. Do not
access those statics through `admin.firestore`: the Functions emulator replaces that namespace with a callable proxy
that does not retain the Admin SDK's legacy static exports.

The localhost frontend normally calls emulated Functions; `local-prod-functions` explicitly targets production Functions.
Backend code can still reach real services depending on environment variables and credentials, so verify the active
project and never assume `localhost` means isolated data.

The Functions emulator sets `FUNCTIONS_EMULATOR=true`, which bypasses the manual callable App Check guard only inside
that local worker. Production and beta callables continue to require App Check. This keeps a hosted debug-token exchange
failure from blocking a loopback Training refresh; it does not weaken deployed endpoints.

Derived metrics also require the Cloud Tasks emulator configuration used by this repository. When
`CLOUD_TASKS_EMULATOR_HOST` is set, task lookup and queue statistics stay local and must not fall through to the production
Cloud Tasks API.

### Sports-lib reparse observability

Admin reparse status reports automatic scanning separately from Cloud Tasks queue state. `automaticScanEnabled` controls
whether the scheduled event or route scanner can discover and enqueue new candidates; a Cloud Tasks queue reports whether
already queued work can dispatch. A `RUNNING` Cloud Tasks queue does not enable automatic reparse, and a disabled scanner
does not pause Cloud Tasks. Keep these labels distinct in operational UI and diagnostics.

Source-backed reparses preserve meaningful existing activity creator names so user device renames survive parser
upgrades. Parser placeholders (`Unknown` and `Unknown Device`) yield only when the newly parsed activity contains a
meaningful creator identity; when the new parse is also blank or a placeholder, the existing placeholder remains. Keep
this rule aligned across the backend reparse worker and both frontend source-hydration paths so loading the same retained
original cannot produce different creator metadata.

When Training appears stuck on Preparing:

1. Check the browser snapshot status and console.
2. Inspect `users/{uid}/derivedMetrics/coordinator` status, generation, dirty kinds, timestamps, and `lastError`.
3. Inspect the requested snapshot document's status, schema, mutation version, payload, and `lastError`.
4. Confirm `ensureDerivedMetrics` was called and whether it returned `queued: true` or `false`.
5. Check derived ingress and worker logs for the same UID and generation.
6. Confirm the Cloud Tasks emulator/queue is running and dispatching both ingress and derived worker tasks.
7. Confirm Functions and frontend use compatible `shared/derived-metrics.ts` contracts.
8. Confirm both root and Functions installations use the expected sports-lib version.

Do not fix Preparing states by adding frontend history queries, polling raw activities, or reparsing files in Angular.

For durability specifically, distinguish:

- **Missing snapshot:** refresh/queue problem.
- **Missing evidence:** activity was not parsed with a compatible durability stat.
- **Ineligible evidence:** sports-lib processed it and recorded a reason.
- **No comparable usual:** current evidence exists, but the prior blocks are too sparse.

## Release Order

When a Training change depends on a new sports-lib version:

1. Build and test sports-lib.
2. Publish the exact sports-lib version.
3. Install that published version in both root and `functions`, then verify both lockfiles resolve the same artifact.
4. Deploy Functions before the frontend so new-schema clients do not read old builders.
5. If the release introduced a parser-owned activity stat, allow the existing reparse process to populate it where
   original sources exist. Rolling power-system capacity does not use this step because it rebuilds from stored curves.
6. Deploy the frontend.
7. Verify a real account with ready, partial, sparse, and missing-data states.

Existing snapshots rebuild lazily after a schema bump. Schema 16 added the eight-family context/profile summaries;
schema 17 adds their reusable maximum aggregation and longest-jump metric. The longest-jump rebuild reads the canonical
Sports-lib `Maximum Jump Distance` already persisted by version `18.1.2`, so this Quantified Self change does not itself
require reparsing. The registry also accepts Sports-lib's historical `Jump Distance Max` alias. An older activity that
still lacks either stat remains unavailable until the existing targeted reparse lifecycle processes its retained jump
events. Sports-lib's 18.1.2 gravity-durability policy emits explicit `unsupported-context` evidence for
Enduro/Downhill activities. The Functions
aggregator also rejects legacy eligible Enduro/Downhill durability evidence defensively. Reparse affected existing
activities through the targeted sports-lib reparse lifecycle so their persisted compact evidence adopts the corrected
result. This is a policy correction within durability protocol v1, not a v2 migration.

Sports-lib 18.1.3 also canonicalizes Snorkeling and Mermaiding and assigns both to the existing Diving group. They do
not join a curated Training discipline, change durability, or require a derived-schema bump or historical reparse.
Sports-lib 18.1.4's FIT record-depth mapping supports frontend Event Details dive profiles.
That continuous source-hydrated stream is not a Training input, does not change durability or derived schemas, and does
not require a Training rebuild or historical reparse.

Sports Lib `19.0.0` introduced the semantics used by schema 18, which replaces the Training profile metric named
`cadence` with
`stroke-rate` for pool/open-water swimming, indoor/on-water rowing, canoeing, kayaking, paddling, and stand-up paddling.
The builder prefers canonical `Average Stroke Rate` but accepts the pre-19 `Average Cadence` stat for those activity
types, so existing derived snapshots rebuild from stored event/activity documents. No original-file reparse or
historical Firestore rewrite is needed solely for this semantic transition.

Sports Lib `19.1.0` introduced parser-owned, source-native dive summaries and continuous dive
streams for the Diving group. Quantified Self displays only values supplied by the retained source: it does not derive
missing summaries from samples, reconstruct samples from summaries, fill gaps, apply plausibility thresholds, promote
lap-only values, or flatten gas/tank messages. New imports persist the available summary stats; an ordinary targeted
Sports Lib reparse is required only when an existing event must persist newly available parser summaries or the
corrected canonical type for an explicit Garmin dive sub-sport. Single-gas, multi-gas, and gauge diving map to Scuba
Diving; apnea diving and apnea hunting map to Free Diving; unrepresented dive sub-sports remain Diving. Continuous Dive
Profile streams are hydrated on demand from the retained source and need no Firestore rewrite. MCP exposes the persisted
numeric summaries through its automatic catalog; its frozen continuous chart tools are unchanged.

Sports Lib's dive presentation types do not change that persistence boundary. The first swim-pace preference selects
meters/meters per second or feet/feet per second for Event Details display, and the data classes retain the FIT field
precision. Those unit-derived display instances do not replace the canonical meter/meter-per-second stats in stored
JSON, do not become Training inputs, and do not require a reparse or derived rebuild.

Sports Lib `20.1.0` introduced nonnumeric parser-owned FIT `dive_gas`, `tank_summary`, and `tank_update` records for
the Event Details **Gas & Tanks** section. Sports Lib `20.1.1` serializes them in optional activity
`diveSourceRecords` JSON, so new imports and source-backed targeted reparses persist the exact records alongside the
activity. Older activity documents can still display their records while their retained original is available. The
records remain nonnumeric source data: they are not Training inputs and do not change durability, Training schema 18,
or any derived payload. Use a targeted reparse only when a specific retained original should persist its legacy
records; do not rebuild Training snapshots, enable the global reparse scanner, or enqueue a global historical reparse
solely for these dive records.

Sports Lib `20.2.0` classifies Hand Cycle and Velomobile in the Cycling group. Quantified Self routes both to the
standard Cycling context, where they use the normal endurance summaries and Cycling durability protocol when their
recorded evidence qualifies. This group-membership change does not require a derived-schema bump or source reparse.

Sports Lib `20.3.0` adds canonical Health and Sleep scalar JSON classes. Training uses the shared dual reader for the
sleep duration, score, HRV, and sleep-heart-rate aggregates it already consumes; no Training formula or derived schema
changes. Existing normalized Sleep documents use the dedicated Health/Sleep scalar migration, not an activity reparse,
and do not require a Training snapshot rebuild solely for this storage transition.

The repository now pins Sports Lib `20.3.0`; `20.0.3` introduced the FIT parser `5.0.2` transition. New FIT imports
persist session field 196 as canonical `Metabolic Calories`; they do not emit a replacement `Resting Calories` stat.
Existing persisted Resting Calories values remain historical values until a source reparse replaces their source stats.
They are neither renamed nor used to infer Metabolic Calories. The same parser transition corrects FIT `Average VAM`
from its source meters-per-second representation to Sports Lib's public meters-per-hour metric. Sports Lib also removes
Diving-group terrain summaries for ascent/descent, altitude minimum/maximum/average, and grade
minimum/maximum/average while retaining the source streams needed for dive views.

Sports Lib `20.0.3` also applies that eight-metric Diving-group rule when regenerating a parent event summary. A parent
made entirely of Diving-group activities omits `Ascent`, `Descent`, `Minimum Altitude`, `Maximum Altitude`, `Average
Altitude`, `Minimum Grade`, `Maximum Grade`, and `Average Grade`; a mixed parent aggregates those values only from
its non-Diving child activities. Quantified Self's existing source-backed reparse calls Sports Lib regeneration just
before the sanitized event/activity write, and its event merge path uses the same library semantics. Use the existing
targeted Sports Lib reparse lifecycle for a retained original that should gain Metabolic Calories, corrected Average
VAM, or a corrected persisted parent terrain summary. The target follows the installed package version automatically;
keep the automatic scanner disabled unless a separately approved operational campaign is intended. These values are
not Training inputs, so this parser upgrade does not require a Training schema bump, derived-snapshot rebuild, or a
synthetic Firestore migration.

A new parser-owned activity stat may additionally require a reparse; changing only the derived schema cannot create a
missing activity stat or reconstruct a missing continuous stream.

## Maintenance Checklist

Before merging a Training change, confirm:

- [ ] Sports and activity groups still come from the shared registry.
- [ ] Multisport parent load is not double-counted.
- [ ] Child activity stats are not contaminated with parent stats.
- [ ] Merged benchmark events and future events are excluded where promised.
- [ ] Optional values remain null instead of zero.
- [ ] The frontend does not query activity/event history or raw streams.
- [ ] sports-lib remains the only durability calculation owner.
- [ ] Sports-lib remains the only CP/W′/Pmax fitting owner; Quantified Self owns only the documented dated-window policy.
- [ ] Power-system capacity is isolated by exact canonical activity type and excludes its effective day.
- [ ] Settings writes are authenticated, App-Check protected, deletion guarded, normalized, and branch-scoped.
- [ ] Source dependencies are fetched only for metric kinds that need them.
- [ ] Snapshot schema and frontend normalizers agree.
- [ ] New or changed derived kinds have an exact MCP payload schema plus ready-state, structured-output,
      identity-redaction, and device/provider-provenance contract tests.
- [ ] Loading, failed, empty, updating, invalid, and ready states are readable.
- [ ] Metric delta colors follow metric semantics.
- [ ] Help content and this document are current.
- [ ] Focused tests, Functions build, frontend build, sports-lib build, and `git diff --check` pass.
