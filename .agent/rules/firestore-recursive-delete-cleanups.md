---
trigger: always_on
description: Enforce recursive Firestore deletion for cleanup paths to prevent orphaned subcollections.
---

# Firestore Recursive Delete and Deletion-Safe Writers (Mandatory)

## Scope
Applies to frontend/functions cleanup, pruning, deauthorization, account enforcement flows, Firestore triggers, Cloud Task workers, counters, derived documents, idempotency markers, and any feature-owned Firestore state keyed by user UID.

## Recursive Cleanup Rules
1. Do not use plain `delete()` / `bulkWriter.delete()` as the final cleanup mechanism for roots that can have descendants.
2. Use `admin.firestore().recursiveDelete(targetRef)` or `admin.firestore().recursiveDelete(targetRef, bulkWriter)` for cleanup targets such as events, user roots, service token roots, or any mutable tree root.
3. Performance tuning must preserve recursive semantics: pass a shared/custom `BulkWriter` into `recursiveDelete(...)` instead of switching to document-only deletes.
4. If you intentionally use document-only delete, add a code comment proving no descendants can exist by design and keep that invariant covered by tests.
5. Cleanup tests must assert the recursive-delete path is used for subtree-capable targets.

## Account-Deletion Writer Rules
1. Treat `userDeletionTombstones/{uid}` as the durable account-deletion signal. A tombstone is active when the doc exists and `expireAt` is missing or still in the future.
2. Background writers must no-op when the tombstone is active or `users/{uid}` is missing. Use `functions/src/shared/user-deletion-guard.ts` rather than reimplementing this logic.
3. Check before enqueueing async work and check again in the async/Cloud Task worker before writing.
4. For transaction-owned writes, re-check the tombstone and user root inside the transaction before `set`, `update`, or follow-up queue writes.
5. Top-level feature-owned collections keyed by UID must be explicitly cleaned during account cleanup. The Delete User Data extension only knows configured paths such as `users/{UID}` and cannot infer query-based relationships.
6. TTL is only a fallback for stale operational documents. It is not the primary account-deletion cleanup mechanism.

## Review Checklist
- Cleanup code cannot leave orphaned subcollections.
- Any batched optimization still calls `recursiveDelete`.
- Specs cover recursive-delete behavior for critical cleanup paths.
- Firestore triggers, Cloud Task workers, counters, derived docs, and idempotency markers check account-deletion state before writing.
- Account cleanup explicitly removes top-level UID-keyed docs owned by the feature.
