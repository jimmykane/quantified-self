---
trigger: always_on
description: Enforce recursive Firestore deletion for cleanup paths to prevent orphaned subcollections.
---

# Firestore Recursive Delete for Cleanups (Mandatory)

## Scope
Applies to frontend/functions cleanup, pruning, deauthorization, and account enforcement flows that remove Firestore documents which may have nested subcollections.

## Non-Negotiable Rules
1. Do not use plain `delete()` / `bulkWriter.delete()` as the final cleanup mechanism for roots that can have descendants.
2. Use `admin.firestore().recursiveDelete(targetRef)` or `admin.firestore().recursiveDelete(targetRef, bulkWriter)` for cleanup targets such as events, user roots, service token roots, or any mutable tree root.
3. Performance tuning must preserve recursive semantics: pass a shared/custom `BulkWriter` into `recursiveDelete(...)` instead of switching to document-only deletes.
4. If you intentionally use document-only delete, add a code comment proving no descendants can exist by design and keep that invariant covered by tests.
5. Cleanup tests must assert the recursive-delete path is used for subtree-capable targets.

## Review Checklist
- Cleanup code cannot leave orphaned subcollections.
- Any batched optimization still calls `recursiveDelete`.
- Specs cover recursive-delete behavior for critical cleanup paths.
