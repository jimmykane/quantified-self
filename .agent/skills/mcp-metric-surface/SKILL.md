---
name: mcp-metric-surface
description: Keep the read-only Quantified Self MCP surface aligned when Sports Lib event metrics, Training-derived metric kinds, sleep sessions, or their persisted contracts change.
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
- **Training-derived kind:** register it in `shared/derived-metrics.ts`, preserve the normal snapshot build lifecycle, and
  expose only a ready server-side snapshot.
- **Sleep field or provider:** update the normalized contract in `shared/sleep.ts`, then deliberately decide whether it
  belongs in the MCP safe projection. Never forward provider user/session identifiers, provider payloads, raw stage
  intervals, or raw HRV, SpO2, or respiration samples.

## Implementation Contract

1. Keep root and Functions on the same Sports Lib version. Confirm a new numeric class is public, enumerable from
   `DataStore`, has a stable canonical `type`, and round-trips through persisted event JSON.
2. Determine whether historical event reparsing or a derived schema bump is required. Document and test that transition.
3. Preserve the explicit IANA timezone contract for date bucketing and the legacy local-time behavior for existing
   aggregation callers that omit a timezone.
4. Treat `functions/src/mcp/metric-catalog.ts` and `functions/src/mcp/data.service.ts` as the MCP projection boundary.
   Expand allowlists deliberately; do not return whole Firestore documents.
5. Keep OAuth scopes least-privilege (`metrics:read` and `sleep:read`), queries bounded, tokens UID-bound, and tools
   read-only. Update consent, Settings, Help, privacy wording, and `docs/mcp-server.md` when the user-visible contract moves.

## Verify

Add or update focused tests for:

- automatic Sports Lib discovery and alias canonicalization;
- persistence availability and any reparse expectation;
- Training ready-state handling and identity redaction;
- sleep safe projection and explicit raw/provider-field exclusion;
- IANA timezone/DST bucketing;
- scope denial and query limits.

Then run the focused Functions tests, `npm --prefix functions run build`, the affected frontend tests, the Firestore rules
suite when access changes, and `git diff --check`. Do not deploy, publish Sports Lib, start a production reparse, or mutate
cloud configuration as part of this workflow.
