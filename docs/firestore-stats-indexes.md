# Firestore stats index allowlist

`firestore.indexes.json` declares the **final, phase-two state**: `stats` is exempt from automatic indexing on both
`events` and `activities`. Explicit child configurations preserve the audited query and compatibility fields.
Do not deploy that complete file as the first migration step. The two phases below are separate, manually approved
cloud changes; merging this configuration does not authorize either phase. No runtime, schema, data, Rules, provider,
MCP or Sports Lib change is needed.

## Query audit

Audit date: 2026-10-19. Reviewed `develop` at `85d094742` and `main` at `ca6232ecd`, including generic query-builder
callers, frontend Firestore queries, backend/worker/scripts, MCP and Assistant readers, projections and aggregations.
Read-only production metadata inspection found no event/activity field overrides and 22 READY composites (21 events,
one activities), with no differences from the repository's event/activity composites. Those composites are unchanged.

The PR review also inspected the deployed `mcpApi` and `queryActivityHealthRange` source artifacts using read-only
access. Their `health/activity-query.ts` and `mcp/data.service.ts` readers are byte-identical to the audited PR sources.
An AST scan of each artifact's application sources confirmed that server-side stats filters/orders are the Weight and
VO2 Max query plans below; MCP stat field paths are projections. No deployment archives or private data are committed.
The latest successful main Hosting build used `ca6232ecd`, the frontend revision included in this audit.

| Reader | Server query shape / source | Stats indexing dependency |
| --- | --- | --- |
| Dashboard and resolver, summary tiles, Calendar, date-range activity section, Tracks | `startDate` range/order; `src/app/services/app.event.service.ts`, `src/app/components/dashboard/dashboard.component.ts`, `src/app/resolvers/dashboard.resolver.ts`, `src/app/components/summaries/summaries.component.ts`, `src/app/services/dashboard-chart-preview.service.ts`, `src/app/services/activity-calendar.service.ts`, `src/app/components/event-table/activity-range-table-section.component.ts`, `src/app/components/tracks/tracks.component.ts` | None. Stat selection, sport filtering and chart aggregation occur after retrieval. Dashboard text search also uses event `name`, outside `stats`. |
| Activity table | `src/app/components/event-table/event.table.component.ts` sorts/filters loaded rows; tags workspace pages by date in `src/app/components/tags/tags-page.component.ts` | None; a table column is not a Firestore order clause. |
| Saved comparisons and benchmark report | `mergeType == benchmark`, ordered by `startDate`; `src/app/services/app.tools-comparison.service.ts`; report compares loaded activities | Existing merge/date composite, no R-R or other metric index. |
| Power Curve auto-tile eligibility | `stats.PowerCurve != null` plus `stats.Activity Types array-contains-any`; `watchHasAnyPowerCurveEventForActivityTypes` in `src/app/services/app.event.service.ts` | Preserve existing Activity Types/PowerCurve composite. Retain Activity Types array indexing for standalone filtering/compatibility. |
| Workout-backed Health | `startDate` range and `stats.Weight > 0` on events; `startDate` range and `stats.VO2 Max > 0` on activities, ordered by date/stat/document ID; `functions/src/health/activity-query.ts` | Preserve both existing date/stat composites. Retain explicit child ordered indexes conservatively. |
| MCP metric discovery/history and Assistant | `functions/src/mcp/data.service.ts`: event date ranges; activity ID, eventStartDate and type queries; `select` projects stats | Projection and reading do not require an index on the selected stat. Rankings and metric calculations happen in memory within existing scan bounds. No catalog, output, scope or consent change. |
| Training derived metrics, load, import/reparse, merge, cleanup and account deletion | Event dates, `eventID`, IDs, revisions and operational fields; `functions/src/derived-metrics/derived-metrics.service.ts`, `functions/src/training-load/`, `functions/src/reparse/`, `functions/src/events/`, `functions/src/users/cleanup.ts` | No additional stats filter/order/Firestore aggregation found. Non-stats indexes and all cleanup behavior remain unchanged. |
| Existing stat composites / earlier stat ordering | Preserved configurations for Device Names, Energy, Descent, Ascent, Activity Types, Distance, Weight, PowerCurve, Average Heart Rate, Duration on events; VO2 Max on activities | Retain all composites and explicit child modes below. Do not infer that a legacy composite is unused from its absence in current UI callers. |

The generic event query/count APIs accept dynamic fields. Their current `main` and `develop` callers above do not
construct arbitrary stats queries. This audit is not a claim about every historical or external client: before rollout,
check supported cached releases and operational clients against the allowlist. Ad hoc console/admin queries on other
stats will require an intentional index addition after enforcement.

Eight representative production **planning-only** checks succeeded: Power Curve eligibility, standalone activity type,
Weight, VO2 Max, event date range, comparison list, event-to-activity lookup and MCP activity ranking. No workout document
results were retrieved or saved. This is a baseline; the final exemption state still requires real staging verification.

## Index contract

The explicit policy lives in `tools/firestore-stats-indexes.mjs` and is checked against `firestore.indexes.json` in CI.

| Collection | Child fields | Collection-scope modes |
| --- | --- | --- |
| events | Activity Types, Device Names, PowerCurve | Ascending, descending, array-contains |
| events | Average Heart Rate, Ascent, Descent, Distance, Duration, Energy, Weight | Ascending, descending |
| activities | VO2 Max | Ascending, descending |

Array modes deliberately preserve the existing defaults on the legacy allowlisted arrays, including PowerCurve.
Further reduction of those modes is a separate query/compatibility review. Numeric fields need no array mode.
No collection-group indexes are introduced. Existing composites remain authoritative for their query combinations.
The parent exemption also removes whole-map `stats` indexing, not just individual subfield indexes. R-R, future and
display-only stats inherit no automatic indexes; their persisted values and canonical display remain unchanged.

Adding a new query on a stat requires an allowlist/mode and composite review in the same PR. Do not automatically
derive this allowlist from Sports Lib's DataStore: most metrics are readable without being queryable in Firestore.
The guard rejects unreviewed stats overrides and composites, missing parents, missing modes and duplicate overrides.

App Help was reviewed: this is an internal storage/index policy with no user-visible behavior change, so Help needs no
edit. MCP/Assistant impact is likewise limited to preserving existing query support; projections, catalogs, wire
contracts, permissions, plugins and Training calculations do not change. No reparse or derived schema bump is needed.

## Two-phase rollout

The helper **only prints JSON containing argv arrays**. It never invokes gcloud, a shell, Firebase, a network client or
any cloud mutation. Pass the target project and database explicitly; there is no production default. Do not pipe its
output to a shell. Every phase, including preparation and rollback, requires field and composite snapshots captured
immediately before planning. Keep local metadata snapshots outside Git.

Before either phase, obtain separate approval for the exact project/database and fields. Inventory every collection
named `events` or `activities`: a collection-group field policy applies across all owners/paths with that collection ID,
not just one user. Keep other fields, Rules, TTL policies and all composites unchanged. Use the targeted field commands
below instead of a broad `firebase deploy --only firestore` that can affect Rules or unrelated index drift.

### Phase 1: preserve the child indexes

1. In a real non-production Firestore database, verify the baseline, apply the explicit child plans, then apply the
   parent exemptions using the phase-two procedure. Seed only synthetic fixtures: missing stats, valid zero values,
   scalar/array stats, normal/multisport events and benchmark pairs. Smoke-test authenticated event/details reads,
   dashboard, Power Curve eligibility, Weight/VO2 Health history, comparisons, Calendar, Tracks, tags, MCP metrics and
   rankings; compare selected fields, values, pagination and results before/after. Include supported older clients.
   The emulator does not enforce compound indexes, so emulator passes alone cannot satisfy this gate.
2. For the separately approved production phase 1, capture metadata and generate the 11 child-only commands:

   ```sh
   gcloud firestore indexes fields list --project=PROJECT_ID --database='(default)' --format=json > /tmp/qs-stats-fields.json
   gcloud firestore indexes composite list --project=PROJECT_ID --database='(default)' --format=json > /tmp/qs-stats-composites.json
   node tools/firestore-stats-indexes.mjs prepare PROJECT_ID '(default)' /tmp/qs-stats-fields.json /tmp/qs-stats-composites.json > /tmp/qs-stats-prepare.json
   ```

   Review each argv array and manually run only the approved commands, preserving quoted field paths literally.
   Each is `gcloud firestore indexes fields update` on one allowlisted child, with the full desired mode list. These
   updates explicitly retain the audited modes already supplied by defaults. The preflight requires enabled parent
   defaults and unchanged READY composites. It blocks existing additional child modes/scopes, unfinished indexes,
   unknown stats overrides, duplicate metadata resources and collection wildcard overrides. This matters because
   `gcloud --index` replaces the field's entire index list; extra settings must be reviewed, not silently deleted.
   **Neither parent is disabled in phase 1.**
3. Wait for every operation to complete and every child index to be READY. Verify each child has an explicit
   configuration (`usesAncestorConfig` false or omitted by protobuf), not just an inherited READY index. Re-run the
   production smoke/planner matrix. Preserve the result and timestamp in the deployment record outside repository docs.

### Phase 2: remove automatic stats indexing

1. Capture fresh read-only metadata in temporary local files, using the exact approved target:

   ```sh
   gcloud firestore indexes fields list --project=PROJECT_ID --database='(default)' --format=json > /tmp/qs-stats-fields.json
   gcloud firestore indexes composite list --project=PROJECT_ID --database='(default)' --format=json > /tmp/qs-stats-composites.json
   node tools/firestore-stats-indexes.mjs enforce-events PROJECT_ID '(default)' /tmp/qs-stats-fields.json /tmp/qs-stats-composites.json > /tmp/qs-stats-enforce-events.json
   ```

   The helper must succeed. It requires explicit READY child modes, unchanged READY event/activity composites, matching
   project/database, expected database/parent modes, no collection wildcard, no reverting configuration and no unknown
   explicit stats overrides. An already-disabled parent is accepted when resuming phase two; preparation does not run
   against a disabled parent.
   Any drift is a stop condition: re-audit instead of forcing the plan. It does not certify snapshot freshness or
   historical client compatibility; those remain operator gates.
2. After the separate phase-two approval and staging/smoke gates, review and manually run the single printed command:
   it disables automatic indexing on **events.stats only**. Do not deploy the entire final config in place of these phases.
   Wait for completion; inspect inherited/unindexed sample stats and the still-explicit allowlisted children. Re-run
   the planner/authenticated smoke matrix and watch missing-index `FAILED_PRECONDITION` errors and query latency before
   continuing. Query Explain uses IAM, so it does not replace authenticated browser/Rules coverage.
3. Capture both metadata files again. Run the same helper with `enforce-activities`; after the same checks and approved
   verification window, review/run that one parent command. Verify both final parent exemptions and all 22 composites.
   Once the completed production state matches the reviewed canonical file, ordinary index deployments may use it.
   Current Hosting and Functions workflows do not deploy Firestore indexes; keep that boundary intact.

No field values or documents are deleted by this migration. Firestore removes existing automatic index entries through
managed background operations; no document rewrite/backfill/delete job is needed. Wait for operation completion and
subsequent storage/billing reporting before measuring savings. Do not promise an instantaneous decrease or a fixed
cleanup duration. Manual/composite indexes remain until separately removed; this migration removes none of them.

## Rollback and maintenance

```sh
gcloud firestore indexes fields list --project=PROJECT_ID --database='(default)' --format=json > /tmp/qs-stats-fields.json
gcloud firestore indexes composite list --project=PROJECT_ID --database='(default)' --format=json > /tmp/qs-stats-composites.json
node tools/firestore-stats-indexes.mjs rollback PROJECT_ID '(default)' /tmp/qs-stats-fields.json /tmp/qs-stats-composites.json > /tmp/qs-stats-rollback.json
```

After separate rollback approval, review/run the two parent-only `--clear-exemption` commands, or just the affected
collection's command. The rollback gate also checks ancestor/default and composite drift, so clearing an exemption
cannot silently restore a different inheritance policy. Keep all explicit children and composites. Restoring inherited indexing may require background
rebuilds before affected queries recover; rollback is not guaranteed to be immediate. If phase one failed, stop before
disabling any parent and fix the specific child configuration. Do not clear child exemptions while a parent is disabled.
Reconcile the canonical configuration with any approved rollback before another index deployment.

Run `npm run test:stats-indexes`, `npm run test:workflows`, and
`npm --prefix functions test -- src/firestore-indexes.spec.ts` after policy/configuration edits. Test the affected query
services as well when a query shape changes. Tests cover inheritance policy, quoted field paths, all array modes,
unknown/R-R stats, additive preparation, wildcard/parent drift, incomplete/failed builds, inherited child configurations, cross-project snapshots,
separate parent phases, rollback and the print-only CLI. Real staging validation remains a required deployment gate.

References: [map inheritance and composite independence](https://firebase.google.com/docs/firestore/query-data/index-overview#automatic_index_exemptions),
[field configuration and index removal](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.fields),
[asynchronous field operations](https://firebase.google.com/docs/firestore/reference/rest/v1/projects.databases.collectionGroups.fields/patch),
[Query Explain](https://firebase.google.com/docs/firestore/query-explain),
[emulator index limitations](https://firebase.google.com/docs/emulator-suite/connect_firestore#how_the_cloud_firestore_emulator_differs_from_production),
[gcloud field updates](https://docs.cloud.google.com/sdk/gcloud/reference/firestore/indexes/fields/update).
