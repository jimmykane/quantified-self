# Sleep Sync Operations

Sleep sync is controlled independently from activity sync. The v1 sleep pipeline supports
Garmin, Suunto, and COROS, but Garmin and COROS are currently disabled in code while their
sleep payloads are not actively testable. Suunto sleep sync is enabled for all connected
Suunto users.

## Provider Kill Switch

Sleep provider disablement is source controlled in:

```text
functions/src/sleep/provider-flags.ts
```

Current temporary setting:

```ts
export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [
    SLEEP_PROVIDERS.GarminAPI,
    SLEEP_PROVIDERS.COROSAPI,
];
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

## Re-Enable Garmin And COROS Sleep

1. Edit `functions/src/sleep/provider-flags.ts`.
2. Remove `SLEEP_PROVIDERS.GarminAPI` and `SLEEP_PROVIDERS.COROSAPI` from
   `SLEEP_SYNC_DISABLED_PROVIDERS`.

   ```ts
   export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [];
   ```

3. Update the provider flag tests to match the new constant, then run the targeted sleep
   Functions tests and the Functions build.
4. Deploy or restart the Functions runtime so the changed constant is loaded.
5. Verify logs no longer show `Provider disabled by SLEEP_SYNC_DISABLED_PROVIDERS` for
   Garmin or COROS sleep work.
6. For COROS, wait for the next `scheduleCOROSSleepSync` run or trigger the scheduled
   function manually in the Firebase console.
7. For Garmin, configure the Health API sleep endpoint as a Ping/Pull notification. Direct
   Push sleep summaries are rejected in v1 because Garmin does not provide an authenticated
   push signature in the local docs; the worker only persists Garmin sleep data after pulling
   it from a Garmin-owned callback URL with the user's stored token.
8. Check `users/{uid}/sleepSyncState/{provider}` and `users/{uid}/sleepSessions` for new
   sleep sync state and sessions.

## Disable Again

To pause Garmin and COROS sleep sync again, restore:

```ts
export const SLEEP_SYNC_DISABLED_PROVIDERS: readonly SleepProvider[] = [
    SLEEP_PROVIDERS.GarminAPI,
    SLEEP_PROVIDERS.COROSAPI,
];
```

Then deploy or restart the Functions runtime.
