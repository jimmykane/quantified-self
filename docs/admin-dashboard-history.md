# Admin dashboard user history

The Admin Dashboard keeps one aggregate user-metrics snapshot per UTC day so operators can see changes in account activity, plan mix, and paid subscription cadence without adding a product analytics SDK or retaining per-user activity history.

## Metric definitions

The daily snapshot reuses the same server-side collector as the live User KPIs. This keeps the current cards and historical charts aligned at collection time.

| Group | Stored metric | Definition |
| --- | --- | --- |
| Users | Total, Free, Basic, Pro | Current user-document total and one latest canonical active-plan classification per Stripe customer |
| Users | Onboarding complete | User documents whose onboarding flag is complete |
| Authentication activity | Eligible accounts | Enabled Firebase Auth accounts without the admin custom claim |
| Authentication activity | Eligible Free / Basic / Pro accounts | Enabled, non-admin Auth accounts joined to the same canonical plan map as activity, including inactive accounts and accounts without an authentication timestamp |
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

- schema and metric-definition version `3`;
- the UTC snapshot date, scheduled time, actual computation time, and TTL expiry;
- the aggregate user, authentication-window, and subscription-cadence counts listed above.

The document is rejected before writing unless all counts are non-negative safe integers and these invariants hold:

- Free + Basic + Pro equals total users;
- onboarding complete does not exceed total users;
- active 24h ≤ active 7d ≤ active 30d ≤ eligible accounts;
- for every rolling window, active Free + Basic + Pro equals that window's active total;
- each plan's active 24h ≤ active 7d ≤ active 30d, and active paid counts do not exceed their current paid-plan totals;
- eligible Free + Basic + Pro equals eligible accounts, each plan's active 30-day count does not exceed its eligible count, and eligible paid accounts do not exceed that paid-plan total;
- each tier's monthly + yearly + unknown cadence equals that tier's active total.

Snapshots do not contain UIDs, email addresses, provider lists, raw authentication timestamps, activity events, screen views, analytics identifiers, or heartbeat records. Version 2 introduced active-plan history. Version 3 adds `authActivity.eligibleByPlan` so activity rates use matching enabled, non-admin populations rather than all user-document plan totals. There is no synthetic backfill for older snapshots.

## Retention and access

Each snapshot receives an `expireAt` value 730 days after computation. The `adminDashboardSnapshots.expireAt` override in `firestore.indexes.json` enables Firestore TTL and disables unnecessary single-field indexing for the TTL field. TTL deletion is asynchronous, so 730 days is the intended retention boundary rather than an exact deletion instant.

Firestore Rules deny every direct client read and write to this collection, including admin clients. `getAdminDashboardHistory` is the only application read path. It uses the shared admin callable guard, including authentication, admin-claim, and App Check enforcement, and returns aggregates only. Server SDK scheduler writes bypass client rules as intended.

TTL configuration is infrastructure state. Local emulator startup and Functions deployment do not enable the production TTL policy; deploy the reviewed Firestore index configuration separately through the normal release workflow.

## History API and dashboard behavior

`getAdminDashboardHistory` accepts only `30`, `90`, or `365` days and defaults to `90` when the caller omits the range. It queries date-keyed documents inside the requested inclusive UTC interval, discards malformed or incompatible-version documents, and returns valid points oldest first. The reader accepts matching schema/metric-definition versions 1, 2, and 3. Version 1 points return a `null` active-plan breakdown. Versions 1 and 2 return `null` eligible-plan totals. Their existing counts remain available without reinterpreting old data; malformed version 3 denominators are rejected on read and write.

The Admin Dashboard requests 365 days once per refresh and switches among 30-, 90-, and 365-day views locally. A **Count / Percentage** selector applies to five independent, unstacked line charts, with Count as the initial view:

1. **Authentication activity:** rolling 24-hour, 7-day, and 30-day counts divided by that day's eligible accounts. These windows overlap and are never stacked.
2. **Active users by plan:** Free, Basic, and Pro in the selected rolling window. **Within each plan** divides each plan's active count by its eligible accounts; **Share of active users** divides by all active accounts in that same window. The basis also controls percentages in count-mode tooltips.
3. **User and plan mix:** Free, Basic, and Pro counts divided by total user documents.
4. **Onboarding completion:** completed onboarding divided by total users, shown separately because it overlaps the plan categories.
5. **Paid subscription cadence:** monthly, yearly, and unknown counts divided by the corresponding Basic or Pro total, including unknown cadence. Unknown series appear only when present in the selected range. The chart retains daily trajectories so changes can be compared over time.

Every tooltip includes the count, percentage (up to one decimal), and explicit population. Missing or zero denominators produce unavailable percentages, never invented zero rates. Chart values retain calculation precision. Hiding a series changes the visible scale and tooltip rows only; it never changes denominators. **Auto** fits the visible series with percentage bounds inside 0–100; **From zero** uses a zero count baseline, and becomes **0–100%** in percentage mode.

Admin-only help lives beside the display controls and in each chart description. The public help page covers member features.

Missing capture days between the first and last observed point remain `null` chart gaps. The UI does not invent zeroes or interpolate them. Leading or trailing absent days are not plotted. A separate status reports the number of internal gaps and marks history stale when the newest snapshot computation is more than 36 hours old.

The charts need eight snapshots in the selected range before rendering. The active-plan count and active-share views need eight version 2 or 3 snapshots with a valid plan breakdown. The within-plan percentage view needs eight version 3 snapshots with eligible-plan totals. Older snapshots remain visible in supported views and become gaps where denominators are unavailable; the collection message offers Count or Share of active users as alternatives. Before then, the dashboard shows plan-history collection progress. This is expected immediately after release and is not an error.

Historical loading and failures are isolated from the live User KPI request. A callable or validation failure shows “Daily user history is unavailable” without removing the current cards; similarly, a live KPI failure does not erase already available historical results.

## Operations and changes

- Scheduler failures propagate so Cloud Scheduler retries with bounded exponential backoff. Do not catch and acknowledge a failed collection or write.
- Aggregate logs may include the snapshot date and aggregate totals. Do not add identifiers or raw authentication timestamps to logs.
- A change to a metric definition or persisted shape requires a new metric-definition or schema version, compatible read behavior, documentation, and tests. Never reinterpret older points silently.
- If a daily snapshot is missing, leave the gap visible. There is no operator backfill function, and version 1 plan history must not be inferred.
- Verify changes with the focused Functions specs, frontend service/helper/component specs, the Functions build, the frontend build, and `npm run test:rules`.

Production rollout is separate from implementation. The reviewed release order is Firestore indexes/TTL and Rules, then Functions, then Hosting; use the repository's normal approved deployment process.

For the percentage-view change, deploy only the updated existing `scheduleAdminDashboardSnapshot` and `getAdminDashboardHistory` functions before Hosting. No new endpoint, Firestore index, TTL policy, or Rules change is required. The eligible-plan totals reuse the existing privileged Auth pagination and subscription-owner join; no extra reads or user identifiers are stored. Within-plan rate history starts accumulating after that release and requires eight daily captures before its chart is shown.

Manual production rollout commands, requiring separate deployment approval:

```bash
firebase deploy --project quantified-self-io --only functions:scheduleAdminDashboardSnapshot,functions:getAdminDashboardHistory
npm run build-production
firebase deploy --project quantified-self-io --only hosting:production
```
