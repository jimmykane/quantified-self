# Benchmark comparisons

Device comparisons use the recordings' overlapping sensor samples, independently of their sport labels. Each saved
report has an ordered reference/test pair. Heart-rate-only and other indoor comparisons are supported; a sport's
group does not establish whether that recording has GPS or any other sensor.

## Generation and measurement availability

Saved comparison generation loads the selected activities and all streams before calculation, including when opened
from the event list or summary. A failed download,
missing activity or changed activity ID stops generation without replacing the previous report. **Retry** reloads
the current activities and opens selection again. No report is saved without usable shared sensor or GPS samples.
Sensor metrics require at least two finite paired samples. GPS comparisons require valid paired coordinates.

New reports store `metrics.gnss: null` when there are no valid paired GPS samples. The report, copied summary and
comparison list display GPS as unavailable; GNSS is excluded from the overall grade. Constant sensor signals retain
their measured differences with `pearsonCorrelation: null`; undefined correlations are excluded from grading too.
Older numeric GNSS reports remain readable, including legitimate zero error. Their old zero values cannot establish
whether GPS was measured; regeneration applies the current availability checks.

## Original-file reparse

The reparse event-write transaction preserves the live document's comparison title, tool metadata, counts, device
index, report dates, tags and reports. It reads those fields at write time, so an edit or report saved during parsing
is retained. The normal shared Firestore sanitizer still removes embedded streams and top-level activities.

Reports are retained as historical measurements with `requiresRegeneration: true`. Reparse reconnects both participant
IDs and their ordered pair key only through unique, strict activity identity matches, including the verified sport
rename compatibility rules. It does not use the legacy last-remaining-activity fallback for report links. Unresolved
participants retain their old IDs and `activityLinksResolved: false`; the app asks for pair selection again. Historical
reports remain viewable and shareable with a regeneration notice. Current summary-stat differences and comparison-list
measurement scores are withheld until a new report is generated.

For otherwise indistinguishable summaries from distinct original files, reparse uses each file's SHA-256 provenance
to assign distinct source activity keys before the combined-event stamping pass. This is independent of upload order.
Other valid source keys and the existing combined-source scheme are retained. Indistinguishable activities inside one
file or duplicate identical file content remain ambiguous; reparse does not invent their identities.

Every original-file event rewrite advances the server-owned `benchmarkSourceRevision`, including workouts with no
previous reports. This also guards the first benchmark generated while an ordinary workout is being reparsed.
Report saves use an owner-scoped
Firestore transaction that checks the source revision captured during stream loading and merges the latest saved
pair map. A concurrent reparse rejects an older generation attempt and offers reload/retry. This adds no backend
endpoint or provider calls. Firestore Rules protect the revision from owner edits.

Live event details include benchmark metadata in their update fingerprint, so report and source-revision changes
reach the UI even when activity IDs and statistics stay the same. Transactional saves return sanitized reports with
normalized timestamps and retain the newest report date across all pairs, regardless of which save finishes last.

## Verification and boundaries

Regression coverage includes missing/invalid samples, failed stream loading, changed IDs, undefined correlations,
legacy and JSON hydration, strict report remapping, live metadata preservation, identical-summary source provenance,
transactional saves and the server-owned Firestore field. Run the benchmark service/component/helper specs, reparse
service/preservation specs, Functions build, Angular compiler and Firestore Rules tests after changing this contract.

Benchmarks remain excluded from Training activity load. This change adds no Training formulas or MCP read/write
surface, consent, provider delivery, FIT decoding, deployment or automatic reparse campaign.
