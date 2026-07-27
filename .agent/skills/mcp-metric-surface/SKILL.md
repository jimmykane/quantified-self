---
name: mcp-metric-surface
description: Keep the read-only Quantified Self MCP surface aligned when Sports Lib metrics, activity details, routes, Training-derived kinds, sleep sessions, or their persisted contracts change.
---

# MCP Metric Surface

Use this workflow for any change that can add, rename, remove, or reinterpret data exposed by MCP.

## Read First

Read `docs/mcp-server.md`. Read `docs/training-workspace.md` completely for Training or derived-metric work. For a Sports
Lib version or parser change, also use `.agent/skills/sports-lib-upgrade-and-reparse/SKILL.md`.

## Classify the Change

- **Sports Lib numeric event stat:** the MCP catalog must discover it from the public `DataStore`, canonicalize it through
  `DynamicDataLoader`, and expose it only when that canonical stat is actually persisted for the user. Do not add a second
  hand-maintained metric registry.
- **First-class body measurement:** keep the automatic numeric Sports Lib catalog authoritative for class existence,
  canonical type, unit, and numeric validation. Add a deliberately allowlisted semantic entry in
  `functions/src/mcp/measurement-catalog.ts` only when the value is meaningful and safe as a personal measurement.
  Preserve identity-free date buckets; never expose exact source timestamps, event/activity identity, names, labels,
  provider/device metadata, or source provenance. Update consent, Help, Policies, the public MCP page, and focused
  catalog/query tests in the same change.
- **Training-derived kind:** register it in `shared/derived-metrics.ts`, preserve the normal snapshot build lifecycle, and
  expose only a ready server-side snapshot.
- **Sleep field or provider:** update the normalized contract in `shared/sleep.ts`, then deliberately decide whether it
  belongs in the MCP safe projection. Never forward provider user/session identifiers, provider payloads, raw stage
  intervals, or raw HRV, SpO2, or respiration samples.
- **Activity-detail field:** decide whether it belongs in the explicit activity summary, lap, jump, or swim-length
  projection. Never forward whole activity documents, raw streams, creator/device metadata, source keys, names/notes,
  internal identifier fields, arbitrary stats, or parser extensions. Exact activity start/end and jump coordinates
  require the `activity-details:read` scope and matching consent/policy wording that explains the sensitive-location
  risk.
- **Saved-route field or parser output:** decide whether it belongs in the explicit route summary, preview, or waypoint
  projection. Never forward original files, raw points/streams, Storage paths, source/delivery provenance, waypoint text,
  links, or extensions. Exact route bounds, preview geometry, and waypoint coordinates require `routes:read`.

## Implementation Contract

1. Keep root and Functions on the same Sports Lib version. Confirm a new numeric class is public, enumerable from
   `DataStore`, has a stable canonical `type`, and round-trips through persisted event JSON.
2. Determine whether historical event reparsing or a derived schema bump is required. Document and test that transition.
3. Preserve the explicit IANA timezone contract for date bucketing and the legacy local-time behavior for existing
   aggregation callers that omit a timezone.
4. Treat `functions/src/mcp/metric-catalog.ts`, `functions/src/mcp/measurement-catalog.ts`, and
   `functions/src/mcp/data.service.ts` as the MCP projection boundary. Expand allowlists deliberately; do not return
   whole Firestore documents.
5. Keep OAuth scopes least-privilege: `metrics:read`, `sleep:read`, `activity-details:read`, and `routes:read` remain
   independent grants. Keep queries bounded, references/cursors UID-and-connection-bound, and tools read-only. Update
   OAuth metadata, consent, Settings, Help, policies, and `docs/mcp-server.md` when the user-visible contract moves.
6. For every new Sports Lib detail or route field, update the named MCP allowlist, add a negative leakage test for nearby
   sensitive fields, confirm historical persistence/reparse expectations, review the Firestore query/index shape, and
   document units and operational limits. A Sports Lib export alone never authorizes MCP exposure.

## Verify

Add or update focused tests for:

- automatic Sports Lib discovery and alias canonicalization;
- first-class measurement catalog resolution, positive/valid value handling, timezone/DST bucketing, aggregation,
  range/work/response limits, missing history, and explicit identity/provenance exclusion;
- persistence availability and any reparse expectation;
- Training ready-state handling and identity redaction;
- sleep safe projection and explicit raw/provider-field exclusion;
- activity-detail and route allowlists, exact-coordinate consent, opaque-reference binding, and source/response limits;
- IANA timezone/DST bucketing;
- scope denial and query limits.

Then run the focused Functions tests, `npm --prefix functions run build`, the affected frontend tests, the Firestore rules
suite when access changes, and `git diff --check`. Do not deploy, publish Sports Lib, start a production reparse, or mutate
cloud configuration as part of this workflow.
