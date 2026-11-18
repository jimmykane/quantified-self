# Browser notifications

## Current sending, queue and retention model

Completed manual activity-send results, Sleep saves, History import completion and self-tests send directly from their
existing handler after the underlying work commits. Explicit Training send results send from the existing status
observer as soon as all captured workouts have terminal outcomes. Training still needs temporary outcome tracking
across workouts; it creates no new scheduled notification job. Background Training success remains silent.

Only alerts requiring grouping use deferred work: new activities, automatic activity-delivery failures, Training
attention and connection issues. These share **one `pushState.dueAt` queue and one minute worker**,
`sendActivitySyncNotifications`. Each category retains its own preference, batching window, source checks and rate
limits. The worker queries at most 25 due records, caches configuration only for categories with work, and shares
one backlog/heartbeat policy. Old ready Sleep/Training records can drain through the same worker during migration.
The two former delivery/Training scheduled Functions are removed from source. Route notifications remain reverted.

The existing handlers use a shared Web Push transport and claim before network I/O. Direct manual results retain
the existing account delivery budget and initiating-device consent; automatic failures keep their grouping window.
Notification transport errors never cause a completed provider import/upload to be retried. Preference/device/key,
connection and account deletion checks still apply before sending. An ambiguous send is never replayed.

`expireAt` is an actual Firestore Timestamp, configured as a TTL field on `pushState` and Training `issues` documents:

| Stored data | Retention |
| --- | --- |
| Bounded suppression/rate state and grouped notification records | 31 days after the latest relevant write, covering the 30-day manual-delivery replay fence |
| Training send outcome tracking, including unfinished requests | Two days from the original request, without extending its lifetime on status updates |
| Training attention receipts | At least 31 days, and through the workout date plus three days when later; shared issue receipts extend to the latest relevant workout |

Sending still rejects logically expired notifications immediately. Firestore TTL deletion is asynchronous and does
not delete subcollections, so Training issue descendants have their own TTL policy and timestamps.
Each provider’s existing connection metadata retains one timestamp, `historyNotificationRunCreatedAtMs`.
It records the creation time of the latest history run claimed for a notification, so even after receipt expiry,
retrying that run or an older one stays silent. [Firestore TTL documentation](https://firebase.google.com/docs/firestore/ttl)

### Consolidation rollout (separate approval; local work does not deploy)

1. Apply the updated monitoring bundle using the existing channel. Its existing category policies stop expecting
   the two retired schedulers; only the shared worker owns backlog/absence alerts.
2. Deploy the shared worker `sendActivitySyncNotifications` first. Keep both legacy schedulers running so
   pending two-minute batches continue to drain while the writers switch to `dueAt`.
3. Deploy the affected notification producers and observers, including the direct send handlers
   `queueActivitySendNotification`, `queueTrainingSyncNotification` and `processSleepSyncTask` with the existing
   VAPID binding. Include the history sender, self-test and existing Functions that write notification expiry timestamps.
   Allow invocations from the previous producer revisions to finish before the final migration pass.
4. Build Functions, then preview the one-time migration:
   `node functions/lib/functions/src/scripts/backfill-notification-retention.js --project=quantified-self-io`.
   Review its counts, then run with `--apply`. It pages 100 documents at a time, sets notification expiries,
   preserves the history timestamp on each existing provider connection, migrates legacy deadlines and prints counts only. Repeat the preview
   to verify zero remaining changes, then retire `sendActivityDeliveryNotifications` and `sendTrainingSyncNotifications`.
   Both versions claim batches transactionally; the shared worker also clears leftover deadlines for completed batches.
5. Deploy `firestore.indexes.json` to activate `expireAt` TTL for `pushState` and `issues`; verify both policies are
   active. This is required for automatic deletion. The emulator verifies Timestamp writes/migration, not the cloud
   TTL service. Existing `dueAt` indexing remains; legacy deadline indexes can remain unused during migration.
6. Verify direct results, grouped bursts, category/device cancellation, duplicate suppression and shared-worker
   monitoring on beta before broader release. Existing switches and category defaults are unchanged.

## Product boundary

Settings → Notifications supports explicit device opt-in, disable, and a self-test for every signed-in account. A separately gated, explicit per-import option can notify the initiating device when a manually started Suunto, COROS or Wahoo activity-history import ends. A separate New activities synced category groups recent live-provider imports. Activity delivery covers opted-in manual send results and grouped automatic-send failures. Training sync groups actionable upcoming-workout failures and connection problems. Training send results reports explicit sends, initial Enable sync and manual retries. Sleep synced sends directly for newly saved recent main sleeps. Connection issues groups new reconnect-required episodes in the shared minute worker. Billing, marketing and reminder categories are not implemented. Settings lists account-owned device registrations with individual disable controls. There is no notification inbox; automatic alerts use bounded private pending batches. Browser permission alone is not account consent. Managed impersonation sessions cannot register devices or send tests.

Production and beta share Firebase and one VAPID key pair. Registrations retain their exact origin; permission must be granted on each site/device. Self-tests target only the current installation and click through to that site's `/settings?section=notifications`. Automatic senders call `isAutomaticPushOrigin`, which admits both production and beta, excluding localhost and arbitrary origins. Both sites share category preferences, batching and account-wide rate limits. Each subscription gets a destination on its registered site. Enabling both sites in one browser can produce one notification from each site. Do not add a preferred-site setting or infer shared device identity across origins.

## Notification click routing

All five payload families retain the absolute declarative `notification.navigate` destination and use Angular's
[`openWindow` click operation](https://angular.dev/ecosystem/service-workers/push-notifications) for the worker fallback.
This calls `clients.openWindow()` without choosing or navigating the last-focused QS browser tab. The browser can
route the URL into an installed app; [Chrome on Android supports this routing](https://developer.mozilla.org/en-US/docs/Web/API/Clients/openWindow).
The existing root-scoped standalone manifest already includes activity details, Settings, Connections and Training.
No custom worker, extra click listener, manifest identity change or native URL scheme is needed.

App selection depends on the browser, OS and installation preferences; it cannot be forced by the payload.
The app must be installed from the notification's own origin: a production installation does not claim beta links.
Without a matching installed app, the fallback opens a browser window/tab and may create a new tab rather than
reuse an existing one. Exact single-activity links, grouped Activities links and result/query parameters are preserved.
Declarative platforms continue to route their existing `navigate` URL through the browser.

This payload change requires redeploying the affected senders: `sendTestPushNotification`, `sendHistoryImportNotification`,
`sendActivitySyncNotifications`, `queueActivitySendNotification`, `queueTrainingSyncNotification` and `processSleepSyncTask`.
Routing itself needs no flag, Rules, index or service-worker change. Already delivered notifications retain their old
payload. Monitoring coverage is unchanged: transport, queues, rates, schedules and outcome labels are unchanged.
Unit tests cover all payload families on both origins; real-device routing must still be verified with a fresh alert,
including an installed app closed while a normal QS tab was last focused, an already open app, no installation,
beta versus production installations, and native declarative delivery. Unit tests do not establish OS app selection.

## Data flow and ownership

The browser obtains a subscription through `window.pushManager` when available, otherwise Angular's existing root worker. The browser writes a private leaf at `users/{uid}/pushSubscriptions/{installationId}` with schema version, origin, public signing-key version, random generation, endpoint, encryption keys and server timestamp. Firestore Rules permit direct owner CRUD, allow bounded owner-only listing (maximum 26 documents per request), prohibit descendants and impersonated listing/writes, validate supported endpoints and fence deleted/missing accounts. Optional `device: { browser, platform }` contains only allowlisted coarse display hints, never a raw user agent or hardware identifier. Subscription endpoints and encryption material are capability credentials: never log or publish them.

For a missing device, search **Sentry Logs** for browser removals and **Google Cloud Logging** for push-provider expiry.
Both use the message `Web push device removal` and the logging system’s timestamp. Filter by `accountRef`, then
by `deviceRef` or `origin` to distinguish installations. To calculate the account reference locally from a known Firebase UID:

```sh
printf 'qs-web-push:account:%s' "$QS_UID" | shasum -a 256
```

The `reason` field distinguishes device opt-out, sign-out or account switching, permission loss, a missing browser
subscription or server registration, a changed signing key, and invalid registration data. The `action` is
`browser_detached` when QS cleared the browser installation and `registration_removed` after a confirmed deletion.
`registration_delete_acknowledged` means Firestore acknowledged an idempotent delete while browser cleanup did
not complete. A provider HTTP 404 or 410 logs `push_service_expired` with the sender after the matching generation
is deleted. Logs are best effort: an offline browser or telemetry blocker can prevent a browser log from arriving.

Endpoint validation is shared by browser/server code and mirrored in Rules: Google FCM, Mozilla Push, Apple Web Push, and a single DNS label under `notify.windows.com` for Edge's Windows Push Notification Service (WNS). HTTPS, hostname boundaries and the absence of credentials, custom ports and fragments remain mandatory. [Microsoft documents Edge's WNS transport](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/forcebuiltinpushmessagingclient) and [its service domain](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/firewall-allowlist-config). WNS requests retain Web Push encryption/VAPID and add the [raw notification type and 60-second WNS expiry headers](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-request-response-headers); `web-push` supplies the encrypted binary content type.

The `sendTestPushNotification` App-Check callable accepts only an installation UUID. It derives UID from Auth, validates caller/stored origins and endpoint, transactionally reserves one of ten UTC-day tests with a one-minute cooldown, then checks current configuration and deletion/registration state again before sending. Rate state is server-only at `users/{uid}/pushState/testRateLimit`. All state falls under the existing recursive user-root deletion; no top-level feature collection is added; notification state uses the expireAt TTL policy above. Rates count attempts, including configuration/network failures.

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

## Managing notification devices

The Notifications settings component owns a short-lived device-list service. It reads only the signed-in owner's
`pushSubscriptions` collection, ordered by document ID, in pages of 25 plus one lookahead document. Rules require
an explicit limit of at most 26 and deny impersonated and cross-account queries. The SDK reads the existing private
registration records directly; there is no new callable, public projection or collection-group query. Only identifiers,
coarse browser/platform hints, exact site and the registration-update timestamp enter view state. Endpoints and
subscription keys must never be rendered, logged or added to analytics.

Both sites display the same list, with Production/Beta labels and a This browser marker only for the exact local
installation and origin. These are registered destinations, not proof of current browser permission, online presence
or OS display. No device model or user-assigned computer name is inferred. Older registrations use a generic label
and short identifier until their browser opens QS; metadata enrichment is update-only, best-effort and does not
block a working subscription, rotate its generation or transfer pending consent. The displayed timestamp is
registration updated, not last seen.

Disable removes only the selected leaf in an owner transaction that rechecks its exact generation and origin. A
replacement registration is preserved and the user is asked to refresh. Successful current-browser removal invokes
existing browser reconciliation; remote browsers reconcile on their next startup/focus. Backend senders recheck live
registrations before transport, so a remotely removed device stops receiving future sends even while offline.
Permission at the other browser remains unchanged; re-enabling requires an explicit action there. An already
accepted push cannot be recalled. Account changes and component teardown invalidate pending reads and mutations.
List errors retain prior rows but block removal until a fresh server read succeeds. Refresh and pagination are explicit.
Completed local enable/disable/test actions refresh the list and invalidate older in-flight list or pagination results,
including expired self-tests and partial failures where the server registration was removed before browser cleanup failed.
A callback finishing after Settings closes cannot restart its device-list service.

After separate deployment authorization, deploy Rules before releasing the frontend: old Rules reject device metadata
and listing. Beta automatic delivery also requires redeploying the three senders, two delivery admission triggers,
manual history admission callables, activity-send command, and import workers containing activity admission. Deploy
all affected targets before checking beta. Existing switches/keys, schedules and indexes are unchanged; do not create
a beta-only flag or reset rate-limit state. Verify both site destinations with authorized test events, individual remote
disable, and shared caps. Source tests and a local mock UI do not establish live push delivery.

Monitoring coverage is **unchanged**: `tools/web-push-monitoring/definitions.mjs` selects the same sender/admission
services and fixed outcomes without filtering by origin. Beta uses the existing heartbeat, failure, backlog and
outcome metrics and existing alert channel; no new worker, schedule, retry, dead-letter path or telemetry label is added.

## Notification categories

Settings → Notifications exposes the shared category registry in `shared/notification-categories.ts`. The
categories are `history_import` (History imports), `activity_sync` (New activities synced), `activity_delivery` (Activity delivery), `sleep_sync` (Sleep synced), `training_sync` (Training sync), `training_send` (Training send results), and `connection_attention` (Connection issues). **New categories default on**, including for existing accounts,
without a migration or an initialization write. Category preferences are account-wide across devices and sites;
origin-specific device registration, browser permission, operational switches and each sender's consent still apply.
An enabled category still requires an enabled production or beta device and operational sender switches. It never checks a history-import checkbox. Self-tests bypass categories.

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

Notification listener teardown drains its saved handles before calling the SDK and attempts every unsubscribe even
when Firestore throws. Auth changes and destruction still fence callbacks and reset owner state. A Firestore internal
assertion means its local queue cannot safely accept new work: category editing stays blocked, the last confirmed
same-account choices remain visible, and Settings offers **Reload app**. Only that explicit action reloads the page;
ordinary read errors retain **Retry category settings**. Token refresh does not restart a known failed queue. No
persistence clearing, automatic reload, permission prompt or category write is part of recovery. This contains the
notification lifecycle failure and provides recovery; it does not repair the browser/SDK's IndexedDB implementation.

To add a category, extend the shared registry and Rules allowlist together, then implement and test that sender's
consent, revision checks, deduplication, account-wide budget and generic payload. New categories inherit the on
default, not another sender's per-event consent. Do not expose placeholder switches for unimplemented senders.

## Connection issues

`connection_attention` is a default-on account category. Sending additionally requires unconditional defaults
`web_push_enabled=true` and `web_push_connection_attention_enabled=true`; keep the new switch false/missing until
rollout verification. No browser permission is requested automatically.

The shared `markServiceReconnectRequired` lifecycle captures a stable `reconnectNotificationId` and
`reconnectNotificationStartedAtMs` only for a new reconnect-required episode. Routine auth failures may rotate the
existing lifecycle generation but retain this notification identity. Existing unresolved legacy connections do not
receive catch-up alerts. Deliberate pending disconnects do not start an episode. A successful reconnect clears the
marker, and a later genuine failure can start a new episode. Notification admission follows the existing Health/route
lifecycle work and is best effort: notification failures never change the authentication cleanup outcome.
The admission's Remote Config read has a five-second deadline so an unavailable configuration service cannot stall
auth cleanup. Only the read is raced; a late response cannot resume admission or create delayed notification writes.

Admission rechecks the current episode/account, deletion guards, category revision and enabled devices. One bounded
leaf, `users/{uid}/pushState/connectionAttention`, stores at most four latest provider receipts, a pending group, and
two rolling-day attempt timestamps. Groups wait two minutes; sending allows at most two groups per rolling 24 hours
and at least one hour between groups. Capped or cancelled episodes do not become catch-up alerts. Ten combined beta
and production device registrations can receive a group, each with its own origin and captured generation. Only
provider labels appear in the generic payload: one provider opens its Connections view; several open Connections.

Training connection warnings and this category transactionally reserve the same per-provider episode receipt.
Whichever admits first owns the warning, including concurrent admissions; both senders recheck ownership before
transport. Training uses the stable episode instead of auth-retry generations for connection issue deduplication.
Ordinary workout errors remain separate. Existing activity-delivery validation already excludes work predating a
disconnect/reconnect; explicitly requested manual send results and uncertain-upload reconciliation retain their
existing meaning and are not replaced by this generic connection warning.

The shared `sendActivitySyncNotifications` dueAt query handles grouped connection alerts with no extra
scheduled Function, idle query, secret, index or historical scan. Connection configuration loads once per active
sweep, only when a connection leaf is due. The sender claims before transport, never replays an ambiguous send, and
cancels reconnected/disconnected accounts, changed preferences/devices, or groups more than ten minutes overdue.

Rollout requires Rules and frontend category changes, the shared notification worker, `queueTrainingSyncNotification`
and `sendActivitySyncNotifications`, and the Functions that bundle the shared provider auth/lifecycle code. Deploy
those together through the existing Functions release workflow; deploying only the notification sender cannot enable
new episode admission in old auth workers. No new Function export or infrastructure resource is needed. Apply the
updated monitoring bundle using the existing alert channel, then verify shared-worker heartbeat/backlog and fixed
`[ConnectionAttentionPush]` outcomes before enabling the new switch. Existing sender switches, including the new sleep
switch, remain independent. Verify a fresh simulated reconnect episode in an emulator/test account, duplicate
Training admission, reconnection cancellation and both origin destinations; never break a real user's connection just
to produce a test. The explicit self-test does not exercise connection episode admission.

The new episode fields are server-owned metadata, and shared receipts are denied to all clients. There is no change
to public connection-state meanings, provider credentials/consent, account deletion ownership or MCP surfaces.

## Sleep synced

`sleep_sync` defaults on as an account preference. Sending additionally requires the unconditional Remote Config
defaults `web_push_enabled=true` and `web_push_sleep_sync_enabled=true`. A missing, conditional or false sleep switch
disables this sender. Keep `web_push_sleep_sync_enabled=false` while preparing rollout; this feature does not change
the existing sender switches.

Routine Suunto/COROS polling and authenticated Garmin/Suunto sleep webhook producers explicitly mark new queue rows
with `sleepNotificationOrigin: 'live'`. Queue admission strips that marker for history/backfill work. Administrative
recovery jobs, legacy rows and manual/history producers do not acquire it just because they share a polling type.
The canonical Sleep writer reports only newly created, usable main sessions that ended within the last 24 hours.
Updates, corrections, duplicate saves, naps and old sleeps do not qualify. The queue invokes best-effort notification
admission after persistence; notification failure never changes successful provider ingestion or its retry outcome.

Admission rechecks queue ownership/revision, the canonical session's metadata, the current connected provider account
and lifecycle generation, deletion guards, category preference and registered devices. Sleeps starting before a new
connection/reconnection and active connection-history imports are suppressed. Existing legacy connections without
an activity-notification connection-time marker retain eligibility; newly connected accounts receive that marker
through the shared connection lifecycle. No backfill or replay is run when a user enables notifications.
The existing provider Sleep state's `lastBackfillEndMs` also suppresses sessions starting inside a requested backfill
range. This is essential for direct Garmin backfills whose results arrive through ordinary live webhooks; the cutoff
is claimed before requesting provider data and is rechecked before each device send.

One bounded leaf, `users/{uid}/pushState/sleepReady`, stores the latest admitted sleep date/end time, admission time,
and at most one pending alert. Dates/end times advance monotonically across providers, with at least 20 hours between
admissions. This prevents duplicate nights across Garmin/Suunto/COROS, midnight boundaries and recreated documents.
Overlapping sleep intervals are suppressed even if a delayed provider report uses a different calendar date and
arrives after the cooldown. Disabled categories and existing receipts stop admission before device/session reads.
Cancelled and failed alerts retain the receipt. The Sleep import handler sends the alert it admitted after persistence.
The shared worker drains any alerts already scheduled by the previous version. Both use the existing VAPID key.

The sender clears pending work and claims before transport, then rechecks consent, account/session/connection state
and each captured device generation. Claims are deliberately not replayed after ambiguous transport failure or a
crash. Pending alerts expire after ten minutes; device fan-out is capped at ten across production and beta. Both sites
receive alerts on their own origins. Expired registrations are removed only if their generation still matches.
The generic payload contains no scores, sleep times or other health metrics. It opens `/health?metric=sleep` using
the same declarative and service-worker `openWindow` destinations as other alerts.

Rollout after merge:

1. Keep the new sleep switch false/missing. Deploy Firestore Rules before serving the frontend category.
2. Deploy `receiveGarminAPIHealthData`, `receiveSuunto247Data`, `scheduleSuuntoSleepSync`, `scheduleCOROSSleepSync`,
   `processSleepSyncTask`, and `sendActivitySyncNotifications`. Build and deploy frontend releases through the usual
   beta/production workflow. No index changes or migration are needed.
3. Apply the updated Web Push monitoring bundle using the existing alert channel. `[SleepSyncPush]` adds fixed
   admission/send/sweep outcomes; shared worker backlog, heartbeat and runtime coverage remain in place.
4. Enable `web_push_sleep_sync_enabled` for the shared backend after verification. Test with a genuinely new main sleep
   on an already connected test account; histories, replayed queues and the existing self-test do not exercise admission.
   Verify each registered origin's click destination and category/device cancellation.

Disable the sleep switch to stop future sends. Category off/on, expired pending work, suppressed histories and old
receipts never become catch-up notifications. Costs scale with eligible new saves and devices rather than all users
or all historical sessions; admission adds bounded metadata/preference/registration reads and one small pending write.

## Training sync attention

Training alerts reuse existing device registrations, the key, category revision checks and private-state ownership.
The authoritative policy, receipts, grouping, rollout and MCP review are in
[Training sync attention notifications](training-workspace.md#training-sync-attention-notifications).
The new operational parameter is `web_push_training_sync_enabled=false`. After separate approval, deploy:

```sh
npm run firebase -- deploy --only firestore:rules,firestore:indexes --project quantified-self-io
```

Verify the shared `pushState.dueAt` index is ready, then deploy the Functions:

```sh
npm run firebase -- deploy --only functions:queueTrainingSyncNotification,functions:sendActivitySyncNotifications --project quantified-self-io
```

The shared worker runs each minute, including while the Training flag is false. Both the shared worker and the
Training observer bind the VAPID key because the observer sends explicit Training results directly. Release the frontend
and apply the monitoring bundle using the existing channel, then verify the shared heartbeat and real devices before enabling
the flag. The bundle covers fixed outcomes, both runtimes, overdue observations and idle/disabled sweeps. A never-seen
heartbeat cannot bootstrap an absence alert: verify its initial series after deployment. Source tests are not live
readback evidence. Provider queues and their retry/dead-letter monitoring remain unchanged.

## Manual history import completion

The first automatic notification is an explicit, one-time choice on a **manual activity-history import** for Suunto, COROS or Wahoo. The checkbox starts unchecked. If device registration is needed, a separate button invokes the existing permission flow directly from its click; successful registration does not check the import option. No permission prompt appears during page load, hydration or completion. A pending registration lookup stays bound to the starting account, view and provider connection generation; replacing or removing that connection cancels submission and clears the import choice, while an ordinary metadata refresh keeps it valid. Garmin is excluded because its completed coordinator records requested history, not correlated ingestion. OAuth recent-history imports, Sleep, Health and routes are excluded.

The existing three admission callables accept optional `notification: { installationId, generation }` only with `background: true`. Auth, App Check, Pro, date/range and existing connection checks remain in force. Origin comes from the HTTP request; impersonated requests and origins outside the two deployed sites are rejected. The admission transaction validates the current owner's registration, exact generation, origin, public key and enabled category, and stores that consent with its server category revision on the private run. No endpoint, key or consent is added to the public progress projection. Unchecked imports retain their existing request and admission behavior, without fetching push configuration.

`sendHistoryImportNotification` observes `connectionHistoryImports/{runId}` writes. Only a transition from active to terminal on a consented custom activity-only run enters delivery. The existing coordinator already waits for committed child outcomes and retryable work; this change adds no child notifications and changes no provider queues, retry policy or canonical ingestion. A completed scan with failures says **finished with issues**; a terminal stop before the scan/children finished says **needs attention**. It never calls a stopped run successful. An explicit owner retry after a send attempt does not create a second alert.

The sender re-reads the exact revision, live user/deletion guard, current connection generation and latest inactive projection, and the consented registration. It rejects results older than 24 hours, superseded runs, revoked/rotated registrations and changed connections. It repeats lifecycle checks after claiming and before external I/O. A change after the final check or a push already accepted by the browser service cannot be recalled. A registration generation change, including a subscription refresh, conservatively cancels the old consent; it is not transferred silently.

Anti-spam state is a server-only leaf at `users/{uid}/pushState/historyCompletion`: at most two attempt timestamps in a rolling 24-hour window and one receipt per supported provider (maximum three). A transaction reserves the attempt **before** sending. Concurrent/repeated events, explicit retries of the same run and older runs cannot pass the provider receipt watermark. A capped result also receives a suppression receipt, so it cannot send when the cap later expires. The rate is per account across providers, independent of the existing self-test rate; cancelled/failed attempts consume it. This bounded state uses existing browser-deny Rules and recursive user cleanup, with expireAt TTL and no new recurring collection scan.

Delivery is **best-effort, at most one attempt per import**, not exactly once. A crash after the durable claim, an ambiguous network result or failed bookkeeping must not initiate another send. Platform retries can recover preparation failures before a claim; a claim prevents replay afterward. This deliberately prefers a missed alert over duplicates. Connections remains the authoritative progress/result surface. Turning the switch off discards newly observed completions; turning it back on does not scan or replay them.

The generic standard/declarative payload contains no activity count, title or health data. It opens `/services?serviceName=<provider>&tool=history`, the existing history-results dialog, with the QS icon. Delivery uses low urgency, a one-hour TTL (including WNS), topic/tag `qs-history-import` and `renotify: false`. The tag may replace an older visible import alert, but receipts and rate limits provide business-level duplicate prevention. There is no quiet-hours preference in this first explicit one-off feature; low urgency is not a guarantee of OS silence. Acceptance is not proof of display or reading.

### Release and rollback

This feature defaults off through a **new**, unconditional top-level Remote Config switch, `web_push_history_import_enabled=false`. Both this and `web_push_enabled` must be true, with the matching `web_push_vapid_public_key`. Do not change the existing foundation flag/key merely to prepare this feature. Missing/conditional settings fail closed on the server; cached frontend configuration may lag and display an option the server now rejects. The user can uncheck it and import normally. Both production and beta support automatic consent and delivery through the same shared switches.

After separate approval, deploy the category Rules, existing admission callables and new isolated sender before releasing the frontend:

```sh
npm run firebase -- deploy --only firestore:rules,functions:addSuuntoAppHistoryToQueue,functions:addCOROSAPIHistoryToQueue,functions:addWahooAPIHistoryToQueue,functions:sendHistoryImportNotification --project quantified-self-io
```

The history-only subset requires the Rules deployment above. It needs no key rotation, ingestion-worker deployment, schedule or queue change. Releasing the full PR also requires the live-activity deployment below. The shared key is bound only to handlers that send notifications. Direct manual/Sleep/Training send handlers now receive it through their existing Function secret bindings. Apply/read back the extended monitoring bundle with the existing alert channel before enabling the new switch. A production test window and test sends need separate authorization; there is no client-targeted or beta bypass. Rollout and monitoring activation/readback are tracked in [#1011](https://github.com/jimmykane/quantified-self/issues/1011).

Rollback of new admissions/sends is the new switch set to false; existing imports continue normally. Already claimed/accepted sends may finish. Never clear receipts or replay completed runs. The trigger uses 256 MiB, 30 seconds, max two instances, concurrency 20 and zero minimum instances in `europe-west2`; no idle warm instance or new scheduler is provisioned. Once deployed it is invoked on history-document writes even while disabled, then filters unrelated checkpoints in memory. Consented completion handling adds bounded configuration/Firestore reads, transactional claim/bookkeeping writes and one push request at most. This has incremental invocation/read/write costs; it is not a free or guaranteed-delivery service.

## Notification discovery

The owner Dashboard reuses the action-prompt area above Today for a notification invitation. It requires a confirmed
connected activity service, no empty-account/setup prompts, an enabled activity-sync category and the frontend
`web_push_activity_sync_enabled` switch. Browser permission must still be `default`, with no retained subscription
or installation. Previously granted but unregistered browsers use the permanent tray/Settings entry points rather
than being treated as never opted in. The header's **Updates & notifications** tray includes device status, an **On**
switch, blocked/Home Screen instructions and a Settings link; its badge still counts release notes only. Public and
impersonated sessions do not receive a device offer. Opening either surface never requests permission or sends a test.

Turning the tray switch On requests device permission synchronously and enables every known notification category
in one owner-scoped transaction after registration succeeds. The transaction reads current revisions before any writes
and preserves already enabled categories. This explicit master action may re-enable categories the account previously
turned off. Turning the switch off revokes only the current device; other devices and category preferences stay active.
The switch remains On while any category is active on an enabled device, so a partial category selection is never
presented as a silent device. Existing per-request history/delivery intent and sender throttles still apply.
The switch can retry temporary worker/device-check failures after support, account and site configuration checks succeed.
Retry verifies browser subscription ownership again, revoking foreign/orphaned endpoints before registering and
reusing the current account's installation ID to avoid duplicate device rows. Before subscribing or starting a registration
write, an observed newer local installation from another tab supersedes the pending enable. Site enablement and signing-key
changes are checked again around asynchronous work.
Permission remains in the original user gesture, before worker waits or category writes. Non-retryable configuration/read
states offer a support Retry action; blocked permissions and installation requirements retain their browser instructions.
If registration succeeds but enabling categories fails while others remain active, Retry repeats the incomplete On
action without turning the device off or requesting permission again. When the switch is still off, On itself retries.
The pending action is cleared after success, explicit Off, or an account change.

`users/{uid}/config/settings.appSettings.notificationInvitation` is a client-owned versioned UI preference under
existing private Settings Rules, separate from sender/category consent. A first snooze lasts 30 days; another snooze
after that deadline becomes a permanent dismissal. Explicit dismiss, enable and disable choices are terminal for
proactive discovery. Transactional nested merges preserve unrelated settings, concurrent snoozes do not consume the
reminder twice, and terminal choices cannot be revived by a late snooze. Generic profile/Settings saves exclude this
field so stale tabs cannot replay old choices; empty app-settings maps cannot erase it. Choices synchronize across beta/production.
An account-scoped local stop marker also preserves explicit enable/disable intent if the preference write fails.
An in-memory stop survives token refresh and account re-entry when local storage is unavailable. Device choices wait
for a pending invitation claim check before saving, with the same account/lifetime and impersonation checks.
Disabling a listed registration saves the shared opt-out in the same transaction as revocation. Sign-out, expiry and
background reconciliation do not record an explicit opt-out. Account cleanup already covers the settings document.

Invitation reads require an authoritative server snapshot; cache-only, malformed, failed and impersonated reads
suppress the dashboard offer. Focus refreshes the snooze clock. Permission requests remain synchronous in an explicit
button gesture, and asynchronous UI completion is fenced to the starting account and component lifetime.
The current dashboard gesture keeps progress or failure feedback visible after permission state changes; failure
provides a Settings link and only allows an enable retry when the push service can enable that device.
No new Function, Rules deployment, scheduler, notification category or notification inbox is introduced. Frontend release
uses the existing foundation and activity-sync switches; no cloud values are changed by this implementation.

## Recent live-activity sync notifications

`activity_sync` defaults on as an account preference, independently of `history_import`. Sending additionally requires
both unconditional Remote Config defaults `web_push_enabled=true` and **`web_push_activity_sync_enabled=true`**,
plus the matching public key. The new sender defaults off when its parameter is absent; prepare it as false. No new
signing key, permission prompt, paid service or client-targeted rollout is introduced. Existing production and beta device
registrations are eligible under the same account-wide limits.

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
  and existence, account deletion guard, preference revision and registration generations on both sites. These are masked
  metadata reads; no metrics, streams or full sports models are hydrated to prepare a notification.

One private leaf, `users/{uid}/pushState/activitySync`, holds at most one pending batch, four attempt timestamps,
256 event-ID suppression receipts and one claim ID. Receipts expire logically 48 hours after workout completion and
are pruned on new admission. Recreating the same canonical event during this period does not notify again. At the
receipt limit, further arrivals are silently omitted until space becomes available. This bounded state is denied to
clients by existing Rules and removed by existing recursive account cleanup; expireAt TTL removes the retained state after its suppression window.

The first eligible arrival fixes a two-minute batching deadline and snapshots at most ten registered devices across production and beta. Later arrivals do not extend that deadline or add newly enabled devices. The batch holds at most 50 unique
workouts; excess arrivals are suppressed. The minute scheduler normally sends after roughly two to three minutes.
One workout opens `/user/<uid>/event/<eventId>`; multiple workouts open `/activities`. The payload exposes only a generic
message/count, no workout names or metrics, using the shared QS icon, declarative `web_push: 8030`, Angular click
fallback, low urgency, fixed topic/tag `qs-activity-sync`, `renotify: true`, five-second transport timeout and ten-minute
push TTL (including WNS). Each permitted batch requests renewed attention when replacing an older visible activity
alert with the same tag. This retains one visible activity alert per site while allowing a later batch to alert again;
browser/OS permissions and presentation still apply. Grouping, duplicate receipts and rate limits govern how many
batches are sent, independently of browser replacement. Monitoring coverage is **unchanged**: this presentation
setting changes no sender outcome, schedule, backlog, retry or alert filter and adds no device-display acknowledgement.

After separate deployment approval, this payload-only adjustment ships with
`npm run firebase -- deploy --only functions:sendActivitySyncNotifications --project quantified-self-io`.
Already delivered notifications retain their previous payload.

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
release the frontend to beta for category/permission UI checks. Automatic delivery supports both deployed sites.
An explicitly authorized short production window should verify a new recorded workout, grouped arrivals, separate
history exclusion, off/on cancellation, click routing and real OS display before broader activation. All default-on
accounts with enabled production or beta devices become eligible when the shared activity flag turns on; this is not a
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
`web_push_enabled` and **`web_push_activity_delivery_enabled`** switches, a matching public key, and production or beta device
registration. Missing or conditional sender configuration fails closed. Keep the new switch false during preparation.
This category concerns recorded activities sent **from QS to providers**, not imports, planned workouts or routes.

### Manual sends

The Send activities review offers **Enable notifications on this device**, then an unchecked **Notify me when this
send finishes** checkbox beside Send. Permission is requested only from that button gesture. Enabling permission or
turning on the category never selects batch consent automatically. A blocked/unsupported device or unavailable sender
never prevents an unchecked send. Category-off links/actions use the existing owner-scoped preference transaction.
Owner, provider, source, draft revision and permission changes fence a pending device lookup; an unavailable choice
can still be unchecked. Completed sends show only that a notification was requested, not a delivery guarantee.

Confirmation optionally accepts exactly `{ installationId, generation }`. The existing callable validates the request Origin against production and beta, own-account (no impersonation), configuration, current registration/key, category revision and destination
account/generation transactionally with confirmation. Consent stays in private `activitySendOperations`; the public
batch exposes only `notificationRequested: true`. No new CRUD callable or provider action is introduced.

`queueActivitySendNotification` observes `users/{uid}/activitySends/{batchId}`. Only an opted-in non-stopped transition
to complete enters admission; retries re-read the current batch, private operation and a one-row masked issue query.
The result says **finished** or **needs attention**, never that all recordings were delivered merely because processing
ended. Twenty files produce at most one result for their batch. The initiating device is the only target. One result
opens its exact Send activities batch; grouped manual results open Recent sends. Stop cancels pending notification work.
An explicit retry of the same batch does not create another notification after admission/attempt.
Retry and Check status invalidate the completed notification snapshot in the same transaction that resumes queue
work. The batch timestamp advances strictly, including same-millisecond resumes, so a delayed projection cannot
leave an old result eligible for admission or sending. Ordinary sends without notification consent add no read/write.

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
metrics, titles, filenames or raw errors enter this state or telemetry. The first automatic failure fixes a two-minute window;
the shared minute worker sends grouped failures after roughly two to three minutes. Completed manual batch results send directly from their existing trigger. Per-result targets preserve initiating-device
consent when manual results share a window with automatic failures. Browser endpoint aliases receive at most one push.
There is at most **one delivery batch attempt per 15 minutes and four per rolling 24 hours per account**, independently
of import/live-sync/test budgets. Capped or overflow results are suppressed permanently, not queued for a later digest.

Admission snapshots category and device generations. Off/on, sign-out, replacement registration, key change, stopped
or retried source, connection change and deletion cancel stale work. Claims clear pending state before network I/O;
ambiguous sends/crashes are never replayed. A failed device cannot strand other devices. 404/410 removes only the exact
expired registration generation. Pending batches expire ten minutes after becoming due; results older than 24 hours
cannot enter delivery. The scheduler reads at most 25 due users and processes five at a time, with five device sends
at a time per user. It uses the same `dueAt` queue and worker as the other grouped notifications. This private leaf participates in existing recursive account cleanup; the notification expireAt TTL policy applies.

The shared standard/declarative payload includes the QS icon, worker click fallback, fixed tag/topic
`qs-activity-delivery`, low urgency, `renotify: false`, ten-minute TTL and five-second timeout. Push acceptance is not
proof of display. Rate caps and OS settings can prevent a requested notification; results remain in the app.

### Delivery rollout and rollback

After separate deployment approval, with the new sender switch **false**:

```sh
npm run firebase -- deploy --only firestore:rules,firestore:indexes
# Verify the shared pushState.dueAt index is ready.
npm run firebase -- deploy --only functions:activitySendCommand,functions:projectActivitySendDelivery,functions:queueActivitySendNotification,functions:queueAutomaticDeliveryNotification,functions:sendActivitySyncNotifications
```

Both delivery triggers use 256 MiB, a 60-second timeout, retry enabled, concurrency ten, max two and min zero in
europe-west2. The manual result trigger and the shared minute worker bind `WEB_PUSH_VAPID_KEYPAIR`.
The automatic failure trigger only groups work.
Release the verified frontend through the existing separately authorized workflow. Both deployed sites support delivery alerts.
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

During readback, validate every dashboard and alert-condition filter with Monitoring's `timeSeries.list` API,
including filters with no current samples. Multi-service comparisons must use `one_of(...)`; Logging's
`label=("a" OR "b")` shorthand is not valid Monitoring syntax. Offline bundle tests do not replace this live check.

Outcome metrics use Logging substring comparisons for the full bracketed marker, for example
`jsonPayload.message:"[ActivityDeliveryPush]"`. Firebase's error logger prefixes the marker with `Error:` and appends
a stack trace, so equality with the whole message misses real failures. The runtime/project scope, telemetry version,
fixed phases/outcomes and label extractors still bound each metric. Native 5xx, overdue and heartbeat coverage,
thresholds, ownership and the existing alert channel are unchanged. Regression fixtures use the installed Firebase
logger's real info/error formatting. Applying these corrected definitions still requires separate cloud approval;
no sender deployment or flag activation is needed for this monitoring correction. Training activation remains a
separate rollout step.

The bundle retains the self-test metric/policy and adds `sendhistoryimportnotification`, both restricted to `europe-west2`. Each charts fixed outcomes and native requests and alerts on three genuine failures in fifteen minutes. Category opt-outs and revision changes use the existing suppression/cancelled paths and do not add an alert or label. History also alerts on native 5xx to cover failures before outcome logging; its fixed cancelled/limited categories never page. The existing owned dashboard is updated, not duplicated. Permission denial, rate limits, disabled configuration and expired registrations do not page. User-requested traffic has no heartbeat; idle/missing outcomes do not assert health and do not page. History completion has no notification outbox or dead-letter queue; its backlog remains the existing coordinator backlog. Existing connection-history monitoring remains authoritative for import backlog, failed processing and terminal runs. A sender claim with an uncertain outcome is intentionally not repaired or replayed. Reapplication preserves unrelated resources through shared ownership checks. Thresholds should be reviewed after observed traffic.

For a failure, check enabled/default parameters, matching signing keys, runtime permissions and fixed outcomes. Never copy endpoints, payloads, key material, identifiers or raw HTTP responses to incident artifacts. Do not blindly resend or change rate state. Source definitions are prepared; live activation/readback must be tracked separately and is not implied by passing tests.

The shared worker records `failureStage` (initialization, due query, account processing or backlog probe) and an allowlisted
`errorCode`. It preserves the first rejection's safe code while awaiting the bounded fan-out, so one failing category
does not strand other categories. Configuration is lazy per category and is not fetched on idle sweeps. Direct
handlers keep fixed category/phase/outcome markers. Raw errors, keys, account/device identifiers, endpoints and
payloads are never logged. Category policies cover their admission/send errors; one shared policy covers worker
runtime, backlog and missing heartbeats.

A failed template read logs `[WebPushConfiguration]` once per active category per invocation, with a fixed
failure classification and elapsed time. These diagnostics ship in the affected backend handlers.

The activity sender adds three versioned metrics and one policy to the same owned bundle: fixed outcomes/phase
(including admission failures in existing Gen 1/Gen 2 import workers), completed-sweep heartbeat, and positive oldest-due
observations at least three minutes overdue. It alerts on three real admission/send/preparation failures or native 5xx
in 15 minutes, two overdue observations in five minutes, or no completed sweep for 15 minutes. Disabled and idle sweeps
emit heartbeats. An empty first query establishes zero backlog. After processing due work, the worker reads only
the oldest remaining deadline. A failed sweep emits its failure instead of a heartbeat. Verify an initial heartbeat metric series during activation: absence policies cannot detect a never-seen series.
Expected histories, duplicates, category/lifecycle skips, rate caps and expired registrations are not service failures.
The combined bundle has ten metrics, eight policies and twelve charts on the existing verified channel.
Delivery has category-specific outcome monitoring and shares the worker’s backlog and heartbeat alerts.

History, activity-sync and activity-delivery sender coverage is **covered in source** by the extended bundle and offline ownership/reapplication/privacy tests. Live activation and readback are **deferred** to [#1011](https://github.com/jimmykane/quantified-self/issues/1011); passing these tests does not establish live coverage. Existing import/provider processing coverage is **unchanged** because its schedules, leases, retries and outcomes are unchanged; notification invalidation uses the existing cancelled outcome and does not change alert filters or thresholds. New post-persistence admission failures are covered by the activity push bundle. Foundation physical-device verification remains tracked in [#1007](https://github.com/jimmykane/quantified-self/issues/1007).

## MCP and Training impact

No MCP tool, scope, response, consent or Training planning contract changes. Explicit Training send results reuse existing confirmed delivery commands; previews remain silent. Training attention uses the existing status projections. Private notification preferences and receipts remain excluded from MCP responses. Notifications add no event fields and change no Training source reservations, calculations, completion or provider delivery behavior. Payloads contain no workout titles, metrics or health data.

## Explicit Training send results

The default-on `training_send` category gives one combined result **per explicit provider operation**: standalone
**Send**, **Add & send** (one result per selected service), initial **Enable sync**, or manual **Retry**. A plan with
20 workouts produces one summary, even when its provider sends several batches. Success confirms provider
acceptance of the captured workout versions, never arrival on a watch. Partial/all failures ask the user to review
Training sync. Already-current, completed, suppressed, past and outside-horizon workouts are excluded. An empty or
no-op send is silent. Resume, settings reconfiguration, routine horizon sync, edits and automatic retries never create
new result requests. The separate `training_sync` category controls grouped Training attention alerts. Users can
enable results and attention alerts independently; their grouping and notification budgets also stay separate.

Admission is inside the existing confirmation transaction and uses its mutation receipt. MCP-confirmed operations
use the same path; there is no new wire field, permission or tool. Only the workouts currently eligible in the provider
window are captured, up to the existing 400-workout bound. Existing status writes feed the request. Captured failures
belong to the combined result instead of also producing individual Training attention pushes; successful recovery
still closes old attention receipts. Account-wide connection alerts remain independent.

Each scope/service has one private `users/{uid}/pushState/trainingSend_{settingsId}` leaf with captured versions,
category revision, destination/epoch, device generations and incremental counters. A newer explicit request for that
scope/service supersedes an unsent older result. Mutation receipt replay cannot recreate it. The existing
`queueTrainingSyncNotification` observer performs at most two masked request lookups per changed terminal/cancellation status; pending/retrying writes add no reads. Only a
matching request causes transactional source reads and a counter update. There are no per-workout notification
documents, extra provider requests, AI work, new Functions, idle queries or indexes. The existing status observer calls the sender directly when the final outcome commits. It claims before transport, with bounded device
fan-out and endpoint deduplication across beta and production. There is no daily cap on explicitly requested results.

The sender rechecks source versions, active plan, consent/settings, scope generation, deletion/restore locks,
connection destination/epoch/reconnect time, completion leaves, category revision and exact registration/key. It
rechecks authority and the schedule revision before each device send. Changed sources cancel the result rather than
claiming success for newer content. Requests expire after 24 hours; a ready result expires after ten minutes. Claims
are never replayed after crashes or ambiguous transport failures. Payloads contain only generic counts and service
names, use request-specific tags without a shared transport topic, and open the relevant plan or Training sync
history using standard/declarative navigation. Training outcome tracking also receives a two-day expireAt TTL from its original request; completed and stalled records are removed automatically after TTL activation. Recursive account cleanup still owns private leaves.

### Training send result rollout

This sender uses the existing unconditional `web_push_training_sync_enabled` flag together with
`web_push_enabled`, matching VAPID keys, the separate Training send results category and registered devices. The
internal rollout switch is shared with Training attention; the two user settings are independent. There is no new
rollout flag. If both existing switches are enabled, explicit result capture starts when these backends deploy.
This local change does not modify any remote configuration.

1. Deploy Firestore Rules for the new `training_send` preference. Existing indexes cover the feature.
2. Deploy `mutateTrainingProviderDelivery`, `mutateTrainingSchedule` (Add & send), `mcpApi` (confirmed MCP sends),
   `queueTrainingSyncNotification` and the shared `sendActivitySyncNotifications`, then the frontend. Provider delivery workers
   and their schedules are unchanged.
3. Apply the updated `tools/web-push-monitoring/` bundle using the existing alert channel and verify readback.
   The new fixed `[TrainingSendPush]` outcome metric/policy/chart covers admission, preparation and transport
   failures. Existing shared sweep backlog/heartbeat/native runtime monitoring and Training provider monitoring remain.
4. Exercise an explicit small send on beta, a multi-workout result, manual Retry and a routine background sync.
   Verify both independent choices: Training sync off/results on, and Training sync on/results off. Beta and production use the same backend flags and preferences; enabled
   registrations on both sites can receive results.

Rollback: restore the prior backend code, or turn the existing `web_push_training_sync_enabled` flag off to silence
**both** explicit Training results and grouped Training attention alerts. The existing observer rejects disabled ready results, and the shared sweep discards legacy queued results;
new commands do not capture requests. Provider sending continues. Already accepted notifications cannot be recalled.
Never clear claims or replay requests.
