---
name: connected-provider-integration
description: Add or materially change a connected fitness-provider integration in Quantified Self. Use for Garmin, Suunto, COROS, Wahoo, or new-provider OAuth, webhooks, activity/history/route/sleep ingestion, delivery, disconnect, provider UI, documentation, and operational coverage.
---

# Connected Provider Integration

Implement the full provider lifecycle: secure connection, idempotent ingestion or delivery, safe persistence, useful product states, and clean removal.

## Read First

Read `docs/provider-integration-guide.md` completely. Read the closest existing provider implementation and the relevant queue, event-writer, route, and Firestore Rules code before introducing a new pattern.

## Product Contract

Define the supported resources and lifecycle before coding: activities, routes, sleep, history, outbound delivery, entitlement, disconnect behavior, and user-visible limitations. Choose explicitly between direct delivery, webhook delivery, history backfill, or a combination.

## Implementation Checklist

1. Implement OAuth identity and token lifecycle with callback validation, least-privilege scopes, and no credential logging.
2. Authenticate webhook requests and make history and webhook ingestion idempotent. Queue durable work instead of holding long provider calls in request handlers.
3. Preserve original-file provenance and provider attribution. Sanitize every event/activity write with the shared Firestore sanitizer helpers; never persist streams or top-level event activities.
4. Cover disconnect, subscription changes, provider errors, retries, account deletion, and queued-work deletion guards.
5. Add the frontend connection/status/error states, help content, and an intentional `/integrations/<provider>` page when it has product or search value.
6. Update the provider matrix, lifecycle guidance, operational coverage, pitfalls, and release checklist in `docs/provider-integration-guide.md`.

## Verify

Run the narrowest frontend and Functions specs, Firestore/Storage Rules tests when access changes, and `npm --prefix functions run build` for backend work. Build the frontend for changed user-facing flows.

## Guardrails

- Do not call real provider APIs, deploy, publish, or change cloud configuration during implementation.
- Do not expose secrets, provider payloads containing personal data, or token values in fixtures or logs.
- Do not add a provider as "connected" until the corresponding disconnect and failure states work.
