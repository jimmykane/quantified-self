# Account cleanup and disconnect recovery monitoring (#836)

Status: local implementation only. Nothing in this change deploys Functions, creates
cloud configuration, sends mail, disconnects a provider or deletes production data.
[#836](https://github.com/jimmykane/quantified-self/issues/836) remains open until its
separately approved deployment, activation and natural readback are recorded.

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
No production verification, cloud configuration or data mutation is claimed.

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
