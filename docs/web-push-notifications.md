# Browser notifications

## Product boundary

Settings → Notifications supports explicit device opt-in, disable, and a self-test for every signed-in account. A separately gated, explicit per-import option can notify the initiating device when a manually started Suunto, COROS or Wahoo activity-history import ends. A separate New activities synced category groups recent live-provider imports. Activity delivery covers opted-in manual send results and grouped automatic-send failures. Training, billing, marketing and reminder categories are not implemented. There is no notification inbox or subscription list; live-activity and delivery alerts use separate bounded private pending batches and minute schedulers. Browser permission alone is not account consent. Managed impersonation sessions cannot register devices or send tests.

Production and beta share Firebase and one VAPID key pair. Registrations retain their exact origin; permission must be granted on each site/device. Self-tests target only the current installation and click through to that site's `/settings?section=notifications`. Automatic senders call `isAutomaticPushOrigin`, which admits production only. Do not add a preferred-site setting or infer shared device identity across origins.

## Data flow and ownership

The browser obtains a subscription through `window.pushManager` when available, otherwise Angular's existing root worker. The browser writes a private leaf at `users/{uid}/pushSubscriptions/{installationId}` with schema version, origin, public signing-key version, random generation, endpoint, encryption keys and server timestamp. Firestore Rules permit direct owner CRUD, prohibit listing/descendants and impersonated writes, validate supported endpoints and fence deleted/missing accounts. Subscription endpoints and encryption material are capability credentials: never log or publish them.

Endpoint validation is shared by browser/server code and mirrored in Rules: Google FCM, Mozilla Push, Apple Web Push, and a single DNS label under `notify.windows.com` for Edge's Windows Push Notification Service (WNS). HTTPS, hostname boundaries and the absence of credentials, custom ports and fragments remain mandatory. [Microsoft documents Edge's WNS transport](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/forcebuiltinpushmessagingclient) and [its service domain](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/firewall-allowlist-config). WNS requests retain Web Push encryption/VAPID and add the [raw notification type and 60-second WNS expiry headers](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-request-response-headers); `web-push` supplies the encrypted binary content type.

The `sendTestPushNotification` App-Check callable accepts only an installation UUID. It derives UID from Auth, validates caller/stored origins and endpoint, transactionally reserves one of ten UTC-day tests with a one-minute cooldown, then checks current configuration and deletion/registration state again before sending. Rate state is server-only at `users/{uid}/pushState/testRateLimit`. All state falls under the existing recursive user-root deletion; no top-level feature collection or TTL policy is added. Rates count attempts, including configuration/network failures.

The fixed payload contains `web_push: 8030`, title/body, `icon`, `navigate`, and Angular's `onActionClick` fallback. The icon is an absolute URL to the existing 192×192 QS app PNG at `/assets/favicons/android-chrome-192x192.png` on the registration's own origin. Both declarative delivery and Angular's worker receive the same icon. The browser/OS controls its presentation: [Safari on macOS uses the Safari icon for browser notifications and the installed app icon for Add to Dock web apps](https://developer.apple.com/videos/play/wwdc2023/10120/). No extra push or click listener displays a second notification. The payload expires after 60 seconds. The sender times out after five seconds, never follows redirects and never retries self-tests in the background. HTTP 404/410 removes only the matching registration generation. Other errors retain the registration and return a generic error; acceptance does not prove display or reading.

Explicit sign-out and managed account-token switching run bounded device cleanup before Auth changes. Other owner changes revoke the browser subscription and require a fresh account opt-in. Offline cleanup cannot recall already accepted notifications; only generic text is sent. A failed owner-document removal may leave an inert registration until account cleanup or an expired-send response removes it. Browser startup, focus and subscription-change observations reconcile retained device state without requesting permission.

Every startup observer waits for the first authoritative Auth result before touching retained consent. Signed-out cleanup discovers the actual browser manager and keeps the local cleanup marker if revocation fails. On iPhone/iPad browser tabs, Home Screen guidance precedes push API checks because those APIs may be hidden until installation. Background reconciliation updates endpoint/encryption-key changes only for a valid existing registration; it uses an update-only write so removal between read and write cannot recreate consent. A newer same-account refresh does not unsubscribe a valid pending rotation.

Each refresh retains its own browser subscription snapshot across asynchronous reads, so an older lookup cannot replace a newer endpoint. Cleanup captures the account, installation and observation before awaiting browser operations; late completion cannot remove replacement consent or overwrite the new account's state. This includes cleanup still running after the two-second Auth wait. Self-tests reconcile current browser/server state after every outcome. An expired response describes the attempted generation and does not authorize revoking a replacement that the server preserved.

Chrome FCM endpoint tokens may contain a colon in the path, including under `/fcm/send/` and `/wp/`. Preserve the endpoint exactly as returned by the browser; do not strip or encode token characters to bypass validation. Browser, sender and Rules regression tests cover these synthetic token shapes and reject credentials, ports, lookalike hosts and fragments. Validator changes must ship in the frontend, `sendTestPushNotification` and Firestore Rules together; updating only one layer leaves registration or sending blocked.

## Configuration and release

Defaults are disabled. Provisioning, publishing Remote Config, applying monitoring and deployment each require separate authorization. This PR does not perform them.

1. Generate a Web Push VAPID key pair using the installed `web-push` library in an explicitly selected external local configuration directory. Store local material only under `~/.config/quantified-self/` or an approved external override, with restrictive permissions. Never put key values in shell arguments, logs, tickets, fixtures or a checkout. The value-free secret template names `WEB_PUSH_VAPID_KEYPAIR`.
2. An authorized operator sets `WEB_PUSH_VAPID_KEYPAIR` interactively with `npm run firebase -- functions:secrets:set WEB_PUSH_VAPID_KEYPAIR --project quantified-self-io`. The value is JSON with `publicKey` and `privateKey`; `sendTestPushNotification` and `sendHistoryImportNotification` bind it. The matching public key is safe to distribute.
3. Add unconditional, top-level Remote Config parameters `web_push_enabled=false` and `web_push_vapid_public_key=<matching public key>`. Do not use targeting conditions or parameter groups for these two keys: server admission reads the same default parameters. Frontend cached configuration can lag; server admission fails closed against the current template. Grant the Function runtime identity Remote Config template read access if its existing permissions do not provide it.
4. Under separate deployment approval, deploy Rules and `sendTestPushNotification`, then the frontend. Exact selective backend command: `npm run firebase -- deploy --only firestore:rules,functions:sendTestPushNotification --project quantified-self-io`. Frontend release uses the normal reviewed hosting workflow. Never deploy unrelated Functions or alter existing queues as part of activation.
5. Review and apply the monitoring bundle below with the existing verified operational email channel. Publish the shared enabled flag only when the matching server secret, Rules, frontend, monitoring and device checks are ready. An explicitly enabled authorized test window may be needed for real-device verification; production-wide activation follows its results. Beta is optional and uses these same keys and flag.

A standard development Angular build has no service worker. Offline unit tests mock both browser managers, Remote Config and transport; backend emulator tests must use an explicit demo project and external development keys. Localhost origins are rejected by deployed admission and Rules. Do not connect local tests to real push destinations or production data merely to exercise the button.

For key rotation, provision the new matching pair and public parameter together with authorized redeployment, keeping the enabled flag off during transition. Existing registrations with a different public key must be disabled and explicitly re-enabled; no silent migration or permission prompt. Do not delete the old cloud secret/version without separate approval.

## Notification categories

Settings → Notifications exposes the shared category registry in `shared/notification-categories.ts`. The
categories are `history_import` (History imports), `activity_sync` (New activities synced), and `activity_delivery` (Activity delivery). **New categories default on**, including for existing accounts,
without a migration or an initialization write. Category preferences are account-wide across devices and sites;
origin-specific device registration, browser permission, operational switches and each sender's consent still apply.
An enabled category still requires an enabled production device and operational sender switches. It never checks a history-import checkbox. Self-tests bypass categories.

An owner-scoped private leaf at `users/{uid}/notificationPreferences/{category}` stores `schemaVersion: 1`,
`enabled`, a monotonically increasing integer `revision`, and server `updatedAt`. A missing document means
on/revision zero; read failures and malformed records do not mean a missing preference. Rules allow known-category
owner get/create/update, prohibit impersonated writes, listing, descendants and deletion/reset, and fence missing or
deleting accounts. Changes use client transactions rather than a new callable. Each actual toggle increments the
revision; listener hydration, unchanged selections and retries after another device already saved the value do not.
Preferences remain under the existing recursive account cleanup and are not MCP, metric or public profile data.

Admission reads the category transactionally and binds the server revision to private import consent or an activity batch.
The sender checks that the category remains on at that same revision both before claiming and immediately before
sending. Switching it off cancels outstanding consent; switching it back on does not revive earlier runs, including
imports that were still processing when the preference changed. Already accepted/in-flight pushes may still arrive.
The frontend waits for server-confirmed preferences, synchronizes other-device changes, preserves the last confirmed
values during read failures and same-account reloads, preserves saved values on write failure, and discards stale
account callbacks. Read errors and reloads block new consent and editing until every category is confirmed again.
The import form links to category/device settings if unavailable.

To add a category, extend the shared registry and Rules allowlist together, then implement and test that sender's
consent, revision checks, deduplication, account-wide budget and generic payload. New categories inherit the on
default, not another sender's per-event consent. Do not expose placeholder switches for unimplemented senders.

## Manual history import completion

The first automatic notification is an explicit, one-time choice on a **manual activity-history import** for Suunto, COROS or Wahoo. The checkbox starts unchecked. If device registration is needed, a separate button invokes the existing permission flow directly from its click; successful registration does not check the import option. No permission prompt appears during page load, hydration or completion. A pending registration lookup stays bound to the starting account, view and provider connection generation; replacing or removing that connection cancels submission and clears the import choice, while an ordinary metadata refresh keeps it valid. Garmin is excluded because its completed coordinator records requested history, not correlated ingestion. OAuth recent-history imports, Sleep, Health and routes are excluded.

The existing three admission callables accept optional `notification: { installationId, generation }` only with `background: true`. Auth, App Check, Pro, date/range and existing connection checks remain in force. Origin comes from the HTTP request; impersonated requests and non-production origins are rejected. The admission transaction validates the current owner's registration, exact generation, origin, public key and enabled category, and stores that consent with its server category revision on the private run. No endpoint, key or consent is added to the public progress projection. Unchecked imports retain their existing request and admission behavior, without fetching push configuration.

`sendHistoryImportNotification` observes `connectionHistoryImports/{runId}` writes. Only a transition from active to terminal on a consented custom activity-only run enters delivery. The existing coordinator already waits for committed child outcomes and retryable work; this change adds no child notifications and changes no provider queues, retry policy or canonical ingestion. A completed scan with failures says **finished with issues**; a terminal stop before the scan/children finished says **needs attention**. It never calls a stopped run successful. An explicit owner retry after a send attempt does not create a second alert.

The sender re-reads the exact revision, live user/deletion guard, current connection generation and latest inactive projection, and the consented registration. It rejects results older than 24 hours, superseded runs, revoked/rotated registrations and changed connections. It repeats lifecycle checks after claiming and before external I/O. A change after the final check or a push already accepted by the browser service cannot be recalled. A registration generation change, including a subscription refresh, conservatively cancels the old consent; it is not transferred silently.

Anti-spam state is a server-only leaf at `users/{uid}/pushState/historyCompletion`: at most two attempt timestamps in a rolling 24-hour window and one receipt per supported provider (maximum three). A transaction reserves the attempt **before** sending. Concurrent/repeated events, explicit retries of the same run and older runs cannot pass the provider receipt watermark. A capped result also receives a suppression receipt, so it cannot send when the cap later expires. The rate is per account across providers, independent of the existing self-test rate; cancelled/failed attempts consume it. This bounded state uses existing browser-deny Rules and recursive user cleanup, with no new TTL, index or collection scan.

Delivery is **best-effort, at most one attempt per import**, not exactly once. A crash after the durable claim, an ambiguous network result or failed bookkeeping must not initiate another send. Platform retries can recover preparation failures before a claim; a claim prevents replay afterward. This deliberately prefers a missed alert over duplicates. Connections remains the authoritative progress/result surface. Turning the switch off discards newly observed completions; turning it back on does not scan or replay them.

The generic standard/declarative payload contains no activity count, title or health data. It opens `/services?serviceName=<provider>&tool=history`, the existing history-results dialog, with the QS icon. Delivery uses low urgency, a one-hour TTL (including WNS), topic/tag `qs-history-import` and `renotify: false`. The tag may replace an older visible import alert, but receipts and rate limits provide business-level duplicate prevention. There is no quiet-hours preference in this first explicit one-off feature; low urgency is not a guarantee of OS silence. Acceptance is not proof of display or reading.

### Release and rollback

This feature defaults off through a **new**, unconditional top-level Remote Config switch, `web_push_history_import_enabled=false`. Both this and `web_push_enabled` must be true, with the matching `web_push_vapid_public_key`. Do not change the existing foundation flag/key merely to prepare this feature. Missing/conditional settings fail closed on the server; cached frontend configuration may lag and display an option the server now rejects. The user can uncheck it and import normally. Beta remains self-test-only; automatic consent and delivery are production-origin-only.

After separate approval, deploy the category Rules, existing admission callables and new isolated sender before releasing the frontend:

```sh
npm run firebase -- deploy --only firestore:rules,functions:addSuuntoAppHistoryToQueue,functions:addCOROSAPIHistoryToQueue,functions:addWahooAPIHistoryToQueue,functions:sendHistoryImportNotification --project quantified-self-io
```

The history-only subset requires the Rules deployment above. It needs no key rotation, ingestion-worker deployment, schedule or queue change. Releasing the full PR also requires the live-activity deployment below. The existing shared key is bound to the two automatic senders and the self-test sender; admission workers never receive it. Apply/read back the extended monitoring bundle with the existing alert channel before enabling the new switch. A production test window and test sends need separate authorization; there is no client-targeted or beta bypass. Rollout and monitoring activation/readback are tracked in [#1011](https://github.com/jimmykane/quantified-self/issues/1011).

Rollback of new admissions/sends is the new switch set to false; existing imports continue normally. Already claimed/accepted sends may finish. Never clear receipts or replay completed runs. The trigger uses 256 MiB, 30 seconds, max two instances, concurrency 20 and zero minimum instances in `europe-west2`; no idle warm instance or new scheduler is provisioned. Once deployed it is invoked on history-document writes even while disabled, then filters unrelated checkpoints in memory. Consented completion handling adds bounded configuration/Firestore reads, transactional claim/bookkeeping writes and one push request at most. This has incremental invocation/read/write costs; it is not a free or guaranteed-delivery service.

## Recent live-activity sync notifications

`activity_sync` defaults on as an account preference, independently of `history_import`. Sending additionally requires
both unconditional Remote Config defaults `web_push_enabled=true` and **`web_push_activity_sync_enabled=true`**,
plus the matching public key. The new sender defaults off when its parameter is absent; prepare it as false. No new
signing key, permission prompt, paid service or client-targeted rollout is introduced. Existing production device
registrations are eligible. Beta registrations remain self-test-only.

Eligibility is proven after successful canonical event, child, metadata and original-file persistence:

- `setEvent().created` reflects the committed parent-creation transaction. Existing events, corrections, reprocessing,
  manual QS uploads, verified cross-provider copies and outbound echoes do not enter notification admission. Failed
  or partial writes produce no alert; a subsequent successful repair of an existing parent conservatively stays silent.
- Only authenticated provider webhook creation stamps `activityNotificationOrigin: live`. Legacy/unknown queue work,
  `fromHistory`, coordinator run IDs, manual/edited provider entries and suppression markers are excluded. A missing
  history flag does not establish a live source. Suunto's shared enqueue helper requires the webhook to supply this
  marker explicitly; outage-recovery backfills remain silent. Normal queue revisions, leases and retries remain unchanged.
- The parsed workout must have finished within 48 hours, not in the future, and begun after the current connection.
  Admission uses token creation time for existing connections; new/reconnected accounts also have the server-owned
  `activityNotificationConnectedAtMs` lifecycle marker. Missing/invalid connection identity or time fails closed.
- Garmin history callbacks share its live endpoint. Before any history request, the existing lease transaction raises
  `activityNotificationHistoryEndMs` to the requested range end. Admission and sending also check the existing
  automatic-delivery cutoff and latest history projection end. Bounds never move backwards, including on partial
  request failure. This intentionally can suppress genuine new Garmin workouts through a requested future/end-of-day
  bound; it cannot mislabel those history callbacks as new workouts.
- Admission and sending recheck the exact queue date/revision, provider account, connection generation, event dates
  and existence, account deletion guard, preference revision and production registration generations. These are masked
  metadata reads; no metrics, streams or full sports models are hydrated to prepare a notification.

One private leaf, `users/{uid}/pushState/activitySync`, holds at most one pending batch, four attempt timestamps,
256 event-ID suppression receipts and one claim ID. Receipts expire logically 48 hours after workout completion and
are pruned on new admission. Recreating the same canonical event during this period does not notify again. At the
receipt limit, further arrivals are silently omitted until space becomes available. This bounded state is denied to
clients by existing Rules and removed by existing recursive account cleanup; no TTL policy is needed.

The first eligible arrival fixes a two-minute batching deadline and snapshots at most ten registered production
devices. Later arrivals do not extend that deadline or add newly enabled devices. The batch holds at most 50 unique
workouts; excess arrivals are suppressed. The minute scheduler normally sends after roughly two to three minutes.
One workout opens `/user/<uid>/event/<eventId>`; multiple workouts open `/activities`. The payload exposes only a generic
message/count, no workout names or metrics, using the shared QS icon, declarative `web_push: 8030`, Angular click
fallback, low urgency, fixed topic/tag `qs-activity-sync`, `renotify: false`, five-second transport timeout and ten-minute
push TTL (including WNS). A browser may replace a previous visible alert with the same tag.

There is at most **one batch attempt per 15 minutes and four per rolling 24 hours per account across providers**.
These limits are separate from history-completion and self-test budgets. Cooldown/capped arrivals are skipped,
never queued for a later digest. Turning the category off and back on changes its revision and cancels all earlier
pending entries; a new sync can create a fresh batch. Device disable/rotation, disconnect/reconnect and deletion
are rechecked before transport. Already accepted or in-flight pushes cannot be recalled.

`sendActivitySyncNotifications` reads at most 25 due leaves per minute through the `pushState.dueAt` collection-group
index, processes five accounts at a time and at most five devices concurrently per account. Each batch is atomically
removed and its rate slot claimed before transport. Concurrent schedules, lost commit acknowledgements, crashes and
ambiguous send failures cannot replay a claimed batch. Preparation failures before claim can be retried by a later
sweep. Batches more than ten minutes overdue are discarded. A disabled sender clears due batches without sending;
leaving it disabled beyond this expiry before re-enabling also expires any retained work after an outage. There is
no notification dead-letter queue or manual replay feature. Only an expired matching registration is pruned.
Device preparation or expired-registration cleanup failures do not stop the remaining devices: every wave settles
before the sweep reports failure. Failed device work is not replayed after the batch has been claimed.
Multiple installation records sharing one browser push endpoint receive at most one attempt per batch, including
after an ambiguous transport failure. Endpoint deduplication stays in memory; endpoints are never logged or copied
into the private batch state.

Admission failure logs a fixed error and never fails/retries an otherwise successful activity import. A crash after
persistence but before admission may miss an alert. This is best-effort delivery, not an exactly-once guarantee.
Quiet-hours preferences and an app-open suppression policy are not included; OS Focus settings still control display.

### Activity rollout and rollback

Keep `web_push_activity_sync_enabled=false` and the independent history sender switch false while preparing the
backend. Preserve the existing foundation flag and VAPID key. After separate approval, deploy Rules/indexes and wait
for the collection-group index to be ready, then deploy the changed callback, OAuth/history, import-worker and sender
entrypoints. The combined backend command for this PR is:

```sh
npm run firebase -- deploy --only firestore:rules,firestore:indexes --project quantified-self-io
npm run firebase -- deploy --only functions:sendActivitySyncNotifications,functions:sendHistoryImportNotification,functions:addSuuntoAppHistoryToQueue,functions:addCOROSAPIHistoryToQueue,functions:addWahooAPIHistoryToQueue,functions:insertSuuntoAppActivityToQueue,functions:insertCOROSAPIWorkoutDataToQueue,functions:insertGarminAPIActivityFileToQueue,functions:wahooAPIWebhook,functions:processWorkoutTask,functions:parseSuuntoAppActivityQueue,functions:parseCOROSAPIWorkoutQueue,functions:parseGarminAPIActivityQueue,functions:parseWahooAPIWorkoutQueue,functions:requestAndSetSuuntoAPIAccessToken,functions:requestAndSetCOROSAPIAccessToken,functions:requestAndSetGarminAPIAccessToken,functions:requestAndSetWahooAPIAccessToken,functions:backfillGarminAPIActivities,functions:processConnectionHistoryTask --project quantified-self-io
```

Verify the deployed scheduler is once per minute in UTC, `europe-west2`, 256 MiB, timeout 120 seconds, concurrency one,
maximum one instance, zero minimum instances and no Scheduler retries. Verify the existing VAPID binding is limited
to the three senders. Apply/read back the expanded existing monitoring bundle and its initial heartbeat series, then
release the frontend to beta for category/permission UI checks. Actual automatic delivery remains production-only.
An explicitly authorized short production window should verify a new recorded workout, grouped arrivals, separate
history exclusion, off/on cancellation, click routing and real OS display before broader activation. All default-on
accounts with enabled production devices become eligible when the shared activity flag turns on; this is not a
single-user targeted switch. [#1011](https://github.com/jimmykane/quantified-self/issues/1011) tracks activation/readback.

Rollback is the activity sender flag false; imports continue normally and due batches are discarded. Claimed pushes
may finish. Do not clear receipts, replay old imports or revert just the Garmin cutoff writers while leaving activity
sending enabled. The scheduler has no warm instance but adds minute invocations, bounded Firestore/configuration
reads, batch/claim writes and push requests; Cloud Scheduler and logging/monitoring also have normal usage costs.
There is no per-notification charge added by QS or another messaging vendor, and no claim that infrastructure is free.

## Verification

Automated coverage includes browser and SSR states, owner changes during pending registration, denied permissions, missing configuration, key rotation, both push managers, fixed payload/navigation, server admission, concurrency/rate limits, expired-generation races, private Rules and deletion guards. History coverage additionally exercises atomic consent admission, provider boundaries, actual Firestore contention, cap enforcement across providers, aborted claims, deletion/revocation, stale completions, category defaults, off/on cancellation, private preferences and private receipts. Run focused frontend/Functions tests, Rules tests, production build, secret and entrypoint checks, frontend policy checks and monitoring tests.

Before claiming device compatibility, verify physical iPhone/iPad Home Screen, Safari on macOS, Android Chrome, desktop Firefox and Edge on Windows. Test app foreground/closed, click return through login, permission revoke, disable/sign-out, beta versus production navigation, one notification per test, and declarative delivery with worker execution unavailable on an authorized test origin. Do not unregister a production worker or send tests without the applicable authorization. OS focus modes and notification settings affect delivery. Device verification is not established by unit tests or Chrome's synthetic push tool.

## Activity delivery notifications

`activity_delivery` defaults on as an account preference, but transport additionally requires the unconditional
`web_push_enabled` and **`web_push_activity_delivery_enabled`** switches, a matching public key, and production device
registration. Missing or conditional sender configuration fails closed. Keep the new switch false during preparation.
This category concerns recorded activities sent **from QS to providers**, not imports, planned workouts or routes.

### Manual sends

The Send activities review offers **Enable notifications on this device**, then an unchecked **Notify me when this
send finishes** checkbox beside Send. Permission is requested only from that button gesture. Enabling permission or
turning on the category never selects batch consent automatically. A blocked/unsupported device or unavailable sender
never prevents an unchecked send. Category-off links/actions use the existing owner-scoped preference transaction.
Owner, provider, source, draft revision and permission changes fence a pending device lookup; an unavailable choice
can still be unchecked. Completed sends show only that a notification was requested, not a delivery guarantee.

Confirmation optionally accepts exactly `{ installationId, generation }`. The existing callable validates production
Origin, own-account (no impersonation), configuration, current registration/key, category revision and destination
account/generation transactionally with confirmation. Consent stays in private `activitySendOperations`; the public
batch exposes only `notificationRequested: true`. No new CRUD callable or provider action is introduced.

`queueActivitySendNotification` observes `users/{uid}/activitySends/{batchId}`. Only an opted-in non-stopped transition
to complete enters admission; retries re-read the current batch, private operation and a one-row masked issue query.
The result says **finished** or **needs attention**, never that all recordings were delivered merely because processing
ended. Twenty files produce at most one result for their batch. The initiating device is the only target. One result
opens its exact Send activities batch; grouped manual results open Recent sends. Stop cancels pending notification work.
An explicit retry of the same batch does not create another notification after admission/attempt.

The existing `projectActivitySendDelivery` also handles queue deletion backed by an exact matching committed
`failed_jobs` record. Previously an unaccepted exhausted upload could leave its batch unfinished; it now projects
Needs action exactly once. Replaced queues, wrong ownership/revision, account deletion and ordinary cleanup deletions
cannot publish a failure. Provider retry budgets, queue transitions and uploads are unchanged.

### Automatic sending

`queueAutomaticDeliveryNotification` observes `failed_jobs/{jobId}` writes and admits only automatic activity-sync
dead letters. Manual/historical sends, unrelated queues, successful delivery and intermediate retries stay silent.
This deliberately starts with committed terminal failures, not routine successes or every temporary connection wait.
The alert says **needs attention**, including uncertain provider acceptance; it never claims a resend is safe.
It opens the destination in Connections (or Connections overview for a group). Current queue state, exact failure
revision/time, retained event existence, destination account/generation and deletion guard are rechecked before sending.
A retry, successful recovery or reconnect can invalidate queued work. Existing provider delivery status/monitoring
remains authoritative; this adds no provider API calls or automatic resends.

### Grouping, limits and delivery

A server-only leaf `users/{uid}/pushState/activityDelivery` holds one pending batch, at most 50 results, ten device
references, four attempt timestamps and 256 suppression receipts. Manual batch receipts expire logically after 30 days; automatic
failure receipts expire with their 24-hour source eligibility, so old failure bursts cannot fill the state for a month. No endpoints,
metrics, titles, filenames or raw errors enter this state or telemetry. The first result fixes a two-minute window;
the UTC minute scheduler sends after roughly two to three minutes. Per-result targets preserve initiating-device
consent when manual results share a window with automatic failures. Browser endpoint aliases receive at most one push.
There is at most **one delivery batch attempt per 15 minutes and four per rolling 24 hours per account**, independently
of import/live-sync/test budgets. Capped or overflow results are suppressed permanently, not queued for a later digest.

Admission snapshots category and device generations. Off/on, sign-out, replacement registration, key change, stopped
or retried source, connection change and deletion cancel stale work. Claims clear pending state before network I/O;
ambiguous sends/crashes are never replayed. A failed device cannot strand other devices. 404/410 removes only the exact
expired registration generation. Pending batches expire ten minutes after becoming due; results older than 24 hours
cannot enter delivery. The scheduler reads at most 25 due users and processes five at a time, with five device sends
at a time per user. It uses `deliveryDueAt`, separately indexed from activity-sync `dueAt`, to avoid either queue
starving the other. This private leaf participates in existing recursive account cleanup; no new TTL policy is needed.

The shared standard/declarative payload includes the QS icon, worker click fallback, fixed tag/topic
`qs-activity-delivery`, low urgency, `renotify: false`, ten-minute TTL and five-second timeout. Push acceptance is not
proof of display. Rate caps and OS settings can prevent a requested notification; results remain in the app.

### Delivery rollout and rollback

After separate deployment approval, with the new sender switch **false**:

```sh
npm run firebase -- deploy --only firestore:rules,firestore:indexes
# Wait for pushState.deliveryDueAt's collection-group index to become ready.
npm run firebase -- deploy --only functions:activitySendCommand,functions:projectActivitySendDelivery,functions:queueActivitySendNotification,functions:queueAutomaticDeliveryNotification,functions:sendActivityDeliveryNotifications
```

Both admission triggers use 256 MiB, 60 seconds, retry enabled, concurrency ten, max two and min zero in europe-west2;
neither binds a signing secret. The delivery scheduler uses 256 MiB, 120 seconds, concurrency/max one, min zero,
zero Scheduler retries and the existing `WEB_PUSH_VAPID_KEYPAIR`. Isolated loading/resource checks cover all three.
Release the verified frontend through the existing separately authorized workflow. Beta remains self-test-only.
Apply/read back the existing monitoring bundle on its existing channel before enabling the delivery switch and
checking an authorized production batch. Rollback sets only `web_push_activity_delivery_enabled=false`; it does not
stop uploads, clear receipts or replay results. Already claimed/accepted pushes may finish.

Monitoring implementation is **covered** by delivery-specific fixed outcomes, native 5xx for all three notification
functions, bounded overdue observations and idle/disabled heartbeat absence. Provider retry/backlog/dead-letter
coverage in the activity-delivery bundle is **unchanged** because provider operations are unchanged. Live activation
and readback remain **deferred to [#1011](https://github.com/jimmykane/quantified-self/issues/1011)**. Offline tests are
not live monitoring proof. There is incremental scheduler, invocation, bounded Firestore read/write and transport
cost; one batch uses one push per distinct eligible browser endpoint, not one per uploaded file.

No Training planning or MCP tool, consent, metric or response surface changes. The existing private send command is
not an MCP mutation; notification consent never authorizes provider activity sending without its existing Send action.

## Monitoring

Source-controlled coverage uses the shared `tools/monitoring/` provisioning framework. Preview without credentials:

```sh
node tools/web-push-monitoring/cli.mjs --project=quantified-self-io
```

An authorized operator applies the exact owned bundle with:

```sh
node tools/web-push-monitoring/cli.mjs --project=quantified-self-io --notification-channel=projects/quantified-self-io/notificationChannels/CHANNEL_ID --apply --confirm-project=quantified-self-io
```

The bundle retains the self-test metric/policy and adds `sendhistoryimportnotification`, both restricted to `europe-west2`. Each charts fixed outcomes and native requests and alerts on three genuine failures in fifteen minutes. Category opt-outs and revision changes use the existing suppression/cancelled paths and do not add an alert or label. History also alerts on native 5xx to cover failures before outcome logging; its fixed cancelled/limited categories never page. The existing owned dashboard is updated, not duplicated. Permission denial, rate limits, disabled configuration and expired registrations do not page. User-requested traffic has no heartbeat; idle/missing outcomes do not assert health and do not page. History completion has no notification outbox or dead-letter queue; its backlog remains the existing coordinator backlog. Existing connection-history monitoring remains authoritative for import backlog, failed processing and terminal runs. A sender claim with an uncertain outcome is intentionally not repaired or replayed. Reapplication preserves unrelated resources through shared ownership checks. Thresholds should be reviewed after observed traffic.

For a failure, check enabled/default parameters, matching signing keys, runtime permissions and fixed outcomes. Never copy endpoints, payloads, key material, identifiers or raw HTTP responses to incident artifacts. Do not blindly resend or change rate state. Source definitions are prepared; live activation/readback must be tracked separately and is not implied by passing tests.

The activity sender adds three versioned metrics and one policy to the same owned bundle: fixed outcomes/phase
(including admission failures in existing Gen 1/Gen 2 import workers), completed-sweep heartbeat, and positive oldest-due
observations at least three minutes overdue. It alerts on three real admission/send/preparation failures or native 5xx
in 15 minutes, two overdue observations in five minutes, or no completed sweep for 15 minutes. Disabled and idle sweeps
emit heartbeats; failures report unknown health, never healthy zero. The post-sweep probe reads only the oldest due
field. Verify an initial heartbeat metric series during activation: absence policies cannot detect a never-seen series.
Expected histories, duplicates, category/lifecycle skips, rate caps and expired registrations are not service failures.
There are five metrics, three policies and seven charts in the combined bundle; it reuses the existing verified channel.

History and activity sender coverage is **covered in source** by the extended bundle and offline ownership/reapplication/privacy tests. Live activation and readback are **deferred** to [#1011](https://github.com/jimmykane/quantified-self/issues/1011); passing these tests does not establish live coverage. Existing import/provider processing coverage is **unchanged** because its schedules, leases, retries and outcomes are unchanged; new post-persistence admission failures are covered by the activity push bundle. Foundation physical-device verification remains tracked in [#1007](https://github.com/jimmykane/quantified-self/issues/1007).

## MCP and Training impact

No MCP tool, scope, response, consent or Training planning contract changes. The canonical parent-creation result adds no event fields and changes no Training source reservations, calculations, completion or delivery behavior. Notifications contain no metrics or health data. Automatic Training notifications and their required MCP impact review remain outside this foundation.
