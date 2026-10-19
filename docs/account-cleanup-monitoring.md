# Account cleanup and disconnect recovery monitoring (#836)

Status on 19 October 2026: the twelve affected existing Functions are deployed and
the nine metrics, seven enabled policies and dashboard are active under the owner's
explicit approval. API/query and identity-preservation readback passed. The first
natural **post-filter-correction heartbeat and Monitoring time series** are verified;
the approved production verification for #836 is complete. No account deletion, disconnect,
forced recovery, test mail, index or Rules deployment was performed for validation.

## Ownership and meanings

`tools/cleanup-monitoring/` reuses the shared `tools/monitoring/` provisioner. Owner
`qs-cleanup-monitoring-v1` has nine log metrics, seven policies and one dashboard,
**QS Account Cleanup & Disconnect Recovery**. It reuses an explicitly selected,
existing independent Alerts email channel, not the app's Trigger Email extension.
Training plan/workout deletion is already covered by #655 and is not duplicated.
Gen 1 migration remains #719; this change preserves existing runtime generations,
memory, secrets, leases, cursors, retry policies and schedules.

Runtime scope includes Gen 1/Gen 2 cleanup in `europe-west2` and the exact existing
Gen 2 `onSubscriptionUpdated` service in `europe-west3`. The latter can complete
disconnect/queue-release recovery when entitlement returns; its location must not
silently exclude those observations. Unrelated west3 Functions remain outside the
log metrics. No Function is relocated or added.

Cloud Logging evaluates `OR` before `AND`, including implicit whitespace conjunctions.
Keep the complete Gen 1 and Gen 2 filter branches parenthesized, and retain the
fixture evaluator's Logging-specific precedence. Without those branch parentheses,
Gen 1 constraints also apply to Gen 2 logs: the heartbeat disappears and Monitoring
rejects Gen 2 policy conditions. Validate actual API queries as well as fixtures.

The flows are intentionally different:

| Flow | What the observation establishes | What it does not establish |
| --- | --- | --- |
| `account` | Auth cleanup started, returned ACK, failed, or a local substage remained partial | Complete Delete User Data/Stripe extension cleanup, successful remote revocation, or a complete deletion audit |
| `disconnect` | Explicit local cleanup/finalization or subscription-retry outcome | Deletion of recorded provider activities, or successful remote cleanup merely because local tokens disappeared |
| `operational` | An existing `serviceDisconnectCleanup` page committed, completed, deferred, retried or was superseded | Deletion of another owner's data; complete global backlog coverage |
| `recovery` | Existing Health projection, route restoration, queue-release or scheduler outcome | Fresh imported data or automatic Training consent |

Explicit token cleanup emits `acknowledged`; only the existing finalization result
`cleared`/`root_missing` emits `completed`. Stale finalization is `superseded`.
Account `completed` observations are local provider-token substages, while the
whole Auth handler emits `acknowledged`. Counts are attempts/stages, not unique
accounts or exactly-once deletion totals. A partial stage can coexist with ACK
because pre-existing cleanup helpers deliberately continue after some failures.
No exception handling or deletion behavior is changed to make monitoring greener.

`remote_unconfirmed` means partner deauthorization failed or could not be established.
Revoked/expired access may make remote operations impossible. A dedicated policy
emails on the **first observation**, even when local cleanup succeeded or the last
local token has gone. The provider connection **may** remain active; telemetry does
not prove that it does. This is an operator-review signal, not remote deletion
success or an instruction to retry indefinitely. Existing local cleanup/retry
policy remains authoritative.

The shared partner-revocation handler records failures before subsequent local
deletion or metadata persistence. It covers all four providers' explicit disconnect,
subscription enforcement, account deletion and any requested terminal-auth revocation.
Token-resolution failures that prevent revocation are also unconfirmed; an expected
pending-disconnect token-use skip is excluded. A source failure and its returned
cleanup stage can both emit observations. These are not distinct accounts or separate
email sends: Cloud Monitoring controls incident notifications through the existing
Alerts email channel, not application mail writes. No extra scanner or token retention
is introduced. Previously lost credentials/connections are not retroactively inventoried.

## Observation boundary and costs

`functions/src/cleanup-monitoring.ts` contains logger-only helpers; it imports no
Firebase Admin, performs no network/Firestore operation and accepts no arbitrary
payload/error/identity bag. The new `[CleanupHealth]`, `telemetryVersion: 1` records
contain only allowlisted flow/provider/lane/outcome, validated numeric age or bounded
existing-page size/cap information. No UID, email, provider account, token, operation
digest, path, title, payload, credential or raw exception is added to metrics.

There are **zero extra Firestore reads or writes**, no new collection, index, Rules,
TTL, Function, observer, timer or schedule. The existing 30-minute
`retryPendingServiceDisconnects` emits page observations from reads it already does:
ten due operational intents; one expired explicit episode per provider; fifty due
subscription roots per provider; and twenty-five markers per lifecycle-repair lane.
Existing cursor wrap/recovery queries are unchanged. A full page is labelled capped,
not complete; an empty page after a cursor is not a global empty-queue assertion.
The page-size chart is examined rows, never eligible remaining backlog.
Idle scheduler runs emit heartbeat/page logs, not artificial success/failure work.

Operational retry telemetry is emitted only after the existing lease/lifecycle
transaction proves the intent is retained; stale/deleted replacement operations emit
superseded/deferred instead. Account deletion may legitimately leave operational
cleanup pending until credentials disappear. It never recreates user descendants.
Queue-release retries count only after the existing generation/deletion-guarded
repair write succeeds. Expected bounded queue/route pages and route-restoration
lifecycle supersession remain deferrals, not failures. Logger failures cannot change
original results, errors or retries.

Failure age is deliberately narrow:

- Operational retry: original credential-removal `cutoffAt`, never its renewable lease.
- Subscription retry: how overdue the captured `disconnectNextAttemptAt` was when
  processing resumed. This is not total episode age or ordinary future backoff.
- Queue-release retry: prior repair-attempt timestamp, only after guarded retry
  recording; this is a last-attempt delay lower bound, not episode creation age.
- Failed Auth retry: immutable trigger event timestamp, not user creation time.

Missing, malformed or future timing is omitted, never converted to healthy zero.
Completed deletion tombstones are never scanned, counted as pending or aged.
There is no new global account-deletion backlog inventory. An idle event-only Auth
handler must not have an absence alert; its native execution errors additionally
cover abrupt termination that cannot emit the structured outcome. Extension
completion remains an independent resource boundary, not inferred from Auth ACK.

Logging/Monitoring ingestion, active time-series storage and enabled alert policies
can incur normal platform charges. Incremental application Firestore cost is zero.
Steady idle work adds page coverage plus one heartbeat per existing scheduler run,
normally 14 small log entries per 30-minute run (672 per day), not a per-user/per-minute poll.
No billing savings or production peak-memory claim
is made from local tests.

## Metrics and initial alert thresholds

All log names use `qs_cleanup_<key>_v1`. The fixed provider labels are GarminAPI,
SuuntoApp, COROSAPI, WahooAPI and all. Lanes are operational, subscription, explicit,
health_projection, route_restore, queue_release, wahoo_release and scheduler.

| Key | Meaning |
| --- | --- |
| `outcomes` | Fixed outcome observations, with local completion and remote limitations separate |
| `failures` | Actual failed/partial stages and guarded retries; no expected deferrals or supersession |
| `remote_unconfirmed` | Failed/unconfirmed partner revocation; first-observation email policy, never a successful provider deletion |
| `manual_review` | Newly committed exhausted-disconnect transition, not repeatedly counted retained state |
| `overdue` | Validated failure observations exceeding the age gates below |
| `age` | Distribution of observed retry/failure age; absence of timing is unavailable |
| `pages` | Existing page coverage and cap categories |
| `examined` | Distribution of existing page sizes; not remaining backlog |
| `heartbeat` | Whole existing scheduler ACK/error; caught lane failures remain separate |

Seven policies use the existing email channel, OPENED/CLOSED notifications and
two-hour auto-close. Thresholds are starting values to tune against actual volume:

1. Account failure: three failed/partial stage observations per provider/lane in one
   hour, or three non-OK native `cleanupUserAccounts` executions in one hour.
2. Disconnect failure: three actual failures/retries per provider/lane/runtime in 24
   hours. The window respects the existing 30-minute, two-hour and six-hour backoff;
   five retries in six hours would miss one persistently failing episode. Normal
   future backoff and stale work do not page; remote revocation has its own policy.
3. Recovery failure: three local recovery/operational failures/retries, or two whole
   scheduler failures, in 90 minutes. Failed heartbeats never masquerade as healthy runs.
4. Overdue failure: two observations in six hours. Operational cutoff/Auth failed
   retry gates are 24 hours; overdue subscription/queue-release delay gates are six
   hours. Healthy incremental pagination and current leases do not page.
5. New exhausted disconnect: one newly committed manual-review transition in one
   hour. It is a new terminal condition requiring review, not a retained-row counter.
6. Missing scheduler heartbeat: two hours, only for the always-running existing
   scheduler, including idle. Requires an initial post-creation time series.
7. Partner revocation unconfirmed: one observation in one hour, sustained for 60
   seconds, per flow/provider/lane/runtime. This does not wait for three disconnect
   attempts or exhausted retries. Includes failures before local credentials disappear.

The dashboard keeps Gen 1 and Gen 2 series distinct. Neither HTTP success nor ACK
proves full account deletion. A bounded page cannot establish that all pending
cleanup is current. Native account execution statuses and actual structured failures
are separate, potentially overlapping diagnostics—not figures to sum as unique failures.

## Diagnosis and maintenance

Use the dashboard, existing Cloud Scheduler/Functions pages and private Logs Explorer.
Start with the aggregate flow/provider/lane; correlate exact cases privately through
existing execution logs. Inspect current pending intent/credential/connection guards,
not retained tombstones or last activity dates. A revoked provider can prevent remote
revocation while local cleanup still completes. Inspect caps/cursor coverage before
claiming a complete backlog or blindly re-driving an operation. Do not remove fences,
change retry schedules or replay/delete anything to silence a page.

For a partner-revocation email, check whether the provider still lists the connection
and whether a current credential remains. If credentials are gone, use the provider's
connected-app/revoke workflow (with the required account owner involvement) rather than
recreating credentials. Never describe an unconfirmed connection as definitely active
or send personal identifiers/tokens in alert mail. Normal incident auto-close only means
the recent signal stopped; it does not establish successful provider revocation.

When a new provider or recovery lane is added, update the fixed telemetry mapping,
definitions, tests and this runbook. Review current native runtime resource types and
preserve the independent Training alerts. Never add user/account labels.

MCP/Assistant/Training no-wire-impact review: no tool, schema, output, metric catalog,
scope, consent, provider action, completion link, public read, calculation or Training
mutation contract changes. This is operational telemetry around existing cleanup.
Services and account-deletion Help were reviewed; behavior/copy stays unchanged.
Concurrent Help edits from other work are not part of this ticket.

## Verification and separately approved activation

Local implementation and review verification on 19 October 2026: 389 focused Functions
tests (13 files), the complete 499-test/20-file `mcp-data` demo-emulator group with no skips, 94 offline
monitoring tests across all ten bundles, 17 workflow guards and 14 emulator-coverage
guards passed. Functions build, entrypoint contracts (180 endpoints/99 isolated targets),
deployment-source/70-secret-binding checks, credential scanning and diff checks passed.
Focused lint has no errors; existing explicit-any warnings in the lifecycle owners/specs
are unchanged. Review fixtures cover all four providers and four revocation reasons,
last-token removal, subscription retry retention, refresh failure, subsequent local failure,
expected token-use deferral and queue/route pagination. Provisioning also upgrades the
original six-policy bundle to seven without replacing existing condition identities.
Those implementation-only results do not establish production activation; the
separately approved production evidence is recorded below.

Local checks:

```bash
npm run test:cleanup-monitoring
npm --prefix functions test -- src/cleanup-monitoring.spec.ts src/users/cleanup.spec.ts src/OAuth2.spec.ts src/service-connection-meta.spec.ts src/service-disconnect-pending.spec.ts src/schedule/retry-pending-service-disconnects.spec.ts
npm run test:functions-emulators -- mcp-data
npm --prefix functions run build
npm --prefix functions run entrypoint:check:compiled
npm --prefix functions run deploy:safety:compiled
npm run test:workflows
git diff --check
```

Fixture tests exercise the actual filters; provisioning tests preserve all nine
existing monitoring bundles, policy/condition IDs, dashboard etags and channel data
on serial reapplication. The existing disconnect demo-emulator cases retain recursive
deletion, source/account/revision fencing, reconnect supersession, retained credential
waits and deletion-race behavior, with aggregate-only telemetry assertions.

Preview is offline and needs neither credentials nor channel:

```bash
node tools/cleanup-monitoring/cli.mjs --project=quantified-self-io
```

After **separate explicit deployment and monitoring-activation approval**, deploy
the existing affected cleanup/disconnect/recovery owners, then apply only this bundle:

```bash
node tools/cleanup-monitoring/cli.mjs --project=quantified-self-io --notification-channel=projects/quantified-self-io/notificationChannels/CHANNEL_ID --apply --confirm-project=quantified-self-io
```

Use the already verified independent Alerts channel, not a new channel or app-mail
record. Production scope/readback must record deployed source, exact Function names,
unchanged runtimes/secrets/schedules, nine metrics, dashboard, seven enabled policies,
all actual chart/condition query validity, stable resource/condition IDs after serial
reapply, and preservation of unrelated monitoring/channels. Wait for a **natural**
30-minute heartbeat plus positive post-creation Monitoring series and page coverage.
Record naturally occurring outcomes where available; idle data is not failure or
proof of a real deletion. Reuse #655's same-channel OPENED/CLOSED email evidence.
No account deletion, disconnect, forced cleanup, provider call, fabricated telemetry,
test email, data/resource deletion or migration is authorized by this runbook.

### Approved deployment and activation — 19 October 2026

The owner explicitly approved deploying the affected Functions, enabling the alerts,
and closing #836 only after healthy natural evidence. All twelve existing endpoints
were independently read back **ACTIVE** after deployment at approximately 10:34 UTC:

- `cleanupUserAccounts`
- `retryPendingServiceDisconnects`
- `deauthorizeGarminAPI`, `deauthorizeSuuntoApp`, `deauthorizeCOROSAPI`, `deauthorizeWahooAPI`
- `requestAndSetGarminAPIAccessToken`, `requestAndSetSuuntoAPIAccessToken`,
  `requestAndSetCOROSAPIAccessToken`, `requestAndSetWahooAPIAccessToken`
- `enforceSubscriptionLimits`
- `onSubscriptionUpdated`

All remain in `europe-west2` except the existing `onSubscriptionUpdated` trigger in
`europe-west3`. Before/after comparisons preserved generation, memory, CPU, timeout,
concurrency, instance limits, service accounts, environment/secret bindings, ingress
and both scheduler configurations. In particular, the existing 1024 MiB subscription
enforcer was not reduced or otherwise tuned. No Function was added, relocated or deleted.
The recovery scheduler retains its every-30-minute schedule, with this deployment's
natural phase at UTC `:07`/`:37`; the subscription enforcer retains every 24 hours.

The original mixed-runtime filter exposed an `OR`-precedence defect during live
policy validation. Its complete branches and the fixture evaluator were corrected;
no additional Functions deployment was needed for that configuration-only fix.
All twelve cleanup-monitoring tests and all 97 tests across the ten monitoring
bundles then passed. Predeployment verification also passed 392 focused Functions
tests, Functions build, the 180-endpoint/99-isolated entrypoint contract, deployment
package and 70-secret-binding checks. Backend source was unchanged from the earlier
499-test `mcp-data` emulator proof; no emulator used production data.

The corrected bundle was applied and serially reapplied. Readback at 10:46 UTC verified:

- Nine owned log metrics, seven enabled policies with thirteen conditions, and the
  [QS Account Cleanup & Disconnect Recovery dashboard](https://console.cloud.google.com/monitoring/dashboards/builder/d9691446-d27f-49aa-8125-113de0ed7d6f?project=quantified-self-io).
- All 29 actual chart/condition queries accepted by Cloud Monitoring, including
  both Gen 1 and Gen 2 resources. Policy and condition IDs and dashboard identity
  remained stable on serial application, without duplicate creation.
- Existing independent Alerts email channel
  `projects/quantified-self-io/notificationChannels/7874469028377828627` enabled and
  retained for OPENED/CLOSED notifications. Reuse #655's recorded email-delivery
  evidence; no new channel, test mail or app-mail record was created.
- Unrelated-resource fingerprints unchanged: all 116 pre-existing log metrics,
  62 policies, ten dashboards and all four channels. Project totals after this
  bundle are 125 metrics, 69 policies, eleven dashboards and four channels.

The natural 10:37:04 UTC run on `retrypendingservicedisconnects-00101-zab` emitted
one acknowledged heartbeat and all thirteen existing bounded-page observations:
operational, four lifecycle-repair lanes, explicit disconnect for each provider and
subscription retry for each provider. Each examined zero rows and was uncapped;
no cleanup failure, remote-unconfirmed or manual-review observation was emitted.
This proves idle runtime coverage, not actual deletion or provider revocation.
That run preceded the filter correction and **does not** prove positive Monitoring
ingestion under the corrected filter.

Final bounded read-only verification at **11:08–11:09 UTC (14:08–14:09 Helsinki)**
confirmed the next natural run's acknowledged heartbeat at **11:07:06.788701 UTC**
on the same revision. All thirteen expected page categories were present, examined
zero rows and were uncapped. Post-correction Cloud Monitoring reads contained a
positive acknowledged `qs_cleanup_heartbeat_v1` series and thirteen positive
`qs_cleanup_pages_v1` series covering operational, all four lifecycle-repair lanes,
and explicit/subscription pages for each of Garmin, Suunto, COROS and Wahoo. Neither
Logging nor Monitoring queries were truncated. There were no failed/partial/retry,
remote-unconfirmed or manual-review observations in this verification window;
event-only outcome series were correctly absent during idle, not fabricated zeros
or proof of a completed deletion.

The final configuration readback reconfirmed all nine metrics, seven enabled
policies/thirteen conditions, all 29 chart/condition queries, stable identities,
the existing enabled Alerts channel and unchanged unrelated-resource fingerprints.
One transient Monitoring HTTP 503 was retried read-only and succeeded; no cloud
configuration was reapplied during the natural-heartbeat check. Existing #655
same-channel OPENED/CLOSED delivery evidence was reused without sending mail.
All twelve focused cleanup-monitoring tests and the documentation diff check passed.
No manual recovery invocation, destructive QA, source-data change or provider call
was used to obtain this evidence. This completes the approved operational scope,
not proof of a real user deletion, extension completion or partner revocation.
