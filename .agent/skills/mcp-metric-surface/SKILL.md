---
name: mcp-metric-surface
description: Keep Quantified Self MCP tools, scopes, consent, projections, contracts, and bundled plugin workflows aligned when exposed data or authorization changes. Also use for every Training planning feature change, including frontend- or backend-only changes.
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
- **Recorded Health metric:** extend only the explicit public allowlist in `functions/src/mcp/health.service.ts`.
  Preserve `health:read`, the additional Body measurements grant and identity-free date buckets for body composition,
  and the separate Weight/Sleep contracts. Keep sample parent-revision checks, source-separated semantics, Sports Lib
  display/unit preferences, read/output bounds, and strict negative leakage fixtures. Never resolve Sleep references
  through Health permission or infer permission for new sensitive metric families from a shared catalog addition.
  Native exceptions require an exact provider/metric/unit/semantic allowlist and explicit native-labelled output;
  Garmin Body Battery points must never be relabelled as a canonical percentage.
- **Training-derived kind:** register it in `shared/derived-metrics.ts`, preserve the normal snapshot build lifecycle, and
  expose only a ready server-side snapshot. Add its exact identity-free payload schema to
  `functions/src/mcp/derived-output-schemas.ts`; the exhaustive map must fail compilation until the new kind is covered.
- **Training plans and planned workouts:** distinct from Training-derived metrics and completed activities. Review every
  planning change for MCP impact. Relevant plan/workout capabilities, lifecycle semantics, recipe fields and safe
  delivery-status changes must extend the plan-specific MCP surface in the same feature PR. Coordinate explicit
  Firestore projections, strict schemas, independent `training-plans:read` consent, owner/connection-bound references,
  revision-bound pagination and byte limits, Sports Lib unit formatting, Assistant routing/evidence, bundled Training,
  Activity and cross-domain guidance, tests and documentation. Keep detailed behavior in `docs/mcp-server.md` and
  `docs/training-workspace.md`; distinguish implementation from deployed/registered-client availability.
  Never forward whole records or automatically expose new stored fields. Preserve registered schemas using the
  compatible additive-tool lifecycle when a shape cannot safely change. Keep private delivery fields private.
  Keep upcoming-session reads chronologically ordered by calendar date with a stable opaque continuation. Use bounded
  bulk reads for exact completion reviews instead of forcing one tool call per workout. Provider-compatibility reads
  may expose only versioned local exact/degraded/unsupported mapping issues; they must not read connection authority,
  private mapping digests, ledgers or provider APIs, and must not imply approval, delivery or watch receipt.
  Keep every manually mirrored workout recipe discriminant behind an exhaustive compile-time coverage map and fixtures
  that JSON-round-trip each shared variant through public read and write validation. A shared-model addition must fail
  closed until its MCP schema, formatting, Assistant/plugin authoring guidance, contract digest and tests are reviewed;
  never make the coverage map an automatic field-exposure mechanism.
  Read extensions use `training-plans:read`. New mutation capability is never implied: it must fit the explicit safe
  Training lifecycle, use the independent `training-plans:write` or `training-delivery:write` child scope, enter one
  bounded preview, bind owner/connection/grant/revision/expiry, and expose an idempotent apply as a separately
  approval-gated write tool with accurate annotations. The external MCP host owns its native approval UI; do not use MCP
  elicitation solely to reconfirm a fully specified write call, and document that server code cannot detect a client's
  automatic-approval setting. User guidance must also call out unattended connector modes such as Claude Research and
  tell users to disable Training write tools there when per-call review is required. The built-in Assistant may expose
  preview to the model but never apply; app-owned confirmation must
  recheck its server-owned conversation generation. Provider actions reuse the server delivery command and Pro/readiness
  gates, never accept credentials or remote IDs, and return independent outcomes without rolling back authored data.
  Permanent workout deletion, plan deletion, history restore, inferred completion and new provider actions require a
  new explicit contract decision rather than silently widening the existing union.
  Record a genuine no-impact rationale in verification notes. If relevant coverage must be deferred, create or
  reuse a focused #583 subissue, add/verify it in Project 2, and reference it before declaring completion.
  Existing read/write coverage does not authorize wider consent, additional mutations, provider transport calls or deployment.
- **Sleep field or provider:** update the normalized contract in `shared/sleep.ts`, then deliberately decide whether it
  belongs in the MCP safe projection. Never forward provider user/session identifiers, provider payloads, raw stage
  intervals, or raw HRV, SpO2, or respiration samples.
- **Activity-detail field:** decide whether it belongs in the explicit activity summary, lap, jump, or swim-length
  projection. Never forward whole activity documents, raw streams, creator/device metadata, source keys, names/notes,
  internal identifier fields, arbitrary stats, or parser extensions. The separate `get_activity_description` tool may
  read only the parent event description with both `activity-descriptions:read` and `activity-details:read`; this never
  widens normal activity/metric projections. Preserve explicit consent, full-text bounds and untrusted-context semantics.
  Exact activity start/end and jump coordinates,
  nearby search, and chart breadcrumbs require dependent `activity-location:read` in addition to
  `activity-details:read`.
- **Event-owned or Timeline-note mutation:** keep these focused writes separate from recorded activity data and
  Training mutations. Event tag/title changes require `events:write` plus `activity-details:read`; description changes
  also require `activity-descriptions:read`. Read the exact current field (`query_activities_with_tags`,
  `get_event_title`, or `get_activity_description`) before a focused optimistic-concurrency replacement. Reject
  benchmark events, including no-ops, and remind clients that sibling activities share the result. A natural-language
  activity/workout rename maps to the parent event title, not an activity document. New editable event fields still
  require a separately reviewed strict tool and never become exposed merely because they exist in storage. Timeline-note
  create/edit/delete requires
  `timeline-notes:write` plus `timeline-notes:read`, owner/connection-bound references, current revisions, an idempotent
  create mutation ID, and permanent-delete disclosure. Both use existing sanitized persistence paths, recheck the
  stored connection grant and account-deletion fence inside the transaction, advertise accurate write/destructive/
  idempotency annotations, and rely on the MCP host's native approval UI. Never infer either write from user-authored
  text, expose raw IDs/receipts, or add a parallel persistence path. The built-in Assistant may support the same safe
  mutations only through separate default-off, server-owned per-chat choices: expose read-current-state and local
  prepare-only tools to the model, store at most one short-lived proposal, show an app-owned review, and apply through
  the existing sanitized mutation service after rechecking the conversation generation, permission, proposal identity,
  expiry, optimistic precondition, deletion fence, and owner. Never expose the public write tools directly to the model
  or let model-authored text bypass app confirmation. Reuse the existing Assistant apply endpoint rather than adding a
  callable for each content mutation.
- **On-demand activity chart stream:** add deliberate aliases and canonical units to
  `functions/src/mcp/activity-stream.service.ts` (re-exported by the chart service), request only the stream and Sports Lib derivation dependencies, and
  preserve the existing original-file-only workflow. Keep file, raw/decompressed byte, selected-sample, runtime,
  response, point, and per-connection/user parse budgets. Downsample the complete domain; never crop, persist parsed
  output, invoke reparse/auto-healing, or return original files, full-resolution streams, absolute sample timestamps,
  source metadata, or unrequested streams.
- **Detailed activity samples:** preserve the additive `get_activity_samples` contract and existing
  `activity-details:read` grant. Share the chart catalog, selective original-file parser, identity matcher and source
  budgets; project only selected canonical numeric arrays on an elapsed-second grid. Keep aligned null gaps, complete
  range pagination, exact units, whole-result byte bounds, owner/connection/query/source-bound expiring cursors, and
  source revision and access checks on every page. Cache only the safe selected projection within the documented
  short-lived process-memory limits; never persist streams, cache raw files or parser objects, expose coordinates,
  call provider APIs, backfill data or silently truncate a parse. Review external-client versus Assistant routing.
- **Saved-route field or parser output:** decide whether it belongs in the explicit route summary, preview, or waypoint
  projection. Never forward original files, raw points/streams, Storage paths, source/delivery provenance, waypoint text,
  links, or extensions. Exact route bounds, preview geometry, nearby search, and waypoint coordinates require dependent
  `route-location:read` in addition to `routes:read`.
- **Local plugin or bundled workflow skill:** keep `plugins/quantified-self/plugin.template.json`, the repo-local
  marketplace, branding, the three manifest-level starter prompts, and all seven focused/cross-domain workflow skills
  aligned with the public MCP surface. Review the affected single-domain skill and the cross-domain skill whenever a
  domain changes. Do not duplicate complete tool names or metric IDs in a skill; make it discover authoritative runtime
  tools and catalogs. Keep each skill's `agents/openai.yaml` prompt, one hosted MCP dependency, and implicit-invocation
  policy aligned. Keep the ChatGPT technical app ID and generated cache-busted bundle files out of Git.
- **OAuth consent UI:** initialize selected permissions from the complete validated scope list returned for the
  authorization request. Every requested current and future scope starts checked. Do not maintain per-scope default-off
  filters. Users must remain able to uncheck independent scopes before approval; removing a parent scope must remove and
  disable its dependent child scopes. Preselection is presentation state only and never creates or expands a grant
  without explicit approval.

## Implementation Contract

1. Keep root and Functions on the same Sports Lib version. Confirm a new numeric class is public, enumerable from
   `DataStore`, has a stable canonical `type`, and round-trips through persisted event JSON.
2. Determine whether historical event reparsing or a derived schema bump is required. Document and test that transition.
3. Preserve the explicit IANA timezone contract for date bucketing and the legacy local-time behavior for existing
   aggregation callers that omit a timezone.
4. Treat `functions/src/mcp/metric-catalog.ts`, `functions/src/mcp/measurement-catalog.ts`, and
   `functions/src/mcp/data.service.ts` as the MCP projection boundary. Expand allowlists deliberately; do not return
   whole Firestore documents.
5. Keep OAuth scopes least-privilege: `metrics:read`, `measurements:read`, `sleep:read`, `activity-details:read`, and
   `routes:read` remain data grants. `activity-location:read` and `events:write` depend on activity details,
   `timeline-notes:write` depends on Timeline-note reads, and `route-location:read` depends on routes; the domains remain
   independent. Enforce those dependencies in consent, approval,
   refresh, bearer validation, HTTP prechecks, tool registration, and data reads. First-class measurement types must also be excluded from generic and
   per-activity metric paths so those tools cannot bypass `measurements:read`. Keep queries bounded, references/cursors
   UID-and-connection-bound, and ordinary data tools read-only. The only focused non-Training mutations are explicitly
   consented event-tag replacement and Timeline-note create/edit/delete, which must preserve the boundaries above. The
   broader event grant does not expose titles, descriptions, or other event fields without a dedicated tool, approval
   contract, projection review, tests, and documentation.
   Training mutations must preserve the strict preview/native-approval/idempotent-apply boundary. Update OAuth metadata, consent, Settings, Help, policies, and
   `docs/mcp-server.md` when the user-visible contract moves.
6. For every new Sports Lib detail or route field, update the named MCP allowlist, add a negative leakage test for nearby
   sensitive fields, confirm historical persistence/reparse expectations, review the Firestore query/index shape, and
   document units and operational limits. A Sports Lib export alone never authorizes MCP exposure.
7. For every new or changed MCP tool or output field, update the matching entry in
   `functions/src/mcp/tool-output-schemas.ts`. Use recursively strict objects. Model optional fields only when the key can
   be absent; use nullable fields when the key is present with no value. Keep canonical units, opaque references,
   timestamps/date ranges, pagination cursors, counts, and result arrays explicit. Parent-only activity and route schemas
   must omit their location fields entirely. Do not widen a public schema from an internal object, and do not use
   `any`, `unknown`, a catch-all object, or an unconstrained dynamic map as a shortcut.
8. Keep one schema in charge of advertisement and enforcement: the registration wrapper must advertise it, validate the
   projected value before serialization, return the validated value as `structuredContent`, and emit equivalent JSON
   text for compatibility. Expected errors remain text-only `isError` results. Update the in-memory contract fixture for
   every affected tool, every derived kind, optional/nullable and pagination states, and add a negative leakage canary
   for each sensitive neighboring field.
9. Preserve the registered MCP contract in `functions/src/mcp/contracts/registered-contract.json`. Existing tool names,
   authorization-profile availability, annotations, security schemes, and input/output schemas are frozen after
   registration; use an additive tool for a new shape. Run `npm --prefix functions run mcp:contract:check` for every
   public MCP change. Compatible new tools or metadata require the digest-bound pending change record and the documented
   developer refresh or published-version lifecycle; a pending record never overrides a breaking finding. Never edit
   the registered baseline or append-only transition history directly; use the verified promotion command.
10. Classify local-plugin follow-up explicitly. Tool names, descriptions, schemas, scopes, or server instructions require
   a deployed-server update and a rescan of the registered ChatGPT app. Plugin manifest, starter-prompt, icon, or bundled
   skill changes require `npm run plugin:sync` after validation. Server implementation changes that preserve the public
   contract do not require a plugin rebuild.
11. Treat the exported bundled-skill registry in `tools/quantified-self-plugin/plugin-tool.mjs` as exhaustive. Add a new
    skill with the official skill scaffolder, then update that registry, source and installed-tree fixtures, per-skill
    starter prompt, MCP dependency, README, and `docs/mcp-server.md` together. The source directory must contain exactly
    the registered skills, and installed validation must compare every regular file recursively and reject symlinks.

## Verify

Add or update focused tests for:

- automatic Sports Lib discovery and alias canonicalization;
- first-class measurement catalog resolution, measurement-specific value validation, timezone/DST bucketing, aggregation,
  range/work/response limits, missing history, and explicit identity/provenance exclusion;
- persistence availability and any reparse expectation;
- Training ready-state handling and identity redaction;
- planned-workout scope isolation, complete recipe/Unicode validation, field-mask leakage rejection, reference replay,
  revision/deletion/consent fences, calendar scopes, bounded pagination and complete/incomplete delivery aggregates;
- Training proposal scope dependencies, safe-operation union, opaque proposal replay, stale revision/grant/conversation
  rejection, native approval annotations on every transport, idempotent apply, standalone-create-plus-send,
  provider-failure isolation, and the absence of provider transport from preview;
- Assistant optional Training consent reset/retry generation, planned-versus-completed routing and compact untrusted-text
  evidence. Review three cases: a new workout target needs explicit MCP schema/format tests; presentation-only spacing
  needs a documented no-wire-impact rationale; provider-internal artifact metadata must stay excluded;
- exhaustive tool/output-schema registration, Ajv validation of every successful `structuredContent` result, JSON-text
  equivalence, exact Training payload-kind pairing, and generic text-only contract-mismatch errors;
- sleep safe projection and explicit raw/provider-field exclusion;
- activity-detail and route allowlists, parent/location authorization matrices, exact-coordinate redaction,
  opaque-reference binding, selective on-demand parsing, identity ambiguity, complete-domain downsampling, and every
  source/sample/runtime/point/response/rate limit;
- IANA timezone/DST bucketing;
- scope denial and query limits;
- content-write parent/scope isolation, stored-grant and deletion fencing, owner/connection reference replay denial,
  event-tag sibling semantics, stale-tag conflicts, note create/update/delete idempotency and revision conflicts,
  permanent-delete receipts, strict text/timezone validation, response bounds, and absence from the built-in Assistant;
- consent initialization with every requested scope checked, independent-scope unchecking, parent/child removal, and
  approval as the only grant boundary.

Then run `npm --prefix functions test -- src/mcp/tool-output-schemas.spec.ts` plus the focused Functions tests,
`npm --prefix functions run mcp:contract:check`, the affected frontend tests, the Firestore rules suite when access changes,
`npm run plugin:tools`, the official skill validator for every bundled skill,
`npm --prefix tools/quantified-self-plugin test`, a fixture-ID `npm run plugin:validate` when the local package or public
tool contract is affected, and `git diff --check`. Forward-test representative prompts for every affected workflow,
missing-permission handling, and ambiguous single-domain/cross-domain routing. Do not deploy, publish Sports Lib, start
a production reparse, install the plugin into a real profile, or mutate cloud configuration as part of this workflow.
