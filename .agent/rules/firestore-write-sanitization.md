---
trigger: always_on
description: Enforce mandatory stream/activities sanitization for event/activity Firestore writes.
---

# Firestore Write Sanitization (Mandatory)

## Scope
Applies to every frontend/functions code path that writes event or activity payloads to Firestore.

## Required Helpers
Always use:
- `sanitizeActivityFirestoreWritePayload(...)`
- `sanitizeEventFirestoreWritePayload(...)`
- `stripStreamsRecursivelyInPlace(...)` (for reconstruction/hydration normalization)

Helper location:
- `functions/src/shared/firestore-write-sanitizer.ts`

## Non-Negotiable Rules
1. Never persist `streams` in any event/activity Firestore document payload.
2. Never persist top-level `activities` in event Firestore documents.
3. Do not re-implement sanitization inline with `delete payload.streams` / `delete payload.activities`.
4. For partial event updates (`updateDoc`), sanitize patch objects with `sanitizeEventFirestoreWritePayload(...)` before writing.
5. For merge/reconstruction flows that map stored activity docs back to sports-lib JSON, call `stripStreamsRecursivelyInPlace(...)` before parse defaults.

## Review Checklist
- Every new event/activity write path imports and uses the shared sanitizer helper.
- Existing write paths are not bypassed by raw Firestore writes.
- Tests assert sanitized payloads contain no recursive `streams` keys and no top-level event `activities`.
