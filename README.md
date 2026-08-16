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

For the frontend and the repository's CI-compatible workflow, install:

- Git.
- Node.js 20.19 or later in the Node 20 line. The committed `.nvmrc` selects Node 20, so `nvm use` is the easiest way to match CI.
- npm, which is included with Node.js.
- [Gitleaks](https://github.com/gitleaks/gitleaks), used by the pre-commit credential scan.
- A [Mapbox public access token](https://docs.mapbox.com/help/getting-started/access-tokens/) for maps and geocoding.

For Firebase emulators and Rules tests, also install:

- [Firebase CLI](https://firebase.google.com/docs/cli).
- Java 21, matching the CI environment.

> [!NOTE]
> `functions/package.json` declares Node.js 22 as the Cloud Functions runtime. Installing Functions dependencies under Node 20 may show an engine warning. Use Node 22 when developing or deploying Functions runtime behavior; the root `.nvmrc` remains the frontend and CI default.

## Quick start

### 1. Clone and install

```bash
git clone https://github.com/jimmykane/quantified-self.git
cd quantified-self
nvm use
npm ci
npm --prefix functions ci
```

The root application and Functions use separate lockfiles, so both installs are required for the full development workflow.

### 2. Add a local Mapbox token

The local Angular build expects a file that is intentionally excluded from Git. Create `src/environments/mapbox-token.local.ts` with your own public token:

```ts
export const mapboxAccessToken = 'YOUR_PUBLIC_MAPBOX_TOKEN';
```

Do not copy a maintainer token or commit this file. A valid token is required for map and geocoding features.

### 3. Understand the local Firebase boundary

> [!WARNING]
> The current development configuration is **hybrid, not fully isolated**. Callable Functions are routed to the Functions emulator, but browser Auth, Firestore, Storage, Analytics, App Check, and Remote Config still use the configured hosted Firebase project. Starting additional emulators does not connect those browser SDKs automatically.

Use a dedicated development Firebase project and test account for authenticated work. Do not perform writes until you have confirmed which project the browser is using. Development credentials placed in `functions/.secret.local` can also call real provider APIs, and Cloud Tasks uses its configured external API unless a task emulator host is supplied.

The Functions emulator does not require a service-account JSON or Google Application Default Credentials when Admin SDK traffic stays on the Auth, Firestore, and Storage emulators. The shared Admin bootstrap uses the emulator hosts locally and the assigned runtime identity in Cloud Functions. Do not add a service-account key to the Functions source tree.

### 4. Build Functions and start the emulators

In the first terminal:

```bash
npm --prefix functions run build
firebase emulators:start --only auth,functions,firestore,storage
```

The Functions emulator loads compiled output from `functions/lib`, so the build must finish before the emulators start.

### 5. Start Angular

In a second terminal:

```bash
npm run start:functions:emu -- --ssl=false
```

Open:

- Application: [http://localhost:4200](http://localhost:4200)
- Firebase Emulator UI: [http://localhost:4000](http://localhost:4000)

The `--ssl=false` override provides a predictable fresh-clone path without relying on a local trusted certificate. If you need HTTPS for an integration flow, generate and trust your own localhost certificate rather than reusing or sharing private key material. The `certs/` directory is ignored and must never be committed:

```bash
mkdir -p certs
umask 077
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 825 \
  -keyout certs/localhost.key -out certs/localhost.crt \
  -subj '/CN=localhost' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1'
```

Public pages such as `/`, `/help`, `/integrations`, and `/tools/compare` are useful first smoke tests. Authenticated flows additionally require correctly configured Firebase Auth providers, authorized domains, and App Check settings.

`npm start` and `npm run start:functions:emu` start Angular only; neither command starts Firebase emulators. Avoid `npm run start:functions:prod` during normal contributor work because it routes callable requests to the configured hosted Functions.

## Optional backend and provider configuration

Copy `functions/.secret.local.example` to the ignored `functions/.secret.local` only when an emulator or operational script needs provider credentials. Add development-only values for the integration you are testing; builds and unit tests do not require the file. See [Firebase Function secret management](docs/function-secret-management.md) for binding, deployment, and rotation rules.

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

Never commit environment files, service-account JSON, API tokens, private keys, decrypted credentials, personal data, or production exports. Emulator code can still reach external services when real credentials are configured.

## Development commands

| Purpose | Command | Notes |
| --- | --- | --- |
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

Contributions are welcome. Start with a [`good first issue`](https://github.com/jimmykane/quantified-self/labels/good%20first%20issue), or ask a question in [GitHub Discussions](https://github.com/jimmykane/quantified-self/discussions). Before opening a pull request:

1. Keep changes focused and add or update the narrowest relevant tests.
2. Run the applicable checks from the table above.
3. Use a prefixed commit subject: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, or `docs:`.
4. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

Security-related guidance is available in [SECURITY.md](SECURITY.md).

## License

Quantified Self is licensed under the [GNU Affero General Public License v3.0](LICENSE).

---

*Icons by Alessandro.*
