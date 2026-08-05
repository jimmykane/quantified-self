# Firebase Function Secret Management

Quantified Self deploys backend credentials through Google Cloud Secret Manager and Firebase `defineSecret()` bindings. A Function receives only the secrets declared for that endpoint in `functions/src/secrets.ts`; an endpoint absent from the policy must receive none.

## Managed inventory

| Area | Secret Manager names |
| --- | --- |
| COROS | `COROSAPI_CLIENT_ID`, `COROSAPI_CLIENT_SECRET` |
| Garmin | `GARMINAPI_CLIENT_ID`, `GARMINAPI_CLIENT_SECRET` |
| Suunto | `SUUNTOAPP_CLIENT_ID`, `SUUNTOAPP_CLIENT_SECRET`, `SUUNTOAPP_SUBSCRIPTION_KEY`, `SUUNTOAPP_NOTIFICATION_SECRET` |
| Wahoo | `WAHOOAPI_CLIENT_ID`, `WAHOOAPI_CLIENT_SECRET`, `WAHOOAPI_WEBHOOK_TOKEN`, `WAHOOAPI_ALLOWED_FILE_HOSTS` |
| Stripe | `STRIPE_SECRET_KEY` |
| Built-in Assistant | `GEMINI_API_KEY` |
| Backend geocoding | `MAPBOX_ACCESS_TOKEN` |

Do not put these values in `functions/.env`, workflow YAML, repository documentation, or service-account files. Secret existence can be checked with `firebase functions:secrets:get NAME`; do not print or retrieve values during routine validation.

## Local emulators and scripts

Copy `functions/.secret.local.example` to `functions/.secret.local` and add development-only values. The destination is ignored by Git and excluded from Function deployment archives.

```bash
cp functions/.secret.local.example functions/.secret.local
npm --prefix functions run build
firebase emulators:start --only auth,functions,firestore,storage
```

Firebase's Functions emulator uses `.secret.local` for bound secret parameters. Never copy production credentials into an emulator checkout: provider calls and background workers can still reach real external services.

Repository operational scripts load local values in this order without overriding an existing shell variable:

1. `functions/.secret.local`
2. `functions/.env.local`
3. legacy `functions/.env`

The legacy file remains a local-script compatibility fallback only. Deployed runtime code does not load dotenv, and every local environment or secret file is excluded from upload archives. Deployment preflight deliberately fails while any `.env*`, `.runtimeconfig.json`, or service-account file is present in the Functions source, because Firebase can otherwise convert dotenv files back into ordinary runtime environment variables even when the archive ignore list excludes them.

## Adding or changing a secret

1. Create the Secret Manager entry in the target project through the Cloud console or `firebase functions:secrets:set NAME`.
2. Add its `defineSecret()` registration to `SECRET_PARAMS` in `functions/src/secrets.ts`.
3. Add it only to the endpoints that directly or transitively require it in `FUNCTION_SECRET_BINDINGS`.
4. Add an empty entry to `functions/.secret.local.example` and update this inventory.
5. Add positive and negative policy fixtures, then run:

```bash
npm --prefix functions test -- src/secrets.spec.ts src/deployment-secret-safety.spec.ts
npm --prefix functions run secrets:check
```

The compiled check loads every exported Firebase Function and compares its generated `secretEnvironmentVariables` metadata with the policy. It fails for missing bindings, extra bindings, duplicate bindings, policy entries without an exported endpoint, or a secret on an endpoint that defaults to no access. The Firebase codebase also sets `disallowLegacyRuntimeConfig: true`, preventing deprecated Cloud Runtime Config values from being generated into `.runtimeconfig.json` during v1 Function packaging.

## One-command production cutover

Confirm all managed names have an enabled version, run the complete local verification suite, and deploy every repository-defined Function in one command:

```bash
npm --prefix functions test
npm --prefix functions run build
npm --prefix functions run secrets:check:compiled
npm --prefix functions run mcp:contract:check:compiled
firebase deploy --only functions --dry-run --project quantified-self-io
firebase deploy --only functions --project quantified-self-io
```

The final command requires explicit production approval. Firebase submits all Functions from one command, but updates are not transactionally atomic. If an endpoint update fails, correct the binding or deployment error and rerun the complete Functions deployment; do not switch to an improvised mixture of secret and `.env` configuration.

This project previously stored provider credentials in deprecated Firebase Runtime Config under `suuntoapp`, `corosapi`, and `garminhealthapi`. `disallowLegacyRuntimeConfig` prevents those values from entering new source archives, but it does not delete the old cloud-side copies. After the complete Functions deployment succeeds, remove the obsolete namespaces in the same approved cutover window:

```bash
firebase functions:config:unset suuntoapp corosapi garminhealthapi --project quantified-self-io
```

Do not run the unset command before the new Secret Manager-bound revision has deployed successfully. It is cleanup of the retired store, not a substitute for the Functions deployment.

After deployment, verify representative OAuth, webhook, background-worker, Stripe, Assistant, MCP geocoding, sleep, cleanup, and subscription-enforcement paths. Also confirm the deployed source archive contains no `.env`, `.secret.local`, service-account JSON, debug log, or emulator export.

## Rollback and rotation

Do not redeploy a pre-migration revision unchanged: it does not declare Secret Manager bindings and would lose access to credentials once `.env` packaging is removed. Roll back application behavior while retaining `functions/src/secrets.ts`, the endpoint bindings, and the upload exclusions, then redeploy all Functions.

To rotate a credential, add a new enabled Secret Manager version, deploy every Function listed for that name in `FUNCTION_SECRET_BINDINGS`, verify the provider path, and only then disable the previous version. Never delete the currently deployed version before replacement Functions are healthy.
