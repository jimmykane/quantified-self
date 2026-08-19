# Quantified Self

![Testing](https://github.com/jimmykane/quantified-self/actions/workflows/testing.yaml/badge.svg)

**Quantified Self** is an open-source platform for collecting, analyzing, and visualizing fitness and health data. It combines activity imports and connected fitness services with dashboards, training insights, route tools, sleep trends, and detailed workout analysis.

Try the hosted app at [quantified-self.io](https://www.quantified-self.io/).

## Highlights

- Import activity files in FIT, GPX, TCX, JSON, and SML formats.
- Connect Garmin, Suunto, COROS, and Wahoo for supported activity, route, sleep, and history workflows.
- Explore configurable dashboards, training readiness, load trends, power curves, intensity zones, laps, and durability metrics.
- View activities and saved routes with Mapbox-powered maps and route tools.
- Compare recordings from multiple devices, share selected activities, and export your data.
- Ask grounded fitness-data questions through the built-in Assistant.

## Technology and repository layout

| Area | Technology |
| --- | --- |
| Frontend | Angular 20, Angular Material, RxJS |
| Backend | Firebase Auth, Firestore, Functions, Storage, Hosting, App Check, and Remote Config |
| Visualization | ECharts and Mapbox GL JS |
| Activity parsing | [`@sports-alliance/sports-lib`](https://github.com/sports-alliance/sports-lib) |
| Testing | Vitest and Firebase Rules Unit Testing |

The main repository areas are:

| Path | Purpose |
| --- | --- |
| `src/app/` | Angular application, routes, components, and browser services |
| `functions/src/` | Firebase Functions, queues, integrations, and scheduled jobs |
| `shared/` | Contracts and helpers shared by the browser and Functions runtimes |
| `extensions/` | Firebase Extension configuration |
| `docs/` | Architecture, product rules, and operational documentation |
| Repository root | Firebase rules, indexes, Hosting configuration, and build tooling |

## Prerequisites

Install:

- Git.
- Node.js 20.19 or later in the Node 20 line. The committed `.nvmrc` selects Node 20, so `nvm use` matches the frontend CI environment.
- npm, which is included with Node.js.
- Java 21 for the Firestore and Storage emulators.
- A [Mapbox public access token](https://docs.mapbox.com/help/getting-started/access-tokens/) for local maps and geocoding.

The repository pins its own Firebase CLI; do not install or log in to a global CLI for the local workflow. [Gitleaks](https://github.com/gitleaks/gitleaks) is additionally required when committing through the repository hooks.

> [!NOTE]
> `functions/package.json` declares Node.js 22 as the Cloud Functions runtime. Installing Functions dependencies under Node 20 may show an engine warning. Use Node 22 when developing or deploying Functions runtime behavior; the root `.nvmrc` remains the frontend and CI default.

## Quick start

### Choose a runtime mode

| Mode | Entry point | Services and data | Intended use |
| --- | --- | --- | --- |
| Isolated demo (recommended) | Follow the steps below and run `npm start` | Disposable `demo-quantified-self-local` project, loopback emulators, and synthetic roles without Stripe | Normal contributor development |
| Hosted project (maintainers only) | See [Intentional hosted opt-in](docs/local-development.md#intentional-hosted-opt-in) | Real hosted Firebase configuration; the app can read and write hosted resources | Narrow, explicitly confirmed maintainer debugging |
| Self-hosted deployment | See [Deployment and self-hosting](#deployment-and-self-hosting) | A fork owner's Firebase project, provider accounts, secrets, domains, and infrastructure | Advanced operators; not a turnkey setup |

The Quick Start below is exclusively for the isolated demo mode. Do not substitute the hosted-project workflow into these steps.

### 1. Clone and install

```bash
git clone https://github.com/jimmykane/quantified-self.git
cd quantified-self
npm ci
npm --prefix functions ci
```

Activate Node 20.19 or later in the Node 20 line before installing (`nvm use` on systems with nvm). The root application and Functions use separate lockfiles, so both installs are required for the full development workflow.

### 2. Create the ignored local files

Copy the safe Mapbox template:

macOS/Linux:

```bash
cp src/environments/mapbox-token.local.example.ts src/environments/mapbox-token.local.ts
```

Windows PowerShell:

```powershell
Copy-Item src/environments/mapbox-token.local.example.ts src/environments/mapbox-token.local.ts
```

Edit only `src/environments/mapbox-token.local.ts` and replace `YOUR_PUBLIC_MAPBOX_TOKEN` with your own `pk.*` public Mapbox token. On first start, the launcher creates `functions/.secret.local` from its safe sentinel template if the file is missing. Do not edit the `LOCAL_EMULATOR_DISABLED` values: they stop Firebase from falling back to Secret Manager.

The copied Mapbox file and generated Functions secret file are ignored by Git. Never put a maintainer credential, production secret, service-account file, or private user data in a local checkout.

### 3. Start the isolated app

Run one command from the repository root:

```bash
npm start
```

Open:

- Application: [http://127.0.0.1:4200](http://127.0.0.1:4200)
- Firebase Emulator UI: [http://127.0.0.1:4000](http://127.0.0.1:4000)

`npm start` validates the local-only configuration, refuses real Firebase project IDs, inherited cloud credentials, backend secrets, linked secret placeholders, non-public Mapbox tokens, unsupported hosts, occupied ports, unsafe saved-state links, and Functions environment, runtime-config, or service-account files. It then builds Functions and starts Angular plus the Auth, Firestore, Storage, Functions, and Cloud Tasks emulators. The first run downloads the Firebase emulator binaries.

Sign in with a fake local identity. Email magic links appear in the emulator output/UI instead of being sent; Google and GitHub use the Auth emulator's mock provider flow. Complete onboarding normally. No real Firebase account or OAuth login is needed.

Press Ctrl+C once to stop the stack and export emulator state. The next `npm start` imports it automatically.

### 4. Test Free and Pro locally without Stripe

Local accounts start on Free. After creating an account and completing onboarding, change only that fake account's synthetic role from another terminal:

```bash
npm run local:role -- --email you@example.com --role pro
npm run local:role -- --email you@example.com --role free
```

The command requires the emulators to be running. It writes a local-only subscription document and Auth claim; it never creates a Stripe customer, checkout, invoice, payment, or portal session. Refresh or sign in again if the displayed role does not update immediately.

### 5. Verify or reset

Run the disposable full-stack smoke test while `npm start` is stopped:

```bash
npm run local:smoke
```

It proves local Auth, Firestore, synthetic Pro-to-Free roles, Storage, a callable Function, and an authenticated upload endpoint work together without App Check. To erase saved emulator data, stop the stack and run:

```bash
npm run local:reset
```

This reset is not recoverable unless you copied `.local/firebase-emulator-data` yourself. Clear browser site data for `127.0.0.1` separately if you also want to remove cached browser state.

### Local boundary

| Capability | Local behavior |
| --- | --- |
| Firebase project | Fixed `demo-quantified-self-local` project; non-emulated Firebase services fail closed |
| Auth, Firestore, Storage, Functions, Tasks | Loopback emulators only |
| Stripe and billing | Disabled in the UI and service layer; use `npm run local:role` |
| App Check | Disabled only inside the Functions emulator; hosted configurations retain enforcement |
| Analytics, Remote Config, Performance, Sentry | Disabled |
| Hosting, Extensions, Secret Manager | Not configured or started |
| Garmin, Suunto, COROS, Wahoo, Gemini, backend Mapbox, email delivery | Credentials disabled; cloud-backed workflows are not part of the isolated local setup |
| Browser maps/geocoding | Uses the public Mapbox token you supplied and can contact Mapbox |

This workflow is for development, not turnkey self-hosting. See [Isolated local development](docs/local-development.md) for the security model, command reference, persistence behavior, and maintainer notes.

## Hosted backend and provider configuration

Provider credentials are intentionally unsupported by the isolated `npm start` path. The launcher rejects real values in `functions/.secret.local` and masks workstation Google credentials before starting child processes. Maintainers testing a provider must use a separately reviewed workflow and development-only provider accounts; never weaken the default local guard or reuse production credentials. See [Firebase Function secret management](docs/function-secret-management.md) and the [provider integration guide](docs/provider-integration-guide.md).

Operational scripts that intentionally access managed Google Cloud or Firebase resources use Application Default Credentials. Authenticate your local user with `gcloud auth application-default login`, or use an approved least-privilege service-account impersonation flow, and pass the target project explicitly to any write-capable script. Emulator-only development does not require this login.

| Feature | Configuration names |
| --- | --- |
| Garmin | `GARMINAPI_CLIENT_ID`, `GARMINAPI_CLIENT_SECRET` |
| Suunto | `SUUNTOAPP_CLIENT_ID`, `SUUNTOAPP_CLIENT_SECRET`, `SUUNTOAPP_SUBSCRIPTION_KEY`, `SUUNTOAPP_NOTIFICATION_SECRET` |
| COROS | `COROSAPI_CLIENT_ID`, `COROSAPI_CLIENT_SECRET` |
| Wahoo | `WAHOOAPI_CLIENT_ID`, `WAHOOAPI_CLIENT_SECRET`, `WAHOOAPI_WEBHOOK_TOKEN`, `WAHOOAPI_ALLOWED_FILE_HOSTS` |
| Stripe | `STRIPE_SECRET_KEY` |
| Built-in Assistant | `GEMINI_API_KEY` |
| Backend Mapbox access | `MAPBOX_ACCESS_TOKEN` |
| Optional task emulator | `CLOUD_TASKS_EMULATOR_HOST` |
| Release source maps | `SENTRY_AUTH_TOKEN` |

Never commit environment files, service-account JSON, API tokens, private keys, decrypted credentials, personal data, or production exports.

## Development commands

| Purpose | Command | Notes |
| --- | --- | --- |
| Start the isolated local stack | `npm start` | Builds Functions, starts all required emulators and Angular, and persists emulator state on exit |
| Verify local safety configuration | `npm run local:config:test` | Tests project, endpoint, credential, and CLI-argument guards |
| Run disposable local smoke test | `npm run local:smoke` | Verifies a synthetic Pro-to-Free transition too; requires the local stack to be stopped and never imports or exports persistent state |
| Change a fake local role | `npm run local:role -- --email you@example.com --role pro` | Accepts `free` or `pro`; requires the stack to be running and never calls Stripe |
| Erase saved local emulator state | `npm run local:reset` | Requires the stack to be stopped; browser site data is separate |
| Frontend tests once | `npm test -- --run` | Deterministic command used by CI |
| Frontend tests in watch mode | `npm test` | Keeps Vitest running |
| Frontend coverage | `npm run test-coverage` | Writes the coverage report locally |
| Frontend lint | `npm run lint` | Angular ESLint |
| Firestore and Storage Rules tests | `npm run test:rules` | Uses the isolated `demo-test` emulator project |
| Frontend build | `npm run build` | Development build |
| Production build | `npm run build-production` | Builds locally; does not deploy |
| Functions tests | `npm --prefix functions test` | One-shot Vitest suite |
| Functions coverage | `npm --prefix functions run test:coverage` | Writes the Functions coverage report |
| Functions build | `npm --prefix functions run build` | Compiles TypeScript to `functions/lib` |
| Functions lint | `npm --prefix functions run lint` | Runs ESLint with `--fix` and may edit files |
| Install Git hooks | `npm run hooks:install` | Reinstalls the repository Lefthook hooks; `npm ci` normally installs them automatically |
| Test the local credential guard | `npm run credentials:test` | Checks the staged-file rejection policy without reading credential values |
| MCP pre-push checks | `npm run hooks:mcp:pre-push` | Runs the registered-contract gate and focused MCP output/server tests |
| Local plugin tooling | `npm run plugin:tools` | Installs the isolated pinned Codex CLI dependency |
| Local plugin setup | `npm run plugin:setup` | Explicitly builds, validates, registers, and installs the configured plugin |
| Local plugin validation | `npm run plugin:validate` | Uses an isolated temporary Codex profile |
| Local plugin refresh | `npm run plugin:sync` | Explicitly rebuilds and reinstalls; normal app builds never do this |

The repository-local Quantified Self plugin bundles the registered read-only MCP app with six discoverable workflows
for cross-domain analysis, training, sleep, body measurements, activities, and saved routes. Configure its
account-specific ChatGPT technical app ID once by setting `QS_CHATGPT_APP_ID` and running
`npm run plugin:configure`, then run `npm run plugin:setup`. Generated app mappings and cache-busted manifests are
ignored. Restart the ChatGPT desktop app after setup or sync, then test in a new conversation. See the
[MCP server documentation](docs/mcp-server.md#repository-local-plugin) for the complete lifecycle and update matrix.

## Deployment and self-hosting

The deployment scripts and Firebase aliases in this repository target maintainer-managed environments. Do not run deployment commands against them as part of ordinary contributor setup.

Self-hosting is an advanced workflow rather than a turnkey installation. A fork must provide and review its own:

- Firebase project, client configuration, CLI aliases, Hosting and Storage targets, and indexes.
- Auth providers, authorized domains, redirect URIs, App Check, and Remote Config.
- Function regions, Cloud Tasks queues, buckets, allowed origins, and email URLs.
- Firebase Extension instances and Secret Manager bindings.
- Garmin, Suunto, COROS, Wahoo, Stripe, Gemini, Mapbox, email, and observability credentials used by enabled features.

Audit all project-specific identifiers and domains before deploying a fork. Deployment, publishing, and cloud configuration changes should always be deliberate, separate operations.

## Data retention and policies

The hosted project uses Firestore TTL policies for short-lived operational data:

| Collection | Retention | TTL field | Purpose |
| --- | --- | --- | --- |
| `mail` | About 90 days | `expireAt` | Transactional email records |
| `aiInsightsPromptRepairs` | Until the retired AI Insights purge completes | `expireAt` | Temporary TTL protection for historical prompt-repair data; no active writer remains |
| `failed_jobs` | 7 days | `expireAt` | Failed background-job records |
| `*Queue` | 7 days | `expireAt` | Temporary queue items |
| `adminStats` | About 1 hour | `expireAt` | Admin aggregate cache |
| `userDeletionTombstones` | Account-deletion retention window | `expireAt` | Deletion guards with TTL fallback cleanup |
| `mcpOAuthAuthorizationRequests` / `mcpOAuthAuthorizationCodes` | 10 / 5 minutes | `expireAt` | MCP OAuth consent and single-use codes |
| `mcpOAuthAccessTokens` / `mcpOAuthRefreshTokens` | 1 hour / 30 days | `expireAt` | Hashed MCP bearer and refresh credentials |
| `mcpOAuthRateLimits` | About 5 minutes | `expireAt` | Distributed MCP request counters |
| `users/*/mcpConnections` | 5 minutes while pending | `expireAt` | Abandoned MCP approvals; successful exchanges remove the TTL field |
| `users/*/assistantConversations` | 7 days after the latest completed turn or reset; an active turn is protected for at most 4 extra minutes | `expireAt` | One bounded server-owned active Assistant conversation plus private, unindexed replay fingerprints per user |
| `users/*/eventMergeOperations` | 7 days after the latest state transition | `expireAt` | Event-merge idempotency and reconciliation ledger |
| `users/*/activitySyncOutboundFingerprints` | About 120 days | `expireAt` | Server-only exact/semantic FIT receipts that suppress provider-returned activity echoes |

These policies are infrastructure configuration; starting local emulators does not create or deploy production TTL policies.

## Architecture documentation

- [Isolated local development](docs/local-development.md)
- [Provider integration implementation guide](docs/provider-integration-guide.md)
- [COROS integration architecture and release checklist](docs/coros-integration.md)
- [Wahoo integration architecture and release checklist](docs/wahoo-integration.md)
- [Training workspace architecture and maintenance](docs/training-workspace.md)
- [Frontend UI composition and shared route headers](docs/frontend-ui.md)
- [MCP-backed built-in Assistant](docs/assistant.md)
- [Activity Calendar architecture and maintenance](docs/activity-calendar.md)
- [Read-only MCP server](docs/mcp-server.md)
- [Firebase Function secret management](docs/function-secret-management.md)
- [Queue processing architecture](docs/queue-processing.md)
- [Sleep sync operations](docs/sleep-sync-operations.md)
- [Email lifecycle](docs/email-lifecycle.md)
- [Firebase Auth link-domain routing](docs/firebase-auth-link-domain-routing.md)
- [Connected-provider attribution audit](docs/connected-provider-attribution-audit.md)
- [Event merge idempotency and recovery](docs/event-merge-idempotency.md)
- [Pricing and usage limits](docs/PRICING_AND_LIMITS.md)
- [User deletion workflow](docs/user-deletion-workflow.html)

## Contributing

Contributions are welcome. Before opening a pull request:

1. Keep changes focused and add or update the narrowest relevant tests.
2. Run the applicable checks from the table above.
3. Use a prefixed commit subject: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, or `docs:`.
4. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Security-related guidance is available in [SECURITY.md](SECURITY.md).

## License

Quantified Self is licensed under the [GNU Affero General Public License v3.0](LICENSE).

---

*Icons by Alessandro.*
