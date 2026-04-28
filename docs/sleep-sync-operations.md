# Sleep Sync Operations

Sleep sync is controlled independently from activity sync. The v1 sleep pipeline supports
Garmin, Suunto, and COROS, but Garmin and COROS can be temporarily disabled while their
sleep payloads are not actively testable.

## Provider Kill Switch

Use the `SLEEP_SYNC_DISABLED_PROVIDERS` environment variable to disable sleep sync for
one or more providers.

Current temporary setting:

```bash
SLEEP_SYNC_DISABLED_PROVIDERS=GarminAPI,COROSAPI
```

Accepted values are comma- or space-separated. Canonical provider names and short aliases
are supported:

- `GarminAPI` or `garmin`
- `COROSAPI` or `coros`
- `SuuntoApp` or `suunto`
- `all`
- `none` or an empty value to enable all providers

This flag only affects sleep sync. Existing activity sync behavior for Garmin, Suunto, and
COROS is unchanged.

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

## Local Development

For local emulator runs, set the flag in the ignored `functions/.env` file:

```bash
SLEEP_SYNC_DISABLED_PROVIDERS=GarminAPI,COROSAPI
```

Restart the Functions emulator after changing the value.

## Deployed Functions

The Functions code reads `SLEEP_SYNC_DISABLED_PROVIDERS` from `process.env`. For deployed
environments, set or remove the variable using the same Firebase/Google Cloud environment
configuration flow used for the other Functions secrets and runtime variables.

If deploying with Firebase CLI dotenv files, put the value in the project-specific
Functions env file before deploy:

```bash
# functions/.env.<project-id>
SLEEP_SYNC_DISABLED_PROVIDERS=GarminAPI,COROSAPI
```

To re-enable Garmin and COROS, remove the line, set it to `none`, or set it to an empty
value before redeploying.

## Re-Enable Garmin And COROS Sleep

1. Remove the provider names from `SLEEP_SYNC_DISABLED_PROVIDERS`, set it to `none`, or
   unset it entirely.

   ```bash
   SLEEP_SYNC_DISABLED_PROVIDERS=none
   ```

2. Deploy or restart the Functions runtime so the new environment value is loaded.
3. Verify logs no longer show `Provider disabled by SLEEP_SYNC_DISABLED_PROVIDERS` for
   Garmin or COROS sleep work.
4. For COROS, wait for the next `scheduleCOROSSleepSync` run or trigger the scheduled
   function manually in the Firebase console.
5. For Garmin, confirm the Garmin Health API sleep webhook is configured and send a test
   sleep push or ping payload from Garmin's tooling if available.
6. Check `users/{uid}/sleepSyncState/{provider}` and `users/{uid}/sleepSessions` for new
   sleep sync state and sessions.

## Disable Again

To pause Garmin and COROS sleep sync again:

```bash
SLEEP_SYNC_DISABLED_PROVIDERS=GarminAPI,COROSAPI
```

Then deploy or restart the Functions runtime.
