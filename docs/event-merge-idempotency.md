# Event merge idempotency

The `mergeEvents` callable uses server-owned operation records so an ambiguous
client timeout can be retried without creating a second merged event.

## Request identity and stored state

The semantic request identity is the SHA-256 hash of:

- the sorted source event IDs;
- the merge type (`benchmark` or `multi`);
- the operation schema version.

The hash is stored as the document ID at:

```text
users/{uid}/eventMergeOperations/{requestFingerprint}
```

Operation documents contain only the request fingerprint, merge type, source
event count, allocated result event ID, lease/attempt state, safe error code,
expiration timestamp, and the completed response. They do not store source
event IDs. Firestore Rules deny all browser reads and writes to this
collection.

The operation status is one of:

- `processing`: one invocation owns the result ID and an active lease;
- `completed`: the response can be replayed while the result event exists;
- `retryable`: the same request can execute again using the allocated result ID.

Stored request metadata, status fields, leases, ownership tokens, and completed
responses are validated together. Invalid or inconsistent state fails closed.

## Execution and reconciliation flow

1. Authenticate the caller, enforce App Check, validate event IDs and merge
   type, and check the account-deletion guard.
2. Read an existing operation. A valid completed response is returned before
   source validation, so deleting a source after a successful merge does not
   break response reconciliation.
3. Before creating or reclaiming operation state, verify that every source
   event exists under the authenticated user's Firestore path. Invalid source
   selections therefore cannot create operation documents.
4. Claim the semantic request transactionally. An active duplicate returns
   `aborted`; an expired or retryable operation reuses its original result ID.
5. Reconstruct the source events, download and de-duplicate original files,
   write the deterministic result, and finalize processing metadata.
6. Mark the operation completed and return the normalized response. A caught
   failure marks the same operation retryable without changing its result ID.

If a completed result event was deliberately deleted, the next identical
request rebuilds it with the same result ID.

## Timeouts and leases

The Firebase JavaScript callable SDK defaults to a 70-second client deadline.
`mergeEvents` instead uses a 61-minute client deadline because its server
runtime budget is 60 minutes.

The operation lease is the full server runtime plus a one-minute grace period.
This prevents two invocations from writing the same result concurrently during
any valid execution. A hard process crash that bypasses normal error handling
can leave the request unavailable until that lease expires; this is an
intentional safety-over-availability tradeoff. Intermediary and browser
timeouts can still occur, so client reconciliation remains required.

The event table preserves selected event IDs across live row refreshes. After
an unknown outcome, the user can refresh and retry the same selection; the
server either returns the completed response or reuses the claimed result ID.

## Retention

Every processing, retryable, or completed operation carries an `expireAt`
Firestore timestamp seven days after its latest owned state transition. The
native TTL policy for the `eventMergeOperations` collection group eventually
deletes the operation document after that timestamp without requiring a
scheduled query or an automatic field index.

TTL cleanup removes only the reconciliation ledger. It does not delete the
merged event, activities, or original files. Once an operation record has been
removed, selecting the same source events again creates a new operation and
may create a new merged result. Recursive deletion of `users/{uid}` remains the
primary account-deletion cleanup mechanism; TTL bounds ordinary retained
operation state. Operation records are leaf documents by design: do not add
subcollections beneath them because Firestore TTL document deletion is not
recursive.

## Security, privacy, and deletion

- The callable requires Firebase Auth and App Check.
- Source event IDs are constrained to safe Firestore document IDs, unique per
  request, and limited to ten events.
- Event and activity writes continue through the shared recursive stream
  sanitizer and account-deletion guards.
- Operation state is nested under `users/{uid}` and is covered by the
  configured recursive user deletion path.
- Native Firestore TTL bounds operation records to approximately seven days
  after their latest state transition.
- Logs use the request fingerprint and source count rather than raw event IDs.

## Verification and rollout

Relevant local checks are:

```bash
npm --prefix functions test -- --run src/events/merge-events.spec.ts
npm --prefix functions test -- --run src/firestore-indexes.spec.ts src/shared/ttl-config.spec.ts
npm --prefix functions run build
npm test -- --run src/app/services/app.functions.service.spec.ts src/app/services/app.event-merge.service.spec.ts src/app/components/event-table/event.table.component.spec.ts
npm run test:rules
```

Deploy Firestore indexes, Firestore Rules, and the backend before releasing the
retrying frontend. A frontend with reconciliation retries must not target an
older non-idempotent `mergeEvents` implementation.
