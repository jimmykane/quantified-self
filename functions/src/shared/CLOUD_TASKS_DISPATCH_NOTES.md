# Cloud Tasks Dispatch Notes

## Purpose
Document shared dispatch semantics for Cloud Tasks usage across workout and reparse pipelines.

## Deterministic Task Names
Deterministic task naming is intentional in this project.

For both workout and reparse dispatch paths:
- same logical item/job maps to the same Cloud Task name
- duplicate `createTask` calls should return `ALREADY_EXISTS`
- this is treated as idempotent behavior, not as an operational error

Operational interpretation:
- `ALREADY_EXISTS` means "this task name has already been enqueued at some point"
- this is sufficient for dedupe and avoids duplicate task storms

## Important Cloud Tasks Nuance
`ALREADY_EXISTS` indicates task-name reservation and can mean:
- active task currently exists, or
- recent tombstone-window reservation for a previously executed/deleted task

Therefore, `ALREADY_EXISTS` does not strictly prove a currently runnable task exists at that exact moment.

## Current Product Decision
- keep deterministic dedupe behavior as-is
- do not change enqueue semantics unless production evidence shows stuck items

