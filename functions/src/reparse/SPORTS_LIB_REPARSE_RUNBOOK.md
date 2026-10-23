# Sports-Lib Reparse Runbook

## Purpose
This pipeline reparses existing events and activities from stored original files so event/activity data is upgraded to a fixed sports-lib target version.

Target version source of truth:
- `SPORTS_LIB_REPARSE_TARGET_VERSION`
- File: `functions/src/reparse/sports-lib-reparse.config.ts`

### Sports Lib 23.7.0 metric lookup performance adoption

Root and Functions pin the same published 23.7.0 artifact with matching lockfile integrity. Built-in metric constructors
and aliases are indexed once, accelerating existing hydration while preserving canonical names, precedence, values,
units and validation. QS keeps its current full event readers; the additive `EventSummary.fromJSON` API is not adopted
by this dependency update and must not be cast to an editable event or used as a persistence payload.

No historical activity or saved-route reparse, summary regeneration, Training rebuild or derived schema change is
required. Existing Training, durability, parsing, sanitized persistence, retry/deletion and version-mismatch contracts
remain in force. Runtime version detection and activity/route reparse targets follow the installed version; scanner
settings are unchanged. Review already-enabled scanners before any separately approved deployment.

MCP metric discovery, aliases, persisted-only availability, sensitive-field exclusions and public contracts are
unchanged. No registered-contract promotion, client rescan or plugin rebuild is needed. User-facing workflows and
metric meanings are unchanged, so existing Help content remains applicable. This adoption does not deploy or start a
production reparse.

### Sports Lib 23.6.0 dependency and GPS calculation adoption

Root and Functions pin the same published 23.6.0 artifact with matching lockfile integrity. Runtime version detection
and the strict activity/route reparse target follow the installed version. The independent Functions FIT Parser pin
remains 6.2.2. Existing parser calls already handle promises; SML XML loads its parser on demand, while SML JSON and
native JSON hydration do not load that parser. Deploy all generated browser chunks together.

Generated GPS distances now use the library's haversine calculation. Recorded distances retain priority. Small
interval differences, including zero for identical coordinates, can affect generated speed, pace, moving time,
grade-adjusted statistics and dependent Training evidence. New imports and on-demand source hydration use the new
calculation; stored summaries and private load evaluations remain unchanged until the normal source-backed lifecycle
rewrites them. To apply the calculation historically, use a separately authorized original-file reparse and normal
derived invalidation. Preserve current controls, dated policies, strict leg identities, source-write reservations,
retry/deletion guards and stream-stripping sanitizers. No blanket historical campaign, saved-route correction,
derived schema bump or new persistence path is required.

MCP catalog membership, canonical names/units, output schemas, scopes, consent, planning reads/mutations and provider
delivery are unchanged. Existing persisted queries and bounded on-demand chart/sample projections consume the same
fields. This adoption requires no registered-contract promotion, client rescan or plugin rebuild. Existing Help
guidance about recorded values and source-backed reimport remains applicable.

Scanner configuration, queues and monitoring are unchanged. Review already-enabled activity/route scanner settings
before a separately approved deployment because their version target advances with the package. This upgrade does
not deploy, change cloud configuration, enable scanning or authorize a production reparse.

### Sports Lib 23.5.1 summary metadata and swim-average adoption

Root and Functions pin the same published 23.5.1 artifact, with matching lockfile integrity. Runtime version detection
and the strict activity/route reparse target follow that installed version. The direct Functions FIT Parser pin,
scanner settings, queue lifecycle, retry/deletion guards and monitoring coverage are unchanged.

Complete family metadata now groups the existing speed, swim-pace, air-power and partial dive summaries correctly.
Existing feet-, mile- and yard-based variants report imperial metadata without changing their canonical values,
unit strings or JSON. These metadata/display corrections require no historical reparse or summary regeneration.
Training load, durability formulas and canonical swim-performance inputs are unchanged; no derived schema bump or
Training rebuild is needed for this patch.

New imports derive a missing per-100-yard swim average from `Average Swim Pace`, preserving genuine zero and existing
source-provided per-yard summaries. Missing per-yard values can be regenerated from retained canonical swim averages.
Previously saved incorrect derived per-yard values remain authoritative during JSON hydration: correct affected
swimming activities only through the separately authorized original-file reparse lifecycle and sanitized writer.
No blanket historical campaign or saved-route reparse is required.

MCP catalog membership, metric identifiers, persisted-only availability, schemas, consent and sensitive-field exclusions
are unchanged. Existing `unitSystem` descriptors reflect the imperial correction. No registered-contract promotion,
client rescan, plugin rebuild, deployment or production reparse is part of this dependency adoption. Review any already
enabled scanners before a separately approved deployment, because their version target advances with the package.

### Sports Lib 23.5.0 power and R–R adoption

Root and Functions install the same published 23.5.0 artifact, with matching lockfile integrity and runtime versions.
The independent direct Functions FIT Parser pin remains unchanged. The reparse target follows the installed library;
strict runtime/job version checks, superseded-job handling and rollout retries remain in force.

Before a separately approved deployment:

1. Verify both installed versions and lockfile integrity match the published artifact.
2. Run power/R–R adoption, chart, Training load, reparse/worker, derived source and MCP contract tests; build Functions
   and production/beta frontend outputs, including public-startup and service-worker guards.
3. Review scanner runtime settings. An enabled scanner can enqueue eligible older activities/routes when the installed
   version advances; disabling one requires its own explicit approval.

Missing FIT/TCX/GPX watts remain null, while recorded zero remains coasting. The library calculates power summaries,
efforts, work and load from supported active intervals; QS must not insert zeros or carry readings across gaps. New
imports and on-demand source hydration use that behavior after adoption. Historical stored summaries, curves and load
evaluations require the existing authorized source-backed reparse; a Training refresh cannot reconstruct source evidence.
Reparse keeps imported scores, current controls, dated policies, strict leg identities, source reservations, retry and
deletion guards. Sanitizers still strip all streams. Normal semantic source invalidation refreshes affected snapshots,
including when a statistic becomes unavailable; there is no new schema, queue, scanner setting or bulk-write path.
R–R statistics now come from supported original beat intervals, not ordinary HR or resampled IBI chart data.
The SML XML adapter uses the first UTC sample to anchor beats; corrected timing can change derived HR/load. Native
JSON retains raw IBI sample times for in-memory analysis, while Firestore still stores only sanitized summaries.
Historical saved R–R statistics require the same authorized source-backed reparse. No saved-route correction is needed. See the
[Training adoption contract](../../../docs/training-workspace.md#sports-lib-2350-power-and-rr-adoption) for calculation and
MCP compatibility. Updating dependencies does not deploy or enable production reparse.

### Sports Lib 23.4.0 sparse distance adoption

Root and Functions install the same published 23.4.0 artifact. Missing Distance samples remain null, while real zero
and repeated observations remain valid. Supported intervals govern library-derived speed and grade-adjusted
calculations; do not add distance filling or interpolation in QS. Recorded source summaries and imported TSS keep
their existing precedence. Calculated summaries, pace load or durability evidence can change on fresh parsing.

Opening Event Details already hydrates original-file streams and needs no persistence rewrite for this correction.
To update historical saved summaries/evaluations, use the existing separately authorized source-backed reparse and
normal derived invalidation. Preserve source totals, latest controls/policies, strict identity matching, source-write
reservations, retry/deletion guards and stream-stripping sanitizers. There is no new migration path, derived schema,
saved-route correction, queue or monitoring change. Optional stream interval-support metadata stays outside Firestore
activity documents and MCP projections.

The strict runtime target follows the installed version. Package adoption does not enable a scanner or start work;
an already enabled scanner will discover eligible older versions after a separately approved deployment. Review its
existing runtime settings before rollout. No deployment or production reparse is part of this PR.

### Sports Lib 23.1.0 threshold-HR calculation update

Root and Functions pin published sports-lib 23.1.0 with matching lockfile integrity. The runtime target follows that
installed package, with strict version mismatch checks. The compatible editor/shared resolver understands optional
private `hrAlgorithm` evaluations; older evaluations remain readable without an inferred algorithm.

Every sport already eligible for calculated TSS can use the threshold-HR estimate when resting or maximum HR is
missing but the original supplies a valid threshold and usable recorded HR. This includes walking/hiking, swimming
and strength training; the existing calculated-load exclusions remain unchanged. Full calibration keeps Banister;
imported scores and eligible power keep priority. Invalid/conflicting calibration still fails closed. The exact
threshold enters the 100 TSS/hour band; for threshold 165, one hour at 164/165/166 bpm yields 80/100/100 TSS.
Historical values need the existing authorized original-file reparse and normal Training refresh.
JSON hydration or a Training rebuild cannot recover discarded calibration. Reparse refreshes candidates while keeping
saved policy snapshots and latest controls through strict identity matching, source reservations, retries and deletion
guards. No new persistence path, derived schema bump, route migration, queue or automatic reparse campaign is required.
See the [Training contract](../../../docs/training-workspace.md#file-only-tss-evaluation-and-owner-load-controls).

### Sports Lib 23.0.0 provider sport catalog adoption

Benchmark source writes now set a server-owned pending barrier before activity persistence. The existing source
reservation and deletion guards protect it until all activity writes, stale-child deletion and processing metadata
finish; only then does the completed source revision advance. Failed attempts retain the barrier until normal reparse
retry succeeds. Deploy compatible frontend guards and Firestore Rules before this backend lifecycle; no backfill or
manual flag clearing is required. See the [benchmark contract](../../../docs/benchmark-comparisons.md#original-file-reparse).
Monitoring is unchanged: the existing reparse persistence-phase diagnostics and queue outcomes include completion
failures; queue names, dispatch, retry limits, terminal states and monitoring resources are unchanged.

Root and Functions install the same published Sports Lib 23.0.0 artifact; FIT Parser remains 6.2.2. Both JSON readers
recognize all 284 canonical sports and 18 groups. Runtime version detection and the activity/route reparse target
follow the installed 23.0.0 package, retaining strict target-mismatch checks. No scanner setting is changed or enabled.

Before separately approved backend deployment introduces new sport names, release compatible frontend readers and
handle already-open older clients. The current optional Reload prompt does not enforce that upgrade. Keep the
Training guide's existing schema-22 builder/frontend ordering separate from this canonical-reader boundary.

Historical activity corrections require an original file or specific provider identifier/profile that retains the
distinction. Existing broad JSON alone cannot recover it. Use the existing targeted reparse lifecycle, strict leg
identity carryover and sanitized writer; preserve user controls, benchmark reports and valid imported TSS. Regenerate
affected summaries, activity-type aggregates and Training evidence through the normal lifecycle. Automatic Walking,
Indoor Walking, Nordic Walking, Speed Walking, Hiking and Trekking calculations now prefer eligible independently
calibrated power before HR and MET; preserved imported scores remain unchanged.

FIT routes now retain Road Running, Road/Track/Gravel Cycling, Cyclocross, Indoor Walking and Skate Skiing through their
standard sport/sub-sport pairs. Reimport retained FIT courses containing those pairs to recover precise names when
needed. Previously exported courses without a subtype require re-export from a retained specific route; a broad label
alone cannot recover the detail. GPX/native JSON routes retaining the exact name need no classification migration.

Dependency adoption performs no deployment, source download, production reparse or direct data write. Existing queue,
retry, deletion, worker-budget and persistence safeguards remain in force. See the
[Training compatibility notes](../../../docs/training-workspace.md#preserved-provider-sport-names-and-historical-compatibility)
for classification, saved-load and consumer rollout policy.

### EnergySense support in Sports Lib 22.0.0

<a id="pending-energysense-library-candidate"></a>

Canonical Stamina and Potential Stamina keys remain compatible; presentation naming needs no data migration or duplicate
stat. The new Estimated Sustainable Distance and Minimum Estimated Sustainable Distance keys require a supported
original JSON/SML reparse to persist historical source observations. Chart hydration can read those observations on
demand without storing streams. FIT-only originals cannot recreate fields they never recorded.

These observations were introduced in Sports Lib 22.0.0 and remain supported by the current 23.0.0 pins with FIT
Parser 6.2.2. Use only the existing authorized
original-file reparse lifecycle to update historical observations. Regeneration seeds freshly parsed Stamina/endurance endings and minima before deriving missing
statistics; it never carries stale persisted observations over the new parse. Preserve source zero, per-leg identity,
source-minimum precedence, sanitized writes and latest user edits/Training controls. Repeat reparse is idempotent and
must not add renamed aliases or streams to Firestore. Derived Training formulas and snapshots need no schema bump for
these metrics alone. No automatic backfill or production campaign is authorized.

Suunto EnduranceDistance is assumed to be metres pending provider confirmation. Its Cur summary describes an ending
estimate, not necessarily the final sample; its Min can be lower than the sampled minimum. EnduranceValid remains
undocumented and does not erase populated observations. No average, maximum, multisport sum or FIT mapping is invented.

### Sports Lib 21.6.11 reserved FIT header compatibility

Sports Lib 21.6.11 introduced FIT Parser 6.2.2 compatibility, retained by the current root/Functions pin. Ordinary activity decoding can again read
existing Bryton and Magene originals whose normal record headers set reserved bit 4. Compatibility requires complete
message definitions and payloads within the declared data section. Strict/raw readers retain their rejection policy;
other invalid data-header bits and checksum policy are unchanged. Imported TSS and existing Training formulas retain
their meaning. Successfully parsed files need no migration or rebuild solely for this correction.

Retry a previously rejected retained original through the existing authorized upload/reparse lifecycle after deployment.
Do not patch stored file bytes, bypass the normal writer, or turn this dependency update into a global repair campaign.
Package publication and dependency adoption do not deploy QS, enable scanners, or authorize production reparsing.
There are no new public metric tokens, schemas, MCP fields/scopes, write paths, or monitoring lifecycle changes.

### Sports Lib 21.6.12 source evidence and JSON compatibility

The coordinated root/Functions update retains session-scoped FIT HR/FTP calibration, complementary sensor records,
pool HR dropout boundaries, multi-track TCX timing and evidence-backed FIT session bounds when duration summaries
are missing. Pool-length dates and generated readings stay within their owning swim/lap and applicable timer interval;
recorded streams remain intact. The isolated native event/activity/lap JSON correction safely skips legacy null or
non-finite scalar summaries and omits non-finite summary exports, retaining finite zero, imported scores and raw stream
gaps. That earlier release did not adopt the expanded activity catalog subsequently included in 23.0.0 below.

JSON reads need no original-file reparse. Apply historical parser and timing corrections only through the authorized
original-file lifecycle and existing derived refresh, including QS's parsed-distance preservation described below.
No new fields, schemas, storage operations, MCP capabilities, saved-route reparse or automatic campaign are required.
Package adoption does not deploy QS or authorize production rewrites.

### Sports Lib 21.6.13 source classification, HR and distance corrections

Keep root and Functions on the same released version. This parser update rejects explicit non-workout FIT file types,
including daily monitoring, settings and course files, instead of generating Unknown Sport workouts. Completed Wahoo
and other `activity_summary` files remain supported when they contain an explicit session, including summaries with no
sensor records or with imported TSS zero. Sessionless summary files cannot synthesize workouts from timestamped events.
Ordinary activity files and legacy files without a file type retain compatibility. Reparse now classifies confirmed
non-activity originals as explicit skips, as described below, while retaining existing events, activities, controls and
originals. Unclassified parser failures retain the existing error handling.
Do not delete those historical records or count a skip as an automatic volume repair. No Health import is added.

COROS GPX direct `hr` in the ClueTrust GPXDATA 1/0 namespace restores the existing Heart Rate stream, preserving zero,
namespace independence and legacy heartrate/Garmin precedence. Unrelated, blank/non-finite or ambiguous readings are
ignored. Restoring samples does not invent HR calibration and therefore need not make HR TSS available.

Mixed-sport Suunto JSON/SML no longer copies unscoped header SpeedZones boundaries onto every leg. Single-sport header
thresholds and applicable leg-local thresholds remain eligible; conflicting sport identifiers cannot donate calibration.
Imported TSS, valid HR/MET fallback and native JSON roundtrip behavior retain their established contracts.

FIT pool-distance recovery avoids adding earlier fallback length distance to a whole-session total repeated only on
the final active lap. Recovery requires complete, uniquely owned positive pool lengths with consistent counts and
nonoverlapping active intervals across multiple active laps. Prefer a complete monotonic zero-to-total recorded counter
covering those lengths, including when a session summary disagrees. Otherwise use complete length geometry only if the
independent session summary agrees. Incomplete or conflicting evidence does not qualify; consistent lap distances and
single-lap behavior remain unchanged. See the Training guide for the precise source-evidence contract.

Use authorized original-file reparse/regeneration and normal derived refresh for historical corrections. A Training
rebuild cannot recover lost source samples or threshold ownership. Package publication/dependency adoption starts no
campaign, deploys nothing, and adds no storage queries, provider calls, public schemas or MCP capabilities.
Monitoring review: provider parse rejections retain existing import failure/DLQ telemetry. Confirmed historical
non-activity sources use the INFO skip path below; genuine reparse failures retain failure logs and retry handling.
The recorded-import alert bundle explicitly does not cover Sports Lib reprocessing. No monitoring configuration is
changed or applied by this update.

### Sports Lib 21.6.14 names, creator attribution and fallback diagnostics

The earlier adoption of published 21.6.14 used matching npm integrity. All 1,349 package files matched the verified
candidate, and 209 focused version, parser, reparse and private-output checks pass against the published installation.
Native Activity JSON restores saved child names independently
of the parent event title and creator/device name. Stored names need no source reparse; discarded names require source
evidence. GPX activity/route creators retain their exporter name without treating the schema version as a manufacturer
or device software version. Unknown TCX sports resolve to `Unknown Sport` instead of undefined; recognized sport and
indoor detection behavior remains intact. Persisted attribution/type corrections require the existing targeted original-
file lifecycle and normal summaries; ambiguous leg matching keeps existing controls and requires review.

TSS evaluation distinguishes missing required inputs from a calculation that cannot produce a valid result. The latter
uses the existing private `calculation-unavailable` reason, preserving formulas, guards, imported scores, valid zero,
method eligibility and fallback order. Refresh old reasons through authorized original-file reparse when parsed inputs
are no longer available. No derived schema, numeric metric, MCP scope/field or planning/delivery capability changes.

The isolated route JSON correction is also included: omit non-finite scalar exports, skip legacy null/non-finite
summaries on restoration, and aggregate children only when no valid file summary remains. Valid zero, partial summary
precedence and geometry validation remain intact. This read compatibility needs no original or route reparse. Correcting
GPX creator provenance separately requires source evidence. Package adoption does not deploy QS, enable scanners,
start a production campaign or authorize direct data edits.

### Provider-profile and catalog corrections included in Sports Lib 23.0.0

<a id="unreleased-provider-profile-and-catalog-corrections"></a>

Sports Lib 23.0.0 corrects Garmin Breathwork for Generic/Breathing and Training/Breathing with an explicit
English `Breathwork` or French `Ex. respiration` profile. It adds 14 Polar FIT display aliases and honors explicit Polar
Cross-trainer and Stretching profiles on their documented broad pairs. Australian Football, Korfball and Netball are
separate Team/Racket types within the full published 284-type catalog. Unnamed generic records remain broad; no numeric
sport IDs or undocumented API tokens are assigned to the three new types.

Known profiles cannot replace an unrelated FIT parent through a standalone alias fallback. Existing compatible broad
parents and explicit parent/profile composites retain their refinements. Shared profile names retain every documented
FIT context, including Polar Open water swimming on Swimming/Generic and Swimming/Backcountry.

The application and Functions now install the same published 23.0.0 package. Compatible frontend rollout must still
precede backend writes of the new classifications and account for stale browser sessions.
Retained original files or specific saved provider profiles are required to correct historical broad labels through the
existing targeted reparse lifecycle. Regenerate affected event summaries, activity-type aggregates, applicable
existing durability evidence and Training snapshots through normal sanitized ingress. Saved routes need no source reparse.

The event/activity/lap JSON subset of these compatibility changes is included in Sports Lib 21.6.12. Those reads skip
legacy null/non-finite scalar stats; finite zero/negative values, provider TSS and method, structured stats and stream
gaps remain intact. Summary exports omit non-finite scalar numbers while runtime zero-speed pace can remain infinite.
This compatibility read does not require an original file or a reparse.
Any explicitly requested persistence rewrite must still use the existing sanitized writer, never direct Firestore edits.
The isolated route and route-file JSON correction shipped in 21.6.14 as described above. The current 23.0.0 adoption
also supplies the complete catalog/profile additions; the earlier JSON subset did not adopt those classifications.
Current sports-lib calculations preserve valid nonnegative imported TSS, including zero, regardless of method preference
or the deprecated preservation flag. QS's explicit internal regeneration removal is documented separately below.

These Sports Lib corrections add no numeric metric tokens/units or formulas and keep provider TSS policy unchanged.
Coordinated QS preparation separately covers Training schema-22 builders, approved planning aliases and MCP recipe
coverage, plus recorded-activity and route destination metadata mappings. See the
[Training compatibility notes](../../../docs/training-workspace.md#preserved-provider-sport-names-and-historical-compatibility)
and [provider boundary tables](../../../docs/provider-integration-guide.md#refined-sport-names-at-recorded-activity-and-route-boundaries).
Those changes retain queue lifecycles and sanitized write paths; dynamic activity discovery uses existing fields.
Help follows the installed dynamic catalog, and both packages now recognize all 284 types. This adoption does not
deploy, enable scanners, start reparsing or change
FIT Parser source.

### Sports Lib 21.6.1 file-calibrated Training load

The coordinated root and Functions dependency is published Sports Lib 23.0.0, with FIT Parser 6.2.2. It retains the file-calibrated
load rules introduced in 21.6.1 and includes the swimming threshold, independent cycling FTP, rolling NP, explicit
HR-pause, running pace, pool-length/recorded-stream and measured-zero power corrections. This release also corrects
FIT session-boundary and zone ownership, missing timer recovery, Suunto pause/resume events and positive recorded-power
coverage. Deployment and production reparse each require separate approval.

New source-file imports use the corrected calculations. Historical calculated power scores without independent FTP
may fall back or become unavailable; calculated HR scores exclude explicit timer pauses, including gaps spanning a
pause. Regenerate mode retains file calibration and timer events through repeated calculation. Imported scores remain
authoritative by default. Correct historical values only through the existing original-file reparse lifecycle, then
refresh derived Training summaries. Saved routes and schemas need no migration. The target continues to follow the
installed runtime version; this dependency update does not enable either automatic scanner or launch a campaign.

Event-table merging is a distinct stats-only path: it preserves recorded leg TSS/method and copies the source's saved
Training load evaluations, applied policies and controls without reparsing originals. Pending/stale or unresolved
source metadata blocks the merge for review. Preparation/finalization use stable activity IDs, source fingerprints,
concurrency/deletion fences and the existing private load cache. Source workouts are not altered; users can exclude a
duplicate representation themselves. Completed older merges are not rewritten automatically. Original-file reparse
can recover file-based candidates, but owners must review their controls when earlier merges lost source snapshots.
No production repair, scanner or new recurring rebuild read is enabled by this correction.

Import/reparse and merge preparation reserve a private `sourceWriteId`; source writes, finalization, reparse cleanup
and completion metadata check it within their Firestore transactions before writing. An older attempt cannot clear a newer pending import or replace its multisport leg set merely
because the parent totals still match. A superseded attempt fails through the existing persistence/retry path; the
current attempt can finish normally. Retrying preparation preserves frozen legacy identities, dated policies and owner
controls while reserving a new identifier. Repeating the same successful finalizer remains idempotent. The marker is
server-owned. Each guarded source/completion transaction adds one metadata read; warm full-rebuild reads and normal
write counts are unchanged. Cleanup also queries current event children in guarded pages of at most 400 documents,
including retained legs, so a stale pre-parse snapshot cannot leave partial-attempt children behind. A page runs even
when the original snapshot predicted no deletions; budget its child reads and deletion/attempt guards per reparse.
Original-file uploads finish before source-document writes start. No public fields,
scanner changes or production operations are introduced.

Sports Lib 21.6.10 further corrects unsupported HR coverage, explicit reevaluation of calculated NP, Suunto event-array
selection and validated zero active time, multisport zone-duration ownership, FIT canonical pool-length units and
source-backed lap/session timing. Apply parser corrections only through the existing original-file lifecycle for
historical records; ordinary JSON cannot restore raw source evidence. Public metric/schema/MCP shapes stay unchanged.
See the Training guide for precise input eligibility and the narrow Suunto pool-unit compatibility rule.

Running pace corrections require original-file reparse to apply grade cost, zero-speed, active-duration and complete
window semantics. Pool HR preservation and unambiguous multisport initial timer-state recovery likewise require the
original source file. Regeneration keeps the same parsed instance so private recorded-HR gap provenance and source
calibration remain available. Existing recorded values are not rewritten by a dependency update alone.

Complete eligible recorded zero-power windows can establish POWER TSS 0 with independent FTP and duration. A zero NP
summary or zeros inserted for missing FIT/TCX/GPX power fields do not establish this. Private source evidence stays attached
to the same parsed instance through regeneration; ordinary JSON cannot restore it.

Sports Lib 21.6.9 extends recorded-power coverage to positive calculated NP windows: missing fields padded with
zeros cannot create a usable window or suppress an eligible HR fallback. Its FIT corrections assign shared-boundary
records to the next leg, match zone durations by unique session message index, and derive a missing/zero timer summary
only from an unambiguous start-anchored timeline consistent with session bounds. Positive timer summaries retain
precedence; a validated all-paused zero cannot fall back to elapsed time during regeneration. Suunto JSON/SML pause
and resume events now reach the existing timer-aware calculations. See the Training guide for exact eligibility.

Apply these five corrections to historical activities through original-file reparse and normal derived refresh;
a Training rebuild or reconstruction from stored Activity JSON cannot restore discarded source evidence. Keep the
same parsed instances through regeneration and metadata finalization. Saved load controls, dated policies, imported
scores and strict leg/deletion checks remain unchanged. No saved-route reparse or schema migration is required.
Monitoring impact is unchanged: no provider labels, commit outcomes, queue stages, retries, dispatch limits or heavy
routing change. Existing provider-import metrics and reparse diagnostics remain applicable; this release neither
enables scanners nor provisions monitoring resources.

Pool FIT imports retain final boundary/rest lengths, support generated streams from one lap while preserving its
recorded streams, and repair invalid summary end times from valid file durations before assigning lengths. Rest
lengths do not add distance/speed; ambiguous ownership cannot supply a complete generated distance total. Source-backed
date corrections follow existing strict leg reconciliation, preserving unmatched controls for owner review.

Regenerate mode retains every finite positive canonical distance from the fresh source parse. Monotonic counters
and moving GPS do not prove complete coverage and no longer overwrite that total. Stalled, truncated, late-starting,
reset or conflicting counters remain recorded streams, not a second source-selection rule in QS. Sports Lib owns
source corrections; QS neither chooses the larger distance nor sums counter segments. Missing/zero totals still use
normal generation. Derived speed/pace and event volume use preserved leg totals once. Apply historical corrections
through original-file regeneration and the existing derived refresh; old stored statistics never supply the value.
This in-memory change adds no database operations, provider requests or public MCP capability.

The multi-day chronology correction is included in the aligned 22.0.0 dependencies. It requires a single session, monotonic session-owned endpoint records and complete consistent
timer events from one timer group whose active duration agrees with the recorded summary within FIT timestamp
quantization. It preserves the full elapsed span and later records while retaining active timer duration and existing
maximum-duration protection. Conflicting chronology keeps the existing corrupt-date handling. After coordinated
package adoption, historical lost records require the retained original and normal source-backed reparse/derived
refresh. Existing strict leg matching, owner controls and deletion fences remain authoritative. No release, deployment,
scanner activation or production reparse is authorized by preparing this correction.

Pool swims follow the same parsed-total rule; the former QS-only lap/length gate has been removed. FIT evidence
selection and corroborated corrections remain in Sports Lib. No saved-route reparse is needed.

The Suunto JSON/SML correction included in 22.0.0 separates window active time from elapsed time and rejects
negative pauses. Independent timer/header evidence may recover contradictory duration; otherwise active/timer/pause
and duration-dependent load/durability remain unavailable. Ambiguous leg windows cannot borrow whole-workout timing. Native JSON
preserves missing values but not private source evidence. After coordinated package adoption, historical correction
requires original-file reparse, the same parsed instances through candidate preparation, strict identity/control
reconciliation and ordinary derived refresh. Root and Functions now use the same published 23.0.0 package, retaining that correction.
Source evidence remains private; this introduces no metric/schema/MCP change or production campaign.

New provider imports and manual uploads cache Automatic/HR/MET evaluations in owner-only event metadata. Walking,
Indoor Walking, Nordic Walking, Speed Walking, Hiking and Trekking skip running pace; Automatic first considers
usable power with an independent FTP before HR and MET. HR requires file-supplied resting, threshold and
maximum HR; missing calibration can fall back to the calorie-derived MET estimate when its file inputs exist.
Valid imported TSS retains precedence. See `docs/training-workspace.md` for the exact calculation and policy contract.

Regenerate mode keeps the freshly parsed FTP, timing and HR/MET inputs available before rebuilding derived statistics
and refreshing TSS candidates. It does not copy calibration from the old stored activity. Imported scores, including
zero and methodless imports, retain their provenance by default; unavailable calculated scores are removed. An internal
explicit `preserveImportedTss: false` removes score and method at the QS boundary because sports-lib 21.6.1 does not
honor that flag alone. Recorded TSS and private evaluations must agree before EventWriter persists them. See
`docs/training-workspace.md` for the protected inputs and recalculation contract. This uses the existing transform,
persistence and failure stages without additional database calls or changes to monitoring, retries or queues.

Historical recordings keep their current recorded values until source-backed reparse. Numeric overrides and exclusions
work immediately; HR/MET selection needs cached evaluations. Before overwriting any event/activity document, reparse
durably freezes legacy identities in private server-owned metadata. Retries retain this evidence even when IDs are
reused or a previous attempt wrote only part of the source. Reparse then refreshes calculated candidates after
sanitized event/activity writes and before stale child removal. Its transaction preserves the latest controls and
original dated policy snapshot, checks source fingerprints and deletion guards, and uses strict leg identity matching
without TSS. Ambiguous matches or missing old identity evidence retain controls and leave modeled load unavailable
until owner reassociation or reset. Identity preparation does not advance the load timestamp. Clearing a pending
import advances load freshness and requests a targeted load rebuild even when the source is identical, because an
intermediate build may have observed the pending state. Repeated finalization without pending state or changed
inputs is idempotent. Changed load metadata invalidates affected Training snapshots.

Keep automatic event and route scanners disabled. This change needs no saved-route reparse. Use the existing targeted
original-file action for an approved historical correction; do not bulk-rewrite recorded scores or distribute parent
TSS across multisport legs. Validate the installed runtime/target version before any separately approved campaign.

### Prepared pool timing validity correction (not released)

Adopting the candidate parser classifies only source-proven impossible lap/length timing in complete single-session
pool FIT files. It adds optional `timingValidity` JSON metadata while withholding contradicted timer/elapsed fields.
Rest/length rows, ownership and distance/strokes remain; valid elapsed time cannot substitute for rejected active time.
Native JSON and activity write sanitization retain the marker, and repeated regeneration cannot restore rejected time.
Pool durability becomes unavailable for affected active lengths rather than reporting improved coverage. Moving time
previously summed from corrupt length timers can instead use valid recorded samples; session totals and imported TSS
retain precedence. Routes, multisession files, incomplete evidence and valid long rests retain existing behavior.

Existing activities need original-file reparse after a released package is adopted in both root and Functions. Training
refresh alone cannot classify legacy timing. Use the normal version-gated queue and derived invalidation; do not start a
campaign, change its target, or update the aligned package versions as part of preparing this patch. MCP/frontend
readers tolerate old documents and project missing timing through their existing contracts. See the Training guide's
“Contradicted recorded pool timing” section for consumer behavior and eligibility.

The accompanying duration declaration correction makes `getDuration()`, `getTimer()`, `getMovingTime()` and
`getPause()` explicitly return their Data object or `undefined` on events, activities and laps. This matches their
existing runtime behavior; it does not introduce a new persisted shape or require a reparse by itself. Keep guarded
reads in displays, exports, fingerprints and calculations, retaining measured zero. Do not substitute dates, elapsed
time or zero for rejected active time. Swim-length timing fields and their resolver retain the separate `null` contract.
Verify consumers against the locally packed candidate before release, with root/Functions dependencies still aligned
to the published version. This typing-only integration adds no Training/MCP metric, scope, schema or mutation.

### Sports Lib 21.5.0 recorded swim distance display

Sports Lib 21.5.0 adds optional meter/yard display units to `DataSwimDistance`. Quantified Self selects these units
from the first swim-pace preference for recorded swim views. Canonical values, JSON, metric tokens, parsers, imports,
saved routes, Training calculations and provider delivery remain unchanged. Existing recordings can display yards
without source files, a persistence rewrite, derived-summary regeneration or a data migration. MCP numeric metrics
and its `distanceMeters`/`poolLengthMeters` projections retain canonical meters.

Keep both automatic scanners disabled for this display-only upgrade. The strict reparse target follows the installed
package version, but no event or route reparse is needed solely for 21.5.0.

### Sports Lib 21.4.0 Wahoo FIT completion references

This additive release supplies bounded Wahoo app Plan references outside Event/Activity JSON and DataStore. New trusted
Wahoo imports can use one file-scoped reference plus one matching persisted source session to resolve an exact owned
delivery when API association fields are missing. A null scheduled Workout ID remains null; the saved recording ID is
not a substitute. Private sidecar, account/generation, accepted-delivery, occurrence and first-link-wins guards apply.
No event/route reparse or derived recomputation is needed. Keep both automatic scanners disabled: their target follows
the installed version, and the generic reparse writer does not persist this completion sidecar. Historical QA proof
must explicitly reuse the guarded Wahoo correlation path; do not launch a global backfill for this release.

### Sports Lib 21.2.1 FIT workout-reference sidecars

Sports Lib 21.2.1 adds nonnumeric FIT training-file, embedded-workout and SuuntoPlus Guide reference classes plus
`readFITWorkoutReferences(...)`. New Garmin/Suunto FIT imports read these references separately from normal Event/Activity
parsing. QS stores only bounded, account-authorized private sidecars; the classes do not enter activity JSON, streams,
numeric metrics or Training-derived snapshots.

Do not enable either automatic scanner or start a global reparse solely for these sidecars. The existing generic event
reparse writer does not persist completion evidence and therefore cannot be used to backfill it by assumption. A future
targeted backfill must explicitly reuse the same provider-account/generation guards, deletion fence, private sidecar
writer and idempotent completion-link rules as live ingestion before it is authorized. Garmin message 72 is candidate
evidence only; never reinterpret its unsigned serial as a Training API workout or schedule ID. Reparse failures or
malformed optional reference metadata must leave the previously imported activity and metrics unchanged.

### Sports Lib 20.4.0 canonical running-dynamics transition

Sports Lib 20.4.0 adds canonical Ground Contact Time Percentage, Running Flight Time, and Contact Time to Flight Time
Ratio streams plus average/minimum/maximum summaries. Suunto JSON flight time is converted from seconds to milliseconds;
the percentage metrics retain percent units, and contact-time-to-flight-time ratios may legitimately exceed 100. FIT
`stance_time` continues to map to canonical Ground Contact Time, while new FIT imports no longer duplicate that value
under the deprecated Stance Time family. Historical Stance Time JSON remains readable for compatibility.

New FIT and Suunto imports persist these metrics through the existing sanitized event/activity writer. Use an ordinary
targeted source-backed reparse when a retained historical source needs the new summaries or canonical duplicate removal.
The installed package version advances the strict reparse target automatically; there is no Firestore schema migration
and the MCP read path must not synthesize missing values. Keep both automatic scanners disabled and do not start a global
campaign solely for this release. Saved routes, Training disciplines, durability, and Training-derived schemas are
unchanged.

### FIT creator device metadata correction

When Quantified Self adopts the Sports Lib release that recovers a FIT activity creator from an explicitly local or
creator `device_info` message, new imports persist that source-provided device identity. A targeted source-backed
reparse also replaces legacy `Unknown` and `Unknown Device` creator placeholders when it recovers a meaningful new identity.
Meaningful existing creator names continue to win so user device renames survive reparsing.

Use the ordinary targeted reparse only for retained original FIT files whose persisted creator is a placeholder. Do not
patch activity documents directly, and do not enable the automatic scanner or launch a global campaign solely for this
correction. Files without suitable creator metadata remain unknown.

### Sports Lib 20.3.0 Health and sleep scalar JSON transition

Sports Lib 20.3.0 adds the exported Health and Sleep scalar classes plus strict canonical `fromJSON()` support used by
Quantified Self's normalized Health and Sleep storage boundary. This is not an event/activity parser migration. Do not
enable the automatic event/route scanner and do not enqueue original-file reparses solely for 20.3.0. Before deploying
the dependency update, verify that both automatic scanners are disabled: their strict target version follows the
installed Sports Lib version, so a scanner left enabled from an earlier rollout would otherwise treat 20.3.0 as a new
event/route reparse target even though this release has no parser transition.

New Health and Sleep writes add a versioned Sports Lib JSON envelope while retaining legacy scalars for rollback.
Existing `healthSourceRecords` and `sleepSessions` use the separate dry-run-first, UID-scoped
`migrate-health-sleep-sports-lib-data` command documented in `docs/sleep-sync-operations.md`. That migration reads only
already-normalized values; it does not download originals, refetch providers, alter event processing metadata, or
change `SPORTS_LIB_REPARSE_TARGET_VERSION` behavior.

### Sports Lib 20.1.1 native dive gas and tank record persistence

Sports Lib 20.1.0 introduced parser-provided FIT `dive_gas`, `tank_summary`, and `tank_update` messages as structured
source records on each Diving-group activity. Sports Lib 20.1.1 serializes those optional records in native Activity
JSON as `diveSourceRecords`. Gas percentages, tank pressures in bar, volume used in litres, timestamps, packed sensor
values, and parser enum values remain source-owned. The library does not turn them into numeric summary stats, infer
gas names or nitrogen values, associate a gas with a tank, or calculate consumption.

New imports and source-backed targeted reparses write the records through the normal sanitized activity writer. The
writer still removes streams, but retains `diveSourceRecords` in the activity document. Event Details also hydrates the
retained original as a legacy fallback for activity documents created before 20.1.1. The Diving summary tab renders the
records separately for each selected dive in **Gas & Tanks**.

The records remain nonnumeric source data: they do not become Training inputs, durability fields, derived schemas, or
MCP metrics and are not projected through MCP activity-detail responses. Use an ordinary targeted reparse only when a
specific retained original should persist its legacy records. A reparse cannot recover records for an original source
that is no longer retained; do not enable the automatic scanner or launch a global reparse for this release.

### Sports Lib 20.0.3 regenerated-event summary correction

Sports Lib 20.0.3 applies the Diving-group terrain rule when it regenerates a parent event summary. A parent made
entirely of Diving-group activities omits `Ascent`, `Descent`, `Minimum Altitude`, `Maximum Altitude`, `Average
Altitude`, `Minimum Grade`, `Maximum Grade`, and `Average Grade`. A mixed parent aggregates those eight values only
from its non-Diving child activities. The correction does not alter raw source streams or child activity source stats.

Quantified Self's ordinary source-backed reparse calls `EventUtilities.reGenerateStatsForEvent(...)` immediately before
the sanitized event/activity writer persists the result; event merges use `EventUtilities.mergeEvents(...)` before the
same writer. The installed Functions package advances the target version automatically. Use the normal targeted
reparse lifecycle only when an existing persisted parent summary needs to be rewritten. Do not synthesize summary
values or patch Firestore directly. Keep the automatic scanner disabled unless a separate operational campaign is
approved; an event without its retained original remains an honest terminal `NO_ORIGINAL_FILES` outcome.

### Sports Lib 20.0.1 FIT parser transition

Sports Lib 20.0.1 uses FIT parser 5.0.2. On new FIT imports, session field 196 persists as canonical `Metabolic
Calories` (`kcal`), not `Resting Calories`. Existing native JSON `Resting Calories` values remain readable as their
recorded historical stat until a reparse replaces the source stats; the reparse path must not rename them or infer
`Metabolic Calories` from them. FIT `Average VAM` is converted from the parser's meters-per-second source value to the
public meters-per-hour metric before it is persisted.

The same version removes terrain ascent/descent, altitude minimum/maximum/average, and grade
minimum/maximum/average summaries from Diving-group event, activity, and lap data during FIT import and native JSON
hydration. It leaves raw source streams available for the existing dive views.

Run the ordinary targeted reparse for retained original FIT files that need these new or corrected persisted values.
The installed package version advances the reparse target automatically. Do not enable the automatic scanner or start a
global campaign solely for this transition without separate operational approval; missing original files remain an
honest terminal `NO_ORIGINAL_FILES` outcome.

### Sports Lib 19.1.0 source-native dive metrics transition

Sports Lib 19.1.0 imports parser-provided Diving-group summaries for average/maximum depth, dive timing and rates,
CNS/N2 load, oxygen toxicity, SAC, and RMV, plus continuous Depth, decompression, load, air-time, SAC/RMV, PO₂, and
dive-ascent-rate streams. The importer preserves sparse source values and parser-provided magnitudes. It does not derive
missing summaries, reconstruct streams, fill gaps, apply plausibility thresholds, promote lap-only summaries, or
flatten gas/tank messages.

The FIT importer also preserves Garmin's explicit dive sub-sport semantics: single-gas, multi-gas, and gauge diving
become canonical Scuba Diving activities, while apnea diving and apnea hunting become Free Diving. Other dive
sub-sports without an exact Sports Lib activity type remain canonical Diving instead of being guessed into a nearby
type.

New imports persist only the summary stats actually supplied by the source. Run an ordinary targeted reparse when a
specific retained historical source must persist those new parser-owned summaries or corrected explicit dive activity
type. Do not enable the automatic scanner or enqueue a global historical reparse solely for this release. Event Details
hydrates continuous dive streams on demand from retained originals, so that view requires no persistence rewrite. MCP
exposes persisted numeric summaries through its automatic catalog while its frozen continuous chart tools remain
unchanged. Unit-derived dive depth/rate classes are display-only: they convert canonical values after hydration and do
not change serialized source stats. They therefore require no reparse or Firestore rewrite. Saved routes, Training
disciplines, durability, and Training-derived schemas are unchanged.

### Sports Lib 19.0.0 stroke-rate semantics transition

Sports Lib 19.0.0 introduces canonical `Stroke Rate` stream and average/minimum/maximum stats for Swimming, Open Water
Swimming, Rowing, Indoor Rowing, Canoeing, Kayaking, Paddling, and Stand Up Paddling. New source imports and native JSON
activity hydration translate the Cadence-shaped source fields for those sports to Stroke Rate while leaving locomotion
Cadence unchanged for other sports.

Do not enable the automatic scanner or enqueue a historical source reparse solely for this transition. Quantified Self
canonicalizes pre-19 split event/activity documents at read time using their persisted activity type, and derived schema
18 rebuilds Training stroke-rate summaries from the already stored average stat. New writes use the canonical type.
Mixed or unresolved sport sets retain Cadence because its meaning is ambiguous. Saved routes and the registered MCP
output schemas are unchanged.

### Sports Lib 18.1.4 continuous dive-depth transition

Sports Lib 18.1.4 maps FIT record depth from millimeters into a canonical meter-based `Depth` stream while preserving
existing session maximum-depth statistics and Suunto depth behavior. New imports and ordinary reparses can therefore
render Event Details dive profiles for Diving, Scuba Diving, Free Diving, Snorkeling, and Mermaiding sources that
actually contain continuous depth samples. At that release, Event Details hydrated Depth, Temperature, and Heart Rate directly from the
retained original source; the stream is never added to compact Firestore event or activity documents.

Do not enable the automatic scanner or enqueue a historical reparse solely for the dive-profile UI. Existing retained
sources become chartable through Event Details source hydration without a persistence rewrite. An explicitly requested
ordinary reparse may serialize parser-owned summary changes, but it is not required to display the continuous profile.
Saved routes, Training disciplines, Training durability, and derived-metric schemas were unchanged.

### Sports Lib 18.1.3 snorkeling and mermaiding classification transition

Sports Lib 18.1.3 normalizes the lowercase `snorkeling` and `mermaiding` aliases to canonical activity types and
places both in the existing Diving group. New imports and ordinary reparses write those canonical types. The frontend
also resolves retained legacy aliases through the package, so calendar grouping, colors, filters, and the existing
`scuba_diving` icon work without rewriting historical documents.

Do not enable the automatic scanner or enqueue a historical reparse solely for this classification change. It adds no
parser-owned statistic, does not change Training discipline membership or derived-metric schema, and has no saved-route
effect. Reparse an individual source only when canonicalizing its persisted activity type is independently needed.

### Sports Lib 18.1.2 lap pace transition

Sports Lib 18.1.2 fills missing pace, swim-pace, and grade-adjusted-pace summary stats from compatible speed stats on
events, activities, and laps. Native JSON hydration applies this behavior in memory to existing speed-only Firestore
documents, so the Laps table benefits immediately without rewriting historical data. New imports and any ordinary
future reparse serialize the additive derived lap stats through the existing sanitized event/activity writers.

Do not enable the automatic scanner or enqueue a historical reparse solely for this change. Saved routes are unaffected,
and the MCP lap projection remains unchanged because it does not expose pace fields.

## Candidate Discovery Model

### Global mode (production path)
Global discovery is query-first on processing metadata:
- query: `collectionGroup('metaData')`
- filter: `where('processingEntity', '==', 'event').where('sportsLibVersionCode', '<', targetSportsLibVersionCode)`
- order: `orderBy('sportsLibVersionCode', 'asc').orderBy('__name__', 'asc')`
- path guard: only docs at `.../metaData/processing` are treated as reparse candidates
- entity discriminator: global event discovery requires `processingEntity: "event"`; run the event-entity backfill before enabling the scheduler with this query.

For each processing doc hit:
1. Derive identity from parent path only (`users/{uid}/events/{eventId}` from `processingRef.parent.parent`).
2. Load the parent event.
3. Enqueue reparse job if still eligible.

Identity hardening rule:
- never trust `uid`/`eventId` fields in processing payloads
- always derive from document path

Malformed processing metadata policy:
- invalid or inconsistent processing metadata is skipped and logged
- scheduler/script run continues

### UID override mode (safe testing)
When the persisted runtime setting has a target Firebase UID, the scheduler switches to a per-user event scan:
- query: `users/{uid}/events`
- blank target UID means global discovery
- the compile-time `SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS.uidAllowlist` remains the fallback only when no persisted setting exists

### Missing processing docs
Missing `metaData/processing` docs are not visible to the global processing query. Use the backfill script to create them before full rollout.

## Components

### 1. Scheduler scanner
- Function: `scheduleSportsLibReparseScan`
- File: `functions/src/schedule/sports-lib-reparse.ts`
- Frequency: `every 10 minutes`
- Region: `europe-west2`
- Queue: `processSportsLibReparseTask`

Responsibilities:
- discover candidates
- create/update `sportsLibReparseJobs/{jobId}`
- enqueue Cloud Tasks for worker execution

### 2. Task worker
- Function: `processSportsLibReparseTask`
- File: `functions/src/tasks/sports-lib-reparse-worker.ts`

Responsibilities:
- process one job at a time
- strict original-file parse
- rewrite event + activities
- update per-event status + job state

### 3. Local direct reparse script
- Command: `npm run reparse-sports-lib-events`
- File: `functions/src/scripts/reparse-sports-lib-events.ts`

Behavior:
- dry-run by default
- `--execute` enables writes
- global mode uses processing-query discovery (same as scheduler)
- scoped mode (`--uid` / `--uids`) uses per-user event traversal

### 4. Backfill script (one-time / periodic maintenance)
- Command: `npm run backfill-sports-lib-processing-code`
- File: `functions/src/scripts/backfill-sports-lib-processing-code.ts`

Behavior:
- creates missing processing docs with sentinel version/code
- patches missing or mismatched `sportsLibVersionCode`
- logs + skips malformed versions (does not abort)
- dry-run by default

## Data Model

### Checkpoint doc
- Path: `systemJobs/sportsLibReparse`

Fields used:
- `cursorProcessingDocPath`
- `cursorProcessingVersionCode`
- `overrideCursorByUid`
- `lastPassStartedAt`, `lastPassCompletedAt`
- `lastScanAt`, `lastScanCount`, `lastEnqueuedCount`
- `targetSportsLibVersion`

### Job docs
- Collection: `sportsLibReparseJobs/{jobId}`
- `jobId` is deterministic from `uid + eventId + targetSportsLibVersion`

Key fields:
- `status` (`pending|processing|completed|failed|superseded`)
- `attemptCount`, `lastError`
- `enqueuedAt`, `processedAt`, `expireAt`
- `supersededAt`, `supersededBySportsLibVersion` for jobs from an older rollout target

TTL:
- `TTL_CONFIG.SPORTS_LIB_REPARSE_JOBS_IN_DAYS` (currently `30`)

### Per-event status doc
- Path: `users/{uid}/events/{eventId}/metaData/reparseStatus`

Common outcomes:
- `status=completed`
- `status=skipped, reason=NO_ORIGINAL_FILES`
- `status=skipped, reason=MONITORING_SOURCE | ROUTE_SOURCE | NON_ACTIVITY_SOURCE | MIXED_SOURCES_REQUIRING_REVIEW`
- `status=failed, reason=REPARSE_FAILED`

### Non-activity originals retained as events

The source parser first attempts the ordinary activity import. Only its exact non-activity rejection is considered
for classification. FIT classification requires a complete strict raw decode (including CRC), consistent explicit
file types and no activity/session messages. Monitoring and other non-activity types also require no laps. FIT courses
may contain legitimate lap summaries; both FIT courses and GPX route-only sources must pass the route importer with
usable geometry. Missing types, activity/activity-summary types, conflicting declarations, broken geometry, corrupted
files and unrelated failures do not become skips. No classification is inferred from Unknown Sport, a title or zero TSS.

Per-event outcomes distinguish `MONITORING_SOURCE`, `ROUTE_SOURCE`, `NON_ACTIVITY_SOURCE` and
`MIXED_SOURCES_REQUIRING_REVIEW`, all with `status=skipped`. Mixed sets include parsed activities plus classified
non-activity sources or different non-activity kinds. No subset is persisted. Any unclassified/download failure keeps
the overall attempt failed/retryable according to existing rules; it cannot be hidden behind a classified sibling.

The existing owner-only, server-written `metaData/reparseStatus` holds `nonActivitySources`: assessment schema version,
original-reference fingerprint, and per-source kind, preferred/resolved bucket/path, raw-byte SHA-256/MD5 and verified Storage
generation. A post-download metadata check must match the raw-byte MD5 before recording its generation. Every status
transaction rechecks the account deletion guard and event existence; a classified skip also verifies current original
references before committing. Missing events use the lifecycle-skip path so failure handling cannot recreate metadata.
It never updates event/activity content, processing version, volume or Training load. No new metadata collection exists.

Scheduler and executing CLI reuse a saved assessment across library versions only while original references and live
Storage generations/checksums match. The scheduler reuses its existing status read; only previously classified source
sets incur Storage metadata lookups. Ordinary reparses incur no extra Storage metadata reads. Changed references or
replaced objects make the source eligible again, including completed skip jobs for the same target. A newly available
preferred-bucket object also invalidates an assessment made from a fallback bucket. A missing object falls through to
normal reparse/download handling; an unavailable or denied metadata lookup propagates for retry instead of being
treated as proof of a changed source. In particular, an interrupted heavy worker retains its committed skip while
Storage is unavailable, rather than writing a false heavy-timeout failure. Bump the assessment schema if a future importer changes which file
types count as activities. Old terminal failures without an assessment retain their established version-specific
suppression until a new target or explicit reprocessing; no speculative classification is created from an old error.

A handled task remains `completed` with `skipReason`; this means task handling completed, not that an activity was
rewritten. Its event status remains `skipped`, stale error/terminal markers are cleared, and it emits INFO logs.
Reopening a completed skip increments the job's `sourceRetryGeneration` and uses a `source-N` task-name suffix, avoiding
the completed task's retained name. That generation is saved before enqueue and reused after enqueue failures and
normal-to-heavy routing; another completed skip followed by another replacement advances it again. Job identity,
queue limits, task payload and ordinary first-dispatch names remain unchanged.
An interrupted worker recognizes a skip committed for the same target after that attempt started, comparing full
Firestore server timestamps. It completes that handled attempt even when originals have since changed; the scheduler
then invalidates the assessment and queues the replacement. Without that commit evidence it checks an unchanged
assessment before applying the existing heavy-timeout guard; older/different-target skips with changed sources cannot
bypass the guard. CLI `skippedNonActivitySources` is separate from completed/failed counts;
dry-run remains metadata-only and does not discover new classifications by downloading originals. Interactive event
reprocessing reports a clear skip, keeps the saved activity and suggests downloading/uploading a course from Routes.
The callable response excludes the private assessment. Saved-route reprocessing itself is unchanged.

Cleanup is separate: first produce a private, live-verified inventory, distinguish monitoring from courses and mixed
sources, and obtain explicit approval for exact deletions. Courses can contain useful navigation data and must not be
included in a monitoring cleanup. No deletion, migration to Routes/Health, campaign, or deployment is authorized here.

Monitoring coverage decision: **unchanged**. Reviewed `tools/import-monitoring/definitions.mjs` filters only
`[ActivityImport]` events and `processWorkoutTask`, not these workers. Existing reparse task acknowledgements,
per-event statuses and Admin Queue Monitor remain the operational surface; skips no longer inflate failed jobs/error
logs, and real failure signals remain. Replacement task suffixes preserve the same queues and acknowledgement contract;
lookup outages propagate through existing failure/retry diagnostics rather than becoming terminal heavy failures.
No new alerts or low-cardinality metric labels are needed for this outcome
classification, and no production monitoring configuration was applied. MCP impact: no tool, metric, schema, scope,
consent, planning/delivery action or private output changes. Help explains the interactive skip and route recovery.

### Processing metadata doc
- Path: `users/{uid}/events/{eventId}/metaData/processing`

Expected fields:
- `processingEntity: "event"`
- `sportsLibVersion: string`
- `sportsLibVersionCode: number`
- `processedAt`

Notes:
- this doc is user-writable by product decision
- users can influence only their own eligibility by modifying it

## Source-summary and round-trip corrections

Both `reimport` and `regenerate` preserve finite nonnegative fresh parent distance/energy observations that differ from
the available child totals. Capture occurs before edit carryover, only for one unmerged parsed source. Restoration
requires the same source legs, sport types and time windows. Old stored stats are never used, matching child sums remain
free to regenerate, and parent-only observations are never distributed to legs. Multi-file and explicitly merged events
continue to rebuild summaries from their children. This changes no child TSS, Training policy or load metadata, and
adds no stored fields or reads. Existing readers of recorded parent totals see the preserved source observations.

Sports Lib 22.0.0 also preserves valid native JSON lap IDs and independently sums complete multisport
`Timer time`/`Elapsed time` values. Existing child timing can be aggregated locally; recovering previously
lost source-only parent observations or already-renumbered lap IDs requires retained originals through the normal
reparse lifecycle. Root and Functions now use that same published release. No production
reparse or scanner enablement is authorized by these fixes.

## Parse + Write Rules
- Supported source types: `fit`, `gpx`, `tcx`, `json`, `sml` (also `.gz` variants)
- Strictness: if any source file parse fails, event fails for that run
- Multiple source files are merged into one final parsed event

Preserved user-editable fields:
- `name`
- `description`
- `privacy`
- `notes`
- `rpe`
- `feeling`

The reparse reapplies these fields after Sports Lib regenerates event stats. Its final event write transaction also
re-reads the current event document and keeps the latest values plus event tags, so a user edit made while parsing is
in progress is not replaced by source metadata or an older reparse snapshot.

Activity identity strategy:

- A pending legacy activity without valid `sourceIdentity` must still match the complete pre-write window in frozen
  Training metadata. If an older interrupted writer overwrote/reused that ID for another leg, reject with
  `ACTIVITY_IDENTITY_CONFLICT` before further writes. Do not retry by trusting the current document ID or moving its
  old controls. Valid server-owned source snapshots continue to support interrupted source-revision recovery.
  A legacy control without any frozen leg identity also requires valid source provenance before trusting its ID.
- Guarded source preparation is the only owner of saved-ID reuse. Parsing/source-key generation assigns provisional deterministic IDs; matched saved IDs replace them before any write. Only genuinely new legs keep their generated IDs.
- Keep source key generation/validation for new and legacy compatibility; a source-content hash or sport refinement must not rename an already verified leg.
- Use the shared pure matcher and a unique complete retained-source window for mutable sport/statistics. Do not fall back to array order or the only unmatched leg.
- Persist a server-owned `sourceIdentity` containing stable ID, raw start/end and imported type; preserve an explicit owner sport label separately.
- Validate assignments and saved corrections before reserving a source write. Recheck the pre-parse retained references after long parsing, separately from any bucket repair being saved; source replacement remains retryable.
- Use the committed association certificate for Training controls/policies. Calculate benchmark selection remaps once, after preparation assigns final IDs; no pre-write guess or preparation callback is needed.
- Preserve live activity device/sport edits inside guarded document transactions, alongside the existing parent edit policy.
- During first adoption, keep the verified prior imported sport in the write attempt's memory. The final activity transaction needs it to preserve live legacy sport edits/resets; never add it to persisted or incoming JSON metadata.
- Check event existence before reserving and inside subsequent parent/child writes. Reservation ownership and account status alone cannot stop a reparse from recreating a deleted workout. Child writes batch their existing child read with one parent read; event-body writes reuse their preservation read, and merge-flag writes also read the parent. Missing events use the existing skipped-write lifecycle.
- Missing or foreign active leg references during interrupted recovery produce `ACTIVITY_IDENTITY_CONFLICT` for review. Retrying the same source cannot restore that saved association.
- Reject overlapping splits/merges and ambiguous windows with terminal `ACTIVITY_IDENTITY_CONFLICT`; leave the saved source/load available for review.
- Interrupted retries use the existing active leg snapshot rather than partial copies. Delete only stale children outside the final verified ID set using existing reservation/deletion guards.

This metadata is adopted on normal writes/reparses; do not launch a historical campaign just to populate it. A reparse
reads retained originals, not the newest provider export, so it cannot discover a provider-side sport edit that was
never downloaded. A provider resync verifies the persisted provider account/workout identity before accepting that
revision. Read-only source hydration and MCP charts consume the saved association without writing it.

## Bucket Fallback + Auto-Heal
To handle incorrect bucket metadata safely, reparse download tries the known canonical buckets and auto-heals metadata when fallback succeeds.

Code constants:
- `SPORTS_LIB_PRIMARY_BUCKET = 'quantified-self-io'`

Download candidate order:
1. metadata bucket from source-file metadata (if present)
2. explicit primary bucket
3. runtime Admin default bucket (`admin.storage().bucket().name`)

If fallback bucket is used successfully:
- reparse continues
- source metadata bucket fields are rewritten to resolved bucket in same write path

## Access / Entitlement Behavior
Reparse candidate eligibility no longer depends on entitlement checks.
All users with candidate events are eligible in scheduler, worker, and local script paths.

## Runtime Controls
The Admin Event Reparse Queue page controls automatic event discovery. Settings are stored in the existing
`systemJobs/sportsLibReparse` checkpoint document under `runtimeSettings`, independently of Firebase Remote Config.

Persisted fields:
- `enabled`: permits the scheduler to discover and enqueue new work
- `targetUid`: one Firebase UID for a scoped scan, or `null` for a global scan
- `updatedAt` and `updatedBy`: operator audit metadata

Operational behavior:
- disabling the scanner stops later scheduled discovery passes; it does not cancel jobs already in Cloud Tasks
- enabling with a target UID uses the per-user event query and its per-user checkpoint cursor
- enabling with no target UID uses global processing-metadata discovery
- the admin callable requires an explicit global-scan confirmation flag when enabling with no target UID
- malformed persisted settings fail closed and keep discovery disabled
- the Admin page disables settings writes when the current checkpoint setting cannot be read
- the target UID is validated against Firebase Authentication before a targeted scan can be enabled
- malformed targeted or global checkpoint cursors are ignored and that scan restarts from the beginning

Compile-time defaults remain in `functions/src/reparse/sports-lib-reparse.config.ts` under
`SPORTS_LIB_REPARSE_RUNTIME_DEFAULTS`. The scan/enqueue limits always come from these defaults; `enabled`
and the legacy `uidAllowlist` are fallbacks only when the checkpoint has no persisted `runtimeSettings` value.

Activity discovery scans and admits at most 1,800 candidates/jobs per ten-minute tick, up from 1,200.
The same activity scan default is reused by the local reparse and processing-metadata backfill scripts when
`--limit` is omitted; their explicit limits and execute/dry-run controls are unchanged. Route discovery keeps
independent 1,200-item limits. Worker concurrency, the serialized heavy queue, enqueue pacing logic, retry
budgets, discovery enablement, version selection and checkpoint handling are unchanged. This is a local default
change until separately approved deployment; deploying a newer library target can still make older-version
activities eligible again. Monitoring coverage is **unchanged**: the existing normal/heavy metrics and policies
cover committed outcomes, failures, admission, native scanner timeouts and eligible backlog age regardless of
batch size; no alert/resource apply is needed. App Help and MCP contracts are unaffected by this internal limit.

## Required Firestore Index
Global processing-query discovery requires:
- single-field override on collection group: `metaData`
- field: `sportsLibVersionCode`
- index: `COLLECTION_GROUP ASCENDING`

Defined in:
- `firestore.indexes.json`

## Local Commands
Run from `functions/`.

### Reparse script
Dry-run global:
```bash
npm run reparse-sports-lib-events
```

Dry-run scoped:
```bash
npm run reparse-sports-lib-events -- --uid <uid> --limit 100
npm run reparse-sports-lib-events -- --uids <uid1,uid2> --limit 200
```

Execute:
```bash
npm run reparse-sports-lib-events -- --execute --uid <uid> --limit 100
```

Global cursor start-after (event path or processing path):
```bash
npm run reparse-sports-lib-events -- --start-after users/<uid>/events/<eventId> --limit 200
npm run reparse-sports-lib-events -- --start-after users/<uid>/events/<eventId>/metaData/processing --limit 200
```

Notes:
- `--uids` mode ignores `--start-after`
- supports both `--arg value` and `--arg=value`

### Backfill scripts
Dry-run:
```bash
npm run backfill-sports-lib-processing-code -- --limit 1000
npm run backfill-event-processing-entity -- --resume --limit 1000
```

Execute:
```bash
npm run backfill-sports-lib-processing-code -- --execute --limit 1000
npm run backfill-event-processing-entity -- --execute --resume --limit 1000
```

Scoped:
```bash
npm run backfill-sports-lib-processing-code -- --execute --uid <uid> --limit 2000
npm run backfill-sports-lib-processing-code -- --execute --uids <uid1,uid2> --limit 2000
npm run backfill-event-processing-entity -- --execute --resume --uid <uid> --limit 2000
```

Use `backfill-event-processing-entity` when only legacy event processing docs need the `processingEntity: "event"` discriminator. Use `backfill-sports-lib-processing-code` when missing processing docs or missing `sportsLibVersionCode` also need to be repaired.

`backfill-event-processing-entity --resume` reads its checkpoint in dry-run mode but advances the checkpoint only during successful `--execute` batches. It supports global runs or a single `--uid`; it intentionally rejects `--uids` because the checkpoint is a single cursor.

## Rollout Order
1. Deploy Firestore index and wait until READY.
2. Deploy code that writes `sportsLibVersionCode` in ingestion/reparse/frontend paths.
3. Run backfill script dry-run, then execute in batches.
4. Enable scheduler with conservative limits and optional UID allowlist.
5. Expand scope by removing allowlist and increasing limits.

### Version overlap during a functions rollout

Cloud Tasks can briefly deliver jobs created by one functions revision to another revision while a rollout is moving traffic. The worker compares the job target with the installed sports-lib package version reported by `resolveRuntimeSportsLibVersion()`—not a checkpoint value—and classifies that relationship before activity-duration routing or parsing:

- Job target equals the worker runtime target: process normally.
- Job target is older than the worker runtime target: mark only the job `superseded`, record the newer version, and log at INFO. Do not parse the source files or overwrite the event's current `reparseStatus`.
- Job target is newer than the worker runtime target: throw for Cloud Tasks retry and log at WARN. Do not change the job or event status, because a newer revision should receive the retry after rollout.
- Invalid version metadata is a terminal job failure because retry cannot repair it.

The scheduler treats `superseded` as settled. A later candidate scan can create the version-specific job ID for the current target if the event still needs reparsing.

## Observability
The separately owned [Cloud Monitoring runbook](../../../docs/reparse-monitoring.md) covers
normal/heavy/route attempt, committed-outcome and bounded pending-progress observations.
It reuses the two existing ten-minute scanners with hourly observations and an empty-queue
fast path, adds no scheduler or monitoring state, and does not enable discovery or change
reparse limits. The starvation correction performs that bounded hourly observation
before discovery, retaining its five-second deadline. The owner-approved two-scanner
deployment completed on 19 October 2026. Read-only verification confirmed the next natural
route sample at 14:06 UTC and normal/heavy samples at 14:08 UTC: known idle values,
positive sample series, whole-attempt ACKs and native HTTP 200 for both scanner requests.
The older unavailable observations remain historical failures; this does not establish
discovery-throughput or future deadline guarantees. Exact bounds and evidence are recorded
in the monitoring runbook.
Activation and live evidence are tracked
in #834; the heavy admission cap remains #543. Admin queue inspection below remains independent.

Check:
- scheduler checkpoint: `systemJobs/sportsLibReparse`
- job outcomes: `sportsLibReparseJobs`
- per-event status: `metaData/reparseStatus`
- per-event processing metadata: `metaData/processing`

Admin dashboard queue cards:
- `Cloud Tasks` (total)
- `Cloud Tasks (Workout)`
- `Cloud Tasks (Reparse Normal)`
- `Cloud Tasks (Reparse Heavy)`
- `Current Target Failures`: failed jobs for the running target version; these are actionable
- `Historical Failures`: failed jobs from older target versions; these are retained context, not current incidents
- `Superseded Jobs`: older rollout jobs safely settled by a newer runtime

The attention/history table always includes up to ten current-target failures before adding non-duplicate entries from the ten most recent failure or superseded outcomes. It labels active, historical, and superseded rows separately. Only active failures can be manually retried on the heavy queue. If a differentiated count query is unavailable, the admin UI shows that count as unavailable instead of reporting a false zero.

- Shared dispatch semantics and `ALREADY_EXISTS` behavior:
  `functions/src/shared/CLOUD_TASKS_DISPATCH_NOTES.md`

## Exports / Entry Points
Complete function registry exports in `functions/src/full-entrypoint.ts`, served through `functions/src/index.ts`:
- `scheduleSportsLibReparseScan`
- `processSportsLibReparseTask`
- `processSportsLibReparseHeavyTask`
- `scheduleSportsLibRouteReparseScan`
- `processSportsLibRouteReparseTask`

All five runtime targets use owning-module isolated loaders; full discovery exports and
Gen2 resources, schedules, native retries and heavy single-concurrency remain unchanged.

Local npm commands in `functions/package.json`:
- `reparse-sports-lib-events`
- `backfill-sports-lib-processing-code`
- `backfill-event-processing-entity`

## Suunto multisport lap matching in Sports Lib 22.0.0

The 22.0.0 correction replaces ordinal native Suunto multisport lap-summary matching with timestamp/sport evidence,
retains partial summaries at sport changes and stops recovering lap active duration from an unverified global span.
Source-global laps remain intact and appear once on their ending leg. One leg's streams must not generate full-lap
averages or reinterpret sport-specific metrics for a cross-leg lap. Public model shape and canonical tokens stay
compatible. Historical incorrect lap statistics require retained-original parsing after coordinated root/Functions
package adoption; native JSON alone cannot recover the correct summary association. Existing controls, applied
policies, leg identities, recorded event totals and normal sanitization/version/deletion guards remain authoritative.
The runtime target follows the adopted package version. This integration does not enable a campaign or require
saved-route reparsing. QS deployment and production reparse remain separate approvals.
