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

## Source-control guardrails

Install the repository hooks with `npm run hooks:install` and install [Gitleaks](https://github.com/gitleaks/gitleaks) locally. Every commit rejects credential-like file names (dotenv, local secret, Runtime Config, service-account, Firebase Admin SDK, and private-key files) and scans staged content for hard-coded credentials. The only allowed local-secret template is the value-free `functions/.secret.local.example`.

CI scans the commits introduced by each push or pull request with a pinned Gitleaks version. It does not re-scan the entire historical repository on every change. A detector finding must be treated as a possible credential exposure: rotate a real value first; add a reviewed fingerprint to `.gitleaksignore` only for a documented false positive.

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

## Deployed environment cleanup

An older Firebase deployment may have copied local dotenv or Runtime Config credentials into every deployed Function as ordinary environment variables. Adding a `defineSecret()` binding with the same name then fails with `Secret environment variable overlaps non secret environment variable`. Removing the local file does not remove those already-deployed bindings.

Use the repository migration before the first complete Secret Manager deployment, and rerun it whenever an audit finds a legacy ordinary binding. It compares and prints only credential names, never prints values, and defaults to a dry run. It updates every repository endpoint with managed plaintext or a Secret Manager policy mismatch, including cleanup-only revisions for endpoints that require no secrets. Each update removes legacy ordinary environment variables and, when required, attaches the endpoint's complete least-privilege Secret Manager policy in the same Function revision. It reuses the already-deployed Cloud Storage source archive; it does not upload the current checkout.

```bash
npm --prefix functions run secrets:migrate-deployed -- \
  --project=quantified-self-io \
  --regions=europe-west2,europe-west3
```

Review the reported endpoint and credential names. The apply mode is a production mutation and requires separate explicit approval plus an exact project confirmation:

```bash
npm --prefix functions run secrets:migrate-deployed -- \
  --project=quantified-self-io \
  --regions=europe-west2,europe-west3 \
  --apply \
  --confirm-project=quantified-self-io
```

The migration uses existing enabled Secret Manager versions and does not create, replace, retrieve, print, or rotate secret values. It is idempotent, but Function updates are not globally atomic; if one fails, fix the reported error and rerun the same command. Do not delete ordinary bindings in a separate command, because that creates an avoidable interval where the affected Function has no credential source.

## Complete production cutover

Confirm all managed names have an enabled version, run the complete local verification suite, and deploy every repository-defined Function in one command:

```bash
npm --prefix functions test
npm --prefix functions run build
npm --prefix functions run secrets:check:compiled
npm --prefix functions run mcp:contract:check:compiled
firebase deploy --only functions --dry-run --project quantified-self-io
firebase deploy --only functions --project quantified-self-io
npm --prefix functions run secrets:migrate-deployed -- \
  --project=quantified-self-io \
  --regions=europe-west2,europe-west3 \
  --require-clean
```

The non-dry-run Firebase command requires explicit production approval. Firebase submits all Functions from one command, but updates are not transactionally atomic. If an endpoint update fails, correct the binding or deployment error and rerun the complete Functions deployment; do not switch to an improvised mixture of secret and `.env` configuration. The final audit must report no repository endpoint with a managed credential in ordinary environment variables, no missing or extra Secret Manager binding, and no repository endpoint missing from the deployed region.

This project previously stored provider credentials in deprecated Firebase Runtime Config under `suuntoapp`, `corosapi`, and `garminhealthapi`. `disallowLegacyRuntimeConfig` prevents those values from entering new source archives, but it does not delete the old cloud-side copies. After the complete Functions deployment succeeds, remove the obsolete namespaces in the same approved cutover window:

```bash
firebase functions:config:unset suuntoapp corosapi garminhealthapi --project quantified-self-io
```

Do not run the unset command before the new Secret Manager-bound revision has deployed successfully. It is cleanup of the retired store, not a substitute for the Functions deployment.

After deployment, verify representative OAuth, webhook, background-worker, Stripe, Assistant, MCP geocoding, sleep, cleanup, and subscription-enforcement paths. Also confirm the deployed source archive contains no `.env`, `.secret.local`, service-account JSON, debug log, or emulator export.

## Rollback and rotation

Do not redeploy a pre-migration revision unchanged: it does not declare Secret Manager bindings and would lose access to credentials once `.env` packaging is removed. Roll back application behavior while retaining `functions/src/secrets.ts`, the endpoint bindings, and the upload exclusions, then redeploy all Functions.

To rotate a credential, add a new enabled Secret Manager version, deploy every Function listed for that name in `FUNCTION_SECRET_BINDINGS`, verify the provider path, and only then disable the previous version. Never delete the currently deployed version before replacement Functions are healthy.
