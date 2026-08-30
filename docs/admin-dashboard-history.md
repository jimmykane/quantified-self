# Admin dashboard user history

The Admin Dashboard keeps one aggregate user-metrics snapshot per UTC day so operators can see changes in account activity, plan mix, and paid subscription cadence without adding a product analytics SDK or retaining per-user activity history.

## Metric definitions

The daily snapshot reuses the same server-side collector as the live User KPIs. This keeps the current cards and historical charts aligned at collection time.

| Group | Stored metric | Definition |
| --- | --- | --- |
| Users | Total, Free, Basic, Pro | Current user-document total and one latest canonical active-plan classification per Stripe customer |
| Users | Onboarding complete | User documents whose onboarding flag is complete |
| Authentication activity | Eligible accounts | Enabled Firebase Auth accounts without the admin custom claim |
| Authentication activity | Active 24h / 7d / 30d | Eligible accounts whose latest available Firebase Auth `lastRefreshTime` or `lastSignInTime` falls in the rolling window |
| Authentication activity | Active Free / Basic / Pro by window | The active accounts in each rolling window joined to their latest canonical active paid plan; accounts without a qualifying Basic or Pro plan are Free |
| Subscription cadence | Pro monthly / yearly / unknown | Active Pro users classified from their selected Stripe subscription's current price recurrence |
| Subscription cadence | Basic monthly / yearly / unknown | Active Basic users classified from their selected Stripe subscription's current price recurrence |

Authentication activity is an account-access signal, not foreground engagement analytics. Firebase can update `lastRefreshTime` when an authenticated session refreshes its ID token in the background. The dashboard therefore says “sign-in or ID token refresh” and must not describe these windows as sessions, screen views, or feature usage.

The collector resolves the canonical active subscription owner map once, keeps that UID-to-plan join in memory only for the duration of collection, and applies it while paging Firebase Auth. It does not add Auth or Firestore reads beyond the reads already required for the live totals. The response, snapshot, and logs contain only aggregate counts; they never expose the owner map or user identifiers.

Cadence `unknown` is retained deliberately. A non-zero value means an active paid subscription could not be safely classified as monthly or yearly and should be investigated; it must not be silently forced into either cadence.

Only active Basic or Pro documents whose full reference matches `customers/{uid}/subscriptions/{subscriptionId}` are eligible for plan metrics. The collector ignores same-named collection-group documents at every other path, and an unrecognized-role document cannot mask a qualifying paid entitlement. If a customer has multiple qualifying active paid documents, it selects the newest `created` value, using the subscription document ID as a deterministic tie-breaker, so Basic and Pro remain mutually exclusive user classifications. Garmin and Suunto client rules also restrict legacy token writes to direct `tokens/{tokenId}` documents and deny arbitrary descendants.

## Capture and storage

`scheduleAdminDashboardSnapshot` runs at `00:10 UTC` every day. The scheduler's intended execution date becomes the document ID (`YYYY-MM-DD`), which makes retries idempotent: a retry replaces that date's snapshot instead of adding a duplicate.

Snapshots are written to the top-level `adminDashboardSnapshots` collection with:

- schema and metric-definition version `2`;
- the UTC snapshot date, scheduled time, actual computation time, and TTL expiry;
- the aggregate user, authentication-window, and subscription-cadence counts listed above.

The document is rejected before writing unless all counts are non-negative safe integers and these invariants hold:

- Free + Basic + Pro equals total users;
- onboarding complete does not exceed total users;
- active 24h ≤ active 7d ≤ active 30d ≤ eligible accounts;
- for every rolling window, active Free + Basic + Pro equals that window's active total;
- each plan's active 24h ≤ active 7d ≤ active 30d, and active paid counts do not exceed their current paid-plan totals;
- each tier's monthly + yearly + unknown cadence equals that tier's active total.

Snapshots do not contain UIDs, email addresses, provider lists, raw authentication timestamps, activity events, screen views, analytics identifiers, or heartbeat records. Version 2 begins accumulating active-plan history after its scheduler is released; there is no synthetic backfill for version 1 snapshots.

## Retention and access

Each snapshot receives an `expireAt` value 730 days after computation. The `adminDashboardSnapshots.expireAt` override in `firestore.indexes.json` enables Firestore TTL and disables unnecessary single-field indexing for the TTL field. TTL deletion is asynchronous, so 730 days is the intended retention boundary rather than an exact deletion instant.

Firestore Rules deny every direct client read and write to this collection, including admin clients. `getAdminDashboardHistory` is the only application read path. It uses the shared admin callable guard, including authentication, admin-claim, and App Check enforcement, and returns aggregates only. Server SDK scheduler writes bypass client rules as intended.

TTL configuration is infrastructure state. Local emulator startup and Functions deployment do not enable the production TTL policy; deploy the reviewed Firestore index configuration separately through the normal release workflow.

## History API and dashboard behavior

`getAdminDashboardHistory` accepts only `30`, `90`, or `365` days and defaults to `90` when the caller omits the range. It queries date-keyed documents inside the requested inclusive UTC interval, discards malformed or incompatible-version documents, and returns valid points oldest first. The reader accepts both version 1 and version 2 snapshots. Version 1 points return a `null` active-plan breakdown so their existing totals remain available without reinterpreting old data.

The Admin Dashboard requests 365 days once per refresh and switches among 30-, 90-, and 365-day views locally. It renders four focused charts:

1. authentication activity for the rolling 24-hour, 7-day, and 30-day windows, with eligible-account percentages in tooltips;
2. stacked active Free, Basic, and Pro users, with a local selector for the rolling 24-hour, 7-day, or 30-day window;
3. stacked Free, Basic, and Pro user totals plus onboarding completion;
4. stacked Pro and Basic monthly/yearly cadence, adding unknown-cadence series only when unknown values exist.

Missing capture days between the first and last observed point remain `null` chart gaps. The UI does not invent zeroes or interpolate them. Leading or trailing absent days are not plotted. A separate status reports the number of internal gaps and marks history stale when the newest snapshot computation is more than 36 hours old.

The charts need eight snapshots in the selected range before rendering. The active-plan chart specifically needs eight version 2 snapshots with a valid plan breakdown; version 1 snapshots continue to render in the other charts and do not count toward this threshold. Before then, the dashboard shows plan-history collection progress. This is expected immediately after release and is not an error.

Historical loading and failures are isolated from the live User KPI request. A callable or validation failure shows “Daily user history is unavailable” without removing the current cards; similarly, a live KPI failure does not erase already available historical results.

## Operations and changes

- Scheduler failures propagate so Cloud Scheduler retries with bounded exponential backoff. Do not catch and acknowledge a failed collection or write.
- Aggregate logs may include the snapshot date and aggregate totals. Do not add identifiers or raw authentication timestamps to logs.
- A change to a metric definition or persisted shape requires a new metric-definition or schema version, compatible read behavior, documentation, and tests. Never reinterpret older points silently.
- If a daily snapshot is missing, leave the gap visible. There is no operator backfill function, and version 1 plan history must not be inferred.
- Verify changes with the focused Functions specs, frontend service/helper/component specs, the Functions build, the frontend build, and `npm run test:rules`.

Production rollout is separate from implementation. The reviewed release order is Firestore indexes/TTL and Rules, then Functions, then Hosting; use the repository's normal approved deployment process.
