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
and the completed response. They do not store source event IDs. Firestore
Rules deny all browser reads and writes to this collection.

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

## Security, privacy, and deletion

- The callable requires Firebase Auth and App Check.
- Source event IDs are constrained to safe Firestore document IDs, unique per
  request, and limited to ten events.
- Event and activity writes continue through the shared recursive stream
  sanitizer and account-deletion guards.
- Operation state is nested under `users/{uid}` and is covered by the
  configured recursive user deletion path.
- Logs use the request fingerprint and source count rather than raw event IDs.

## Verification and rollout

Relevant local checks are:

```bash
npm --prefix functions test -- --run src/events/merge-events.spec.ts
npm --prefix functions run build
npm test -- --run src/app/services/app.functions.service.spec.ts src/app/services/app.event-merge.service.spec.ts src/app/components/event-table/event.table.component.spec.ts
npm run test:rules
```

Deploy Firestore Rules and the backend before releasing the retrying frontend.
A frontend with reconciliation retries must not target an older non-idempotent
`mergeEvents` implementation.
