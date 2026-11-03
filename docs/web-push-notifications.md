# Browser notifications

## Product boundary

Settings → Notifications supports explicit device opt-in, disable, and a self-test for every signed-in account. This foundation does not generate activity, import, Training, billing, marketing or other automatic notifications. There is no inbox, subscription list, scheduler, outbox or retry queue. Browser permission alone is not account consent. Managed impersonation sessions cannot register devices or send tests.

Production and beta share Firebase and one VAPID key pair. Registrations retain their exact origin; permission must be granted on each site/device. Self-tests target only the current installation and click through to that site's `/settings?section=notifications`. Future automatic senders must call `isAutomaticPushOrigin`, which admits production only. Do not add a preferred-site setting or infer shared device identity across origins.

## Data flow and ownership

The browser obtains a subscription through `window.pushManager` when available, otherwise Angular's existing root worker. The browser writes a private leaf at `users/{uid}/pushSubscriptions/{installationId}` with schema version, origin, public signing-key version, random generation, endpoint, encryption keys and server timestamp. Firestore Rules permit direct owner CRUD, prohibit listing/descendants and impersonated writes, validate supported endpoints and fence deleted/missing accounts. Subscription endpoints and encryption material are capability credentials: never log or publish them.

Endpoint validation is shared by browser/server code and mirrored in Rules: Google FCM, Mozilla Push, Apple Web Push, and a single DNS label under `notify.windows.com` for Edge's Windows Push Notification Service (WNS). HTTPS, hostname boundaries and the absence of credentials, custom ports and fragments remain mandatory. [Microsoft documents Edge's WNS transport](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-browser-policies/forcebuiltinpushmessagingclient) and [its service domain](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/firewall-allowlist-config). WNS requests retain Web Push encryption/VAPID and add the [raw notification type and 60-second WNS expiry headers](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/push-request-response-headers); `web-push` supplies the encrypted binary content type.

The `sendTestPushNotification` App-Check callable accepts only an installation UUID. It derives UID from Auth, validates caller/stored origins and endpoint, transactionally reserves one of ten UTC-day tests with a one-minute cooldown, then checks current configuration and deletion/registration state again before sending. Rate state is server-only at `users/{uid}/pushState/testRateLimit`. All state falls under the existing recursive user-root deletion; no top-level feature collection or TTL policy is added. Rates count attempts, including configuration/network failures.

The fixed payload contains `web_push: 8030`, title/body, `navigate`, and Angular's `onActionClick` fallback. No extra push or click listener displays a second notification. The payload expires after 60 seconds. The sender times out after five seconds, never follows redirects and never retries self-tests in the background. HTTP 404/410 removes only the matching registration generation. Other errors retain the registration and return a generic error; acceptance does not prove display or reading.

Explicit sign-out and managed account-token switching run bounded device cleanup before Auth changes. Other owner changes revoke the browser subscription and require a fresh account opt-in. Offline cleanup cannot recall already accepted notifications; only generic text is sent. A failed owner-document removal may leave an inert registration until account cleanup or an expired-send response removes it. Browser startup, focus and subscription-change observations reconcile retained device state without requesting permission.

Every startup observer waits for the first authoritative Auth result before touching retained consent. Signed-out cleanup discovers the actual browser manager and keeps the local cleanup marker if revocation fails. On iPhone/iPad browser tabs, Home Screen guidance precedes push API checks because those APIs may be hidden until installation. Background reconciliation updates endpoint/encryption-key changes only for a valid existing registration; it uses an update-only write so removal between read and write cannot recreate consent. A newer same-account refresh does not unsubscribe a valid pending rotation.

## Configuration and release

Defaults are disabled. Provisioning, publishing Remote Config, applying monitoring and deployment each require separate authorization. This PR does not perform them.

1. Generate a Web Push VAPID key pair using the installed `web-push` library in an explicitly selected external local configuration directory. Store local material only under `~/.config/quantified-self/` or an approved external override, with restrictive permissions. Never put key values in shell arguments, logs, tickets, fixtures or a checkout. The value-free secret template names `WEB_PUSH_VAPID_KEYPAIR`.
2. An authorized operator sets `WEB_PUSH_VAPID_KEYPAIR` interactively with `npm run firebase -- functions:secrets:set WEB_PUSH_VAPID_KEYPAIR --project quantified-self-io`. The value is JSON with `publicKey` and `privateKey`; only `sendTestPushNotification` binds it. The matching public key is safe to distribute.
3. Add unconditional, top-level Remote Config parameters `web_push_enabled=false` and `web_push_vapid_public_key=<matching public key>`. Do not use targeting conditions or parameter groups for these two keys: server admission reads the same default parameters. Frontend cached configuration can lag; server admission fails closed against the current template. Grant the Function runtime identity Remote Config template read access if its existing permissions do not provide it.
4. Under separate deployment approval, deploy Rules and `sendTestPushNotification`, then the frontend. Exact selective backend command: `npm run firebase -- deploy --only firestore:rules,functions:sendTestPushNotification --project quantified-self-io`. Frontend release uses the normal reviewed hosting workflow. Never deploy unrelated Functions or alter existing queues as part of activation.
5. Review and apply the monitoring bundle below with the existing verified operational email channel. Publish the shared enabled flag only when the matching server secret, Rules, frontend, monitoring and device checks are ready. An explicitly enabled authorized test window may be needed for real-device verification; production-wide activation follows its results. Beta is optional and uses these same keys and flag.

A standard development Angular build has no service worker. Offline unit tests mock both browser managers, Remote Config and transport; backend emulator tests must use an explicit demo project and external development keys. Localhost origins are rejected by deployed admission and Rules. Do not connect local tests to real push destinations or production data merely to exercise the button.

For key rotation, provision the new matching pair and public parameter together with authorized redeployment, keeping the enabled flag off during transition. Existing registrations with a different public key must be disabled and explicitly re-enabled; no silent migration or permission prompt. Do not delete the old cloud secret/version without separate approval.

## Verification

Automated coverage includes browser and SSR states, owner changes during pending registration, denied permissions, missing configuration, key rotation, both push managers, fixed payload/navigation, server admission, concurrency/rate limits, expired-generation races, private Rules and deletion guards. Run focused frontend/Functions tests, Rules tests, production build, secret and entrypoint checks, frontend policy checks and monitoring tests.

Before claiming device compatibility, verify physical iPhone/iPad Home Screen, Safari on macOS, Android Chrome, desktop Firefox and Edge on Windows. Test app foreground/closed, click return through login, permission revoke, disable/sign-out, beta versus production navigation, one notification per test, and declarative delivery with worker execution unavailable on an authorized test origin. Do not unregister a production worker or send tests without the applicable authorization. OS focus modes and notification settings affect delivery. Device verification is not established by unit tests or Chrome's synthetic push tool.

## Monitoring

Source-controlled coverage uses the shared `tools/monitoring/` provisioning framework. Preview without credentials:

```sh
node tools/web-push-monitoring/cli.mjs --project=quantified-self-io
```

An authorized operator applies the exact owned bundle with:

```sh
node tools/web-push-monitoring/cli.mjs --project=quantified-self-io --notification-channel=projects/quantified-self-io/notificationChannels/CHANNEL_ID --apply --confirm-project=quantified-self-io
```

The bundle selects only `sendtestpushnotification` in `europe-west2`, records fixed accepted/expired/failed categories, charts native requests and alerts on three genuine failures in fifteen minutes. Permission denial, rate limits, disabled configuration and expired registrations do not page. User-requested traffic has no heartbeat; idle/missing outcomes do not assert health and do not page. No queue exists, so backlog age/dead letters are inapplicable. Reapplication preserves unrelated resources through shared ownership checks. Thresholds should be reviewed after observed traffic.

For a failure, check enabled/default parameters, matching signing keys, runtime permissions and fixed outcomes. Never copy endpoints, payloads, key material, identifiers or raw HTTP responses to incident artifacts. Do not blindly resend or change rate state. Source definitions are prepared; live activation/readback must be tracked separately and is not implied by passing tests.

Review coverage is **unchanged** for the browser lifecycle and WNS compatibility fixes: the same callable, fixed outcomes, request counts, limits and alert thresholds cover all supported browser services. No worker, queue, scheduler or new telemetry label is introduced. Activation and physical-device verification remain tracked in [#1007](https://github.com/jimmykane/quantified-self/issues/1007).

## MCP and Training impact

No MCP tool, scope, response, consent or Training planning contract changes. Notifications contain no metrics or health data. Automatic Training notifications and their required MCP impact review remain outside this foundation.
