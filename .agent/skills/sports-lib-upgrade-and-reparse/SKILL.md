---
name: sports-lib-upgrade-and-reparse
description: Deliver a sports-lib package or parsing-behavior change safely through Quantified Self. Use when a version upgrade, activity or route model change, historical parsing correction, durability input change, or reparse-queue behavior might affect persisted data.
---

# Sports-Lib Upgrade and Reparse

Treat a sports-lib change as a data-lifecycle change, not only a dependency update.

## Read First

Read `docs/queue-processing.md`, `functions/src/reparse/SPORTS_LIB_REPARSE_RUNBOOK.md`, and the relevant reparse service, worker, scheduler, configuration, and specs. Also read `docs/training-workspace.md` completely when Training, durability, benchmarks, or derived metrics can change.

## Scope the Change

Determine separately whether it affects:

- new activity imports;
- historical activity reparses;
- saved-route parsing or route reparses;
- derived metrics, Training, durability, or downstream displays.

Document the required data transition in the implementation or existing runbook; do not assume a library version change requires every type of reparse.

## Implementation Checklist

1. Preserve compatible reads for existing documents before changing persisted shape.
2. Align package/runtime version detection, target version, metadata, and version-code handling. Keep version mismatch checks strict.
3. Keep all reparse operations idempotent and retry-safe. Preserve deleted/deleting-user guards, original-file fallback, terminal failures, and heavy-work routing.
4. Use `sanitizeActivityFirestoreWritePayload`, `sanitizeEventFirestoreWritePayload`, and `stripStreamsRecursivelyInPlace` for every event/activity persistence or reconstruction path affected by the change.
5. Update `docs/training-workspace.md` and user-facing help whenever a Training or durability result changes meaning. Update operational documentation when runbook behavior changes.

## Verify

Test the affected service or worker paths, including version mismatch, retry/idempotency, missing source file, deleted user, and terminal failure as applicable. Run `npm --prefix functions run build`; run focused frontend or derived-metrics tests when the result is user-visible.

## Guardrails

- Do not launch a production reparse, deploy, or mutate cloud configuration.
- Do not bypass the queue lifecycle with an ad-hoc bulk write.
- Treat a completed reparse as valid only when its target version matches the running sports-lib version.
