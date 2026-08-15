# Isolated local development

## Purpose

The default contributor workflow runs the application against a disposable Firebase demo project on the developer's machine. It is designed to make accidental production access harder than a normal emulator setup and to make Stripe unnecessary for feature development.

This is a development environment, not a production self-hosting recipe. It does not provision cloud infrastructure, configure real providers, or reproduce every hosted service.

## Quick reference

```bash
npm ci
npm --prefix functions ci
cp src/environments/mapbox-token.local.example.ts src/environments/mapbox-token.local.ts
cp functions/.secret.local.example functions/.secret.local
# Replace only YOUR_PUBLIC_MAPBOX_TOKEN in mapbox-token.local.ts.
npm start
```

The main commands are:

| Command | Effect |
| --- | --- |
| `npm start` | Validate isolation, build Functions, start the required Firebase emulators and Angular, then import/export persistent emulator state |
| `npm run local:config:test` | Test the configuration, project, endpoint, secret, credential, and Firebase CLI argument guards |
| `npm run local:smoke` | Start an ephemeral emulator stack and verify Auth, Firestore, Storage, callable Functions, and authenticated HTTP upload behavior |
| `npm run local:role -- --email you@example.com --role pro` | Give an existing, onboarded fake account a synthetic Pro entitlement |
| `npm run local:role -- --email you@example.com --role free` | Remove that synthetic Pro entitlement and restore the Free claim |
| `npm run local:reset` | Delete the saved emulator export while the stack is stopped |

## Runtime topology

`local-runtime.config.json` is the single source for the local project ID, host, and ports. `firebase.local.json` is intentionally separate from the deployable Firebase configuration.

| Process | Address |
| --- | --- |
| Angular | `http://127.0.0.1:4200` |
| Emulator UI | `http://127.0.0.1:4000` |
| Auth | `127.0.0.1:9099` |
| Functions | `127.0.0.1:5001` |
| Firestore | `127.0.0.1:8081` |
| Storage | `127.0.0.1:9199` |
| Cloud Tasks | `127.0.0.1:9499` |
| Emulator Hub | `127.0.0.1:4400` |

The launcher performs these operations in order:

1. Validate that the project starts with `demo-`, every address is loopback, every required emulator matches the central configuration, and no Hosting, Extension, or Remote Config section was added to `firebase.local.json`.
2. Refuse Functions `.env*` files, non-sentinel backend values, inherited Firebase/Google cloud settings, missing dependencies, a missing Mapbox token, and occupied ports.
3. Create an isolated child-process environment. It hides Firebase CLI account state, masks workstation application-default credentials with a deliberately missing credential path, and disables metadata-server credential discovery.
4. Compile Functions.
5. Start only Auth, Functions, Firestore, Storage, and Cloud Tasks with the pinned repository Firebase CLI and explicit `--config`, `--project`, and `--only` arguments.
6. Wait for the Emulator Hub to report every expected service at the configured loopback address.
7. Start Angular with the `local` configuration.
8. On Ctrl+C, stop Angular and Firebase cleanly and export emulator state under `.local/firebase-emulator-data`.

The first emulator start can take longer because Firebase downloads Java emulator binaries.

## Isolation guarantees

### Demo project and explicit endpoints

The local project is `demo-quantified-self-local`. Firebase treats `demo-*` projects specially: attempts to use a Firebase product without a running emulator fail instead of falling through to a real project.

The browser environment uses dummy Firebase identifiers and explicitly connects Auth, Firestore, Storage, and Functions to the central emulator endpoints. Functions initialization independently checks that:

- `FUNCTIONS_EMULATOR` is exactly `true`;
- the effective project starts with `demo-`;
- any injected `FIREBASE_CONFIG` agrees with that project; and
- Auth, Firestore, Storage, and Cloud Tasks endpoints are all loopback addresses.

If any check fails, Functions do not initialize. In a hosted runtime the existing production bucket and keyless Application Default Credentials behavior remain unchanged.

### No local backend credentials

`functions/.secret.local.example` contains `LOCAL_EMULATOR_DISABLED`, not credentials. Blank emulator secrets cause Firebase to query Secret Manager, so the explicit sentinel prevents that fallback. `npm start` creates or upgrades an all-blank ignored `.secret.local` from the safe example, then rejects any other value.

The launcher also rejects inherited values such as `GOOGLE_APPLICATION_CREDENTIALS`, `FIREBASE_TOKEN`, `GCLOUD_PROJECT`, and `GOOGLE_CLOUD_PROJECT` before startup. Child processes receive an isolated config directory and an intentionally missing ADC path so code that accidentally initializes an un-emulated Google client fails before inheriting workstation credentials.

Do not replace the sentinels with provider credentials. Provider-integration development requires a separate, reviewed workflow using development-only accounts.

### Stripe-free billing

The local frontend environment sets `billingMode` to `disabled`. The payment service enforces this boundary even if UI code calls it directly:

- the Stripe product catalog resolves to an empty list;
- checkout creation throws before writing a checkout document;
- customer portal and claim-restoration calls throw before invoking Functions; and
- renewal lookup returns `no_upcoming_charge` without invoking Functions.

The pricing view labels local roles as synthetic and does not render billing-management actions. No Stripe Extension is present in `firebase.local.json`, and no Stripe identifier is created by the role tool.

### Hosted-only browser services

The local browser does not initialize Analytics, Remote Config, Performance Monitoring, App Check, or Sentry. Remote Config and logging services also tolerate their providers being absent, so local startup does not create indirect network calls.

App Check remains enabled in hosted configurations. Raw upload handlers and callable platform options relax it only when the Functions process itself has `FUNCTIONS_EMULATOR=true`; a request cannot set that server environment flag.

### Remaining network boundary

The public Mapbox token is the one intentional external browser dependency in the default local workflow. Map and geocoding screens can contact Mapbox.

Garmin, Suunto, COROS, Wahoo, Gemini, backend Mapbox, Stripe, and delivery-email credentials are disabled. Their Functions may still be discoverable in the emulator because the same Functions entry point is compiled, but these cloud-backed workflows are outside the isolated setup and must not be exercised with sentinel values. Pub/Sub schedules are not started. Email-trigger documents remain in local Firestore because no delivery extension is configured.

The launcher protects against accidental use of configured production resources; it is not a sandbox for untrusted repository code or npm dependencies.

## Local sign-in and onboarding

Use fake identities only:

- Email magic-link requests are handled by the Auth emulator. Use the link shown in emulator output or the Emulator UI; no email is sent.
- Google and GitHub buttons use the Auth emulator's mock provider flow; do not enter a real provider account.
- Complete onboarding in the app so the expected local user and legal documents exist.

The Auth emulator and browser cache are separate. A local account can remain visible in the browser after saved emulator data is reset; clear site data for `127.0.0.1` when you want a completely fresh browser session.

## Synthetic Free and Pro roles

Run the role command only while `npm start` is active and only for an email that exists in the Auth emulator and has completed onboarding.

For Pro, the command:

- pauses background Functions triggers;
- writes `customers/{uid}/subscriptions/local-pro` with a 30-day active period, `role: pro`, and `localSynthetic: true`;
- updates only the `stripeRole` claim while preserving unrelated claims;
- records a local claims-refresh marker; and
- resumes triggers in a `finally` block.

For Free, it deletes only `subscriptions/local-pro`, sets the role claim to `free`, and removes a stale grace-period claim. It never reads or writes a Stripe customer ID, price, checkout session, invoice, or payment record.

The command verifies the Emulator Hub and expected loopback services before importing Firebase Admin. This prevents it from being aimed at a hosted user by changing CLI flags.

## Persistence and reset

Normal `npm start` sessions import `.local/firebase-emulator-data` when a valid export exists and always request an export on exit. Stop with one Ctrl+C and wait for Firebase to report shutdown before closing the terminal.

`npm run local:smoke` is deliberately ephemeral: it does not import or export that directory and therefore cannot change the saved local dataset.

`npm run local:reset` resolves and verifies the exact repository-local state path, refuses to run while the Emulator Hub is reachable, and then deletes that directory. This operation is not recoverable unless the developer made a separate copy.

## Troubleshooting

### A port is already in use

`npm start` reports the named port and exits before starting children. Stop the conflicting process or deliberately update both `local-runtime.config.json` and every aligned configuration/test. Do not work around the check by binding emulators to a network interface.

The smoke test does not need port 4200, so it checks only emulator/UI/Hub ports.

### The Mapbox token is missing

Copy `src/environments/mapbox-token.local.example.ts` to the ignored `.local.ts` path and replace the placeholder with a public token. Backend Mapbox secrets remain disabled.

### Java or Node warnings appear

Use Java 21. The root project selects Node 20.19+ for frontend CI, while `functions/package.json` declares Node 22 for the deployed Functions runtime. Firebase can warn when the emulator uses Node 20; use Node 22 when validating exact Functions runtime behavior.

### The role does not update

Confirm the email exactly matches the fake Auth emulator user and that onboarding completed. Refresh the page or sign out and back in to force a token refresh. Inspect the Auth and Firestore emulator tabs rather than any Firebase console.

### Startup rejects a secret or credential

Remove the inherited variable or local Functions `.env*` file. Restore `functions/.secret.local` from the committed example. Do not add an exception for a real key to the safe launcher.

## Maintainer checklist

When changing local development behavior:

1. Keep `local-runtime.config.json`, `firebase.local.json`, Angular local replacements, frontend emulator wiring, and launcher expectations aligned.
2. Keep the default `environment.ts` fail closed. Hosted builds must remain explicit Angular configurations.
3. Preserve production App Check behavior and the hosted Firebase Admin initialization path.
4. Do not add Hosting, Extensions, Remote Config, real project aliases, deployment commands, or provider credentials to the local Firebase config.
5. Add a guard test for every new isolation invariant.
6. Run `npm run local:config:test`, the focused frontend/Functions tests, and `npm run local:smoke`.
7. Verify a production build separately; never deploy as part of local-workflow verification.

## Intentional hosted opt-in

`npm run start:functions:prod` is retained for a narrow maintainer workflow and is not a local-development command. Despite its historical name, its environment uses the hosted production Firebase configuration broadly, not just one isolated Function.

It refuses to start unless the maintainer supplies an exact confirmation:

```bash
QS_ALLOW_HOSTED_FUNCTIONS=quantified-self-io npm run start:functions:prod
```

That command can read and write hosted resources. It must never appear in contributor Quick Start instructions, automation, or emulator troubleshooting.
