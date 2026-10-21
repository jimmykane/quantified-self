# Activity ascent corrections

Owners can choose **Edit ascent** in a recording's action menu and correct canonical Sports Lib Ascent
for one activity at a time. The editor supports multi-activity recordings by selecting a leg.
Benchmark comparisons and Diving terrain summaries are excluded.

## Persistence and source lifecycle

The activity stores its effective `stats.Ascent` and server-owned `ascentCorrection` metadata:
`value` is the correction and `sourceValue` is the latest imported value, in the canonical Sports Lib unit.
Missing imported ascent remains null. Other statistics, streams, laps, originals, and provider records are unchanged.

The existing `reprocessEvent` callable accepts an app-only `correct_ascent` operation. Authentication,
App Check, an expected owner, a strict edit shape, and the current source fingerprint are required.
Its transaction rechecks deletion, parent membership, benchmark classification, source-write barriers,
source fingerprints, and the current correction. It reads at most 100 activities, updates ascent and its
metadata, and recomputes parent ascent from non-Diving activities.
The app receives those committed canonical values and patches ascent in place on the same recording instance.
It keeps hydrated activities/streams and ignores results after navigation, an account change, or view destruction.

Saved load evaluations, policies, and controls are retained. Their server-owned source fingerprints and
cache are updated in that same transaction so unchanged load remains available after an ascent-only edit.
Source revision advances. Source-write timestamp suppression is cleared so existing source triggers can
invalidate affected summaries. This uses the processing endpoint because a client-only stat patch cannot
maintain these private source/cache invariants. No new callable, trigger, queue, index, or secret is added.

Imports and reparses read live corrections inside their existing source reservation. Only strict activity
matches receive a correction; source-derived ID changes are supported, while an unmatched correction blocks
replacement rather than moving to a guessed leg. The latest parse refreshes the imported reset value.
The shared EventWriter retains this metadata explicitly because Sports Lib JSON omits app-owned fields.
Browser hydration also keeps corrections separate from device-name fallback matching.
Interrupted reparses use the server-owned active leg snapshot while a source-write barrier is present. This lets
retries retain corrections without treating old IDs and partially written replacement IDs as competing activities;
missing/foreign source references and ambiguity outside recovery still fail closed.

**Reset to imported value** is reviewed in the editor and applies only after Save. It removes the correction
and restores the latest imported value, including absence. Stale editors must reload. Altitude charts and
lap measurements still describe the original recording; a total correction does not rescale those samples.

## MCP and Assistant impact

Persisted Ascent remains the existing canonical metric. Existing metric queries, rankings and activity reads
consume its corrected value through their existing projections. Correction metadata and imported-value
provenance remain outside MCP/Assistant projections. No ascent write tool, consent expansion, new metric token,
registered schema change, derived schema migration, or plugin refresh is introduced. The existing event-write
grant keeps its focused text/tag capabilities.

## Verification and release

Unit/component coverage includes validation, units, edited/imported display, reset review, haptics, stale errors,
and account changes during saves. Real Firestore coverage includes correction/reset, load-cache consistency,
fresh-source import and reparse, stale/foreign targets, pending-source barriers and account deletion. Rules
forbid clients from writing correction metadata directly.

Release updated `reprocessEvent`, affected source-import/reparse workers and Firestore rules before the frontend.
Implementation and PR creation do not authorize deployment or live provider calls.
