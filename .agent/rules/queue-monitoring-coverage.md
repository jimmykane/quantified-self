---
trigger: always_on
description: Review dashboard and alert coverage whenever providers, services, or queues change.
---

# Queue and Provider Monitoring Coverage

Adding, renaming, removing, or materially changing a provider/service integration or queue requires a monitoring
impact review in the same task. Include its workers, dispatchers, and changes to schedules, retry policy, leases,
revisions, and terminal states. This applies to every queue, not only fitness-provider or Training queues.

## Required Review

1. Inspect existing Cloud Monitoring metrics, dashboards, alert policies, and the relevant operational runbook.
   Verify that the new provider/queue is included in filters and labels; an Admin Queue Monitor row is not alert coverage.
2. Assess actionable backlog age, dispatch/processing failures, newly committed dead letters, and missing/unknown
   telemetry where applicable. Distinguish HTTP acknowledgement from committed import/delivery outcomes. Exclude
   expected contention, future work, stale revisions, lifecycle skips, disconnects, and account deletion from failure pages.
3. Reuse the existing source-controlled monitoring bundle and native metrics first. Add only justified telemetry or
   bounded, field-masked probes; do not introduce a global scanner, new scheduler, queue writes, or retry changes merely
   to add alerts. Use fixed low-cardinality labels, never UIDs, job IDs, emails, titles, payloads, credentials, or raw errors.
4. Update affected definitions and runbooks in the same change. Verify filters, thresholds, ownership, no-duplicate
   reapplication, unrelated-resource preservation, and relevant privacy/lifecycle cases. Keep existing domain documentation
   authoritative; Training details belong in `docs/training-workspace.md` and provider details in
   `docs/provider-integration-guide.md`. Shared provisioning lives in `tools/monitoring/`; recorded-import monitoring
   is documented in `docs/activity-import-monitoring.md`.
5. Include an explicit coverage decision in verification notes: **covered**, **unchanged** with an evidence-backed reason,
   or **deferred** with a linked issue. If implementation or activation is deferred, search for duplicates and reuse/create
   a focused issue in Quantified Self IO Project 2 before declaring the feature work complete; link it to the relevant
   parent epic when applicable. Do not leave the gap only in a TODO or assume another agent will handle it.

## Release Boundary

Keep local definitions/tests separate from production deployment, configuration activation, and live readback evidence.
Do not claim operational completion merely because offline tests pass. Production deployment/apply still needs separate
explicit approval; this review requirement authorizes no cloud changes, test emails, fault injection, replay, or deletion.
