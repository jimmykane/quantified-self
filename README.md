# Quantified Self

![Testing](https://github.com/jimmykane/quantified-self/actions/workflows/testing.yaml/badge.svg)

**Quantified Self** is an open-source platform for collecting, analyzing, and visualizing fitness and health data. It combines activity imports and connected fitness services with dashboards, training insights, route tools, sleep trends, and detailed workout analysis.

Try the hosted app at [quantified-self.io](https://www.quantified-self.io/).

## Highlights

- Import activity files in FIT, GPX, TCX, JSON, and SML formats.
- Connect Garmin, Suunto, and COROS for supported activity, route, and sleep workflows.
- Explore configurable dashboards, training readiness, load trends, power curves, intensity zones, laps, and durability metrics.
- View activities and saved routes with Mapbox-powered maps and route tools.
- Compare recordings from multiple devices, share selected activities, and export your data.
- Generate optional AI-assisted activity insights.

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

Use a dedicated development Firebase project and test account for authenticated work. Do not perform writes until you have confirmed which project the browser is using. Credentials placed in `functions/.env` can also call real provider APIs, and Cloud Tasks uses its configured external API unless a task emulator host is supplied.

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

The `--ssl=false` override provides a predictable fresh-clone path without relying on a local trusted certificate. If you need HTTPS for an integration flow, generate and trust your own localhost certificate rather than reusing or sharing private key material.

Public pages such as `/`, `/help`, `/integrations`, and `/tools/compare` are useful first smoke tests. Authenticated flows additionally require correctly configured Firebase Auth providers, authorized domains, and App Check settings.

`npm start` and `npm run start:functions:emu` start Angular only; neither command starts Firebase emulators. Avoid `npm run start:functions:prod` during normal contributor work because it routes callable requests to the configured hosted Functions.

## Optional backend and provider configuration

`functions/.env` is ignored and is not required to install dependencies, build the code, or run unit tests. Add only the credentials needed for the integration you are developing.

| Feature | Configuration names |
| --- | --- |
| Garmin | `GARMINAPI_CLIENT_ID`, `GARMINAPI_CLIENT_SECRET`, `GARMINHEALTHAPI_CONSUMER_KEY`, `GARMINHEALTHAPI_CONSUMER_SECRET` |
| Suunto | `SUUNTOAPP_CLIENT_ID`, `SUUNTOAPP_CLIENT_SECRET`, `SUUNTOAPP_SUBSCRIPTION_KEY`, `SUUNTOAPP_NOTIFICATION_SECRET` |
| COROS | `COROSAPI_CLIENT_ID`, `COROSAPI_CLIENT_SECRET` |
| Stripe | `STRIPE_SECRET_KEY` or `STRIPE_API_KEY` |
| AI Insights | `GEMINI_API_KEY` |
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

## Deployment and self-hosting

The deployment scripts and Firebase aliases in this repository target maintainer-managed environments. Do not run deployment commands against them as part of ordinary contributor setup.

Self-hosting is an advanced workflow rather than a turnkey installation. A fork must provide and review its own:

- Firebase project, client configuration, CLI aliases, Hosting and Storage targets, and indexes.
- Auth providers, authorized domains, redirect URIs, App Check, and Remote Config.
- Function regions, Cloud Tasks queues, buckets, allowed origins, and email URLs.
- Firebase Extension instances and Secret Manager bindings.
- Garmin, Suunto, COROS, Stripe, Gemini, Mapbox, email, and observability credentials used by enabled features.

Audit all project-specific identifiers and domains before deploying a fork. Deployment, publishing, and cloud configuration changes should always be deliberate, separate operations.

## Data retention and policies

The hosted project uses Firestore TTL policies for short-lived operational data:

| Collection | Retention | TTL field | Purpose |
| --- | --- | --- | --- |
| `mail` | About 90 days | `expireAt` | Transactional email records |
| `aiInsightsPromptRepairs` | About 90 days | `expireAt` | AI prompt-repair backlog |
| `failed_jobs` | 7 days | `expireAt` | Failed background-job records |
| `*Queue` | 7 days | `expireAt` | Temporary queue items |
| `adminStats` | About 1 hour | `expireAt` | Admin aggregate cache |
| `userDeletionTombstones` | Account-deletion retention window | `expireAt` | Deletion guards with TTL fallback cleanup |

These policies are infrastructure configuration; starting local emulators does not create or deploy production TTL policies.

## Architecture documentation

- [Training workspace architecture and maintenance](docs/training-workspace.md)
- [Queue processing architecture](docs/queue-processing.md)
- [Sleep sync operations](docs/sleep-sync-operations.md)
- [Email lifecycle](docs/email-lifecycle.md)
- [Firebase Auth link-domain routing](docs/firebase-auth-link-domain-routing.md)
- [Connected-provider attribution audit](docs/connected-provider-attribution-audit.md)
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
