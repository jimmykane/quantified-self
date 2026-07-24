# Sleep Sync Operations

Sleep sync is controlled independently from activity sync. The v1 sleep pipeline supports
Garmin, Suunto, and COROS. All three providers are enabled for every connected user.

COROS runs `scheduleCOROSSleepSync` every 24 hours. It queues a rolling seven-day daily-data
poll for each connected COROS account. The documented COROS endpoint provides sleep start/end
times, average sleep heart rate, resting heart rate, overnight HRV, and optional HRV samples.
It does not provide sleep-stage intervals, so COROS sessions retain their duration as an
unknown stage rather than inferred Light, Deep, REM, or Awake stages.

## Provider Kill Switch

Sleep provider disablement is source controlled in:

```text
functions/src/sleep/provider-flags.ts
```

Current setting:

```ts
export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [];
```

This constant only affects sleep sync. Existing activity sync behavior for Garmin, Suunto,
and COROS is unchanged.

## User Rollout

Sleep user rollout is also source controlled in:

```text
functions/src/sleep/provider-flags.ts
```

Current setting:

```ts
export const SLEEP_SYNC_ALLOWED_USER_IDS: readonly string[] = [];
```

An empty allowlist means all users. To scope sleep sync again, add Firebase UIDs to this
constant and deploy/restart the Functions runtime.

## What Disabled Means

When a provider is disabled:

- Provider webhook handlers acknowledge sleep webhooks but do not enqueue sleep work.
- Provider polling jobs skip creating sleep queue items.
- Already queued sleep work for that provider is marked processed with
  `resultStatus: provider_disabled`, `providerDisabled: true`, and zero written sessions.
- The worker does not call the provider API for disabled sleep queue items.

Skipped queue items are intentionally not retried after re-enabling. After the provider is
enabled again, new webhooks and scheduled polling runs are expected to create fresh work.
COROS and Suunto polling use a rolling recent window, so recent data can be picked up on
the next poll. Garmin sleep data relies on Garmin Health API webhook delivery in v1.

## Routine Verification

1. For COROS, wait for the next `scheduleCOROSSleepSync` run or trigger the scheduled
   function manually in the Firebase console.
2. Verify new COROS queue items complete successfully and `users/{uid}/sleepSyncState/COROSAPI`
   shows a recent `lastPollAtMs` and `lastSyncedAtMs`.
3. Check `users/{uid}/sleepSessions` for sessions with the COROS source. The current endpoint
   does not provide sleep stages, scores, naps, or in-bed duration.
4. For Garmin, configure the Health API sleep endpoint as a Ping/Pull notification. Direct
   Push sleep summaries are rejected in v1 because Garmin does not provide an authenticated
   push signature in the local docs; the worker only persists Garmin sleep data after pulling
   it from a Garmin-owned callback URL with the user's stored token.

## Temporarily Disable A Provider

To pause COROS sleep sync, add it to the disabled-provider list:

```ts
export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [
    SLEEP_PROVIDERS.COROSAPI,
];
```

Update the provider flag tests and deploy or restart the Functions runtime. Restore the empty
list to re-enable it. Queued items skipped while disabled are intentionally not retried; the
next daily COROS poll will request the rolling recent window again.
