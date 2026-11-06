# Firebase CLI pin

`.firebase-tools-version` is the shared exact version for local deployments, emulators and CI. The current pin is
**15.34.2**. The repository wrapper refuses a missing or mismatched executable before running a Firebase command.
The isolated contributor launcher selects the package-local installation from `npm ci` through this wrapper's
`--local` option and invokes its JavaScript entry point with Node, including on Windows. Maintainer deployments,
external-profile emulators and existing CI runners use the global installation in the selected Node environment.
Both selections enforce the same exact pin; neither falls back after a version mismatch.

## Install and run

From the repository root:

```bash
nvm use 22
npm run firebase:tools
npm run firebase -- --version
npm run emulators:local -- emulators:start --only auth,functions,firestore,storage
```

NVM keeps global packages per Node installation. After switching Node versions, run `npm run firebase:tools` again
if the wrapper reports a mismatch. CI uses the same bootstrap after selecting its job's Node version. Installing
root application dependencies installs only the contributor runtime's package-local CLI. Avoid bare `firebase`, unversioned `npx firebase`
and ad hoc `npm install -g firebase-tools` commands for repository operations.

Package deployment and emulator scripts use this entry point. For an explicitly approved deployment, run:

```bash
npm run firebase -- deploy --only functions --project quantified-self-io
```

Select the approved target and scope explicitly. See [Function deployment verification](function-secret-management.md#complete-production-deployment)
for preflight and post-deployment checks. Tool installation does not authorize deployment or IAM changes.

## Update the pin

Review the upstream release notes, edit `.firebase-tools-version` to one exact version, then run:

```bash
npm run firebase:tools
npm run test:firebase-cli
npm run test:workflows
npm run test:rules
npm run test:functions-emulators -- lifecycle
```

Verify affected emulator workflows when changing CLI behavior. Keep CI's install and command steps routed through
the shared scripts; do not introduce separate version literals. `test:firebase-cli` checks version enforcement,
argument forwarding, failure propagation and the private task-queue IAM regression without calling cloud APIs.
Keep the exact `firebase-tools` development dependency aligned with the shared pin too; `npm run local:config:test`
checks that alignment and the package-local wrapper's version enforcement and argument forwarding.

## Private task-queue IAM crash

Firebase Tools 15.31.0 assumed every existing queue IAM policy contained `bindings`. A private queue may validly
omit that field, causing `setEnqueuer` to throw and the deployment to report a misleading invoker/IAM failure.
Firebase fixed this in [15.32.1](https://github.com/firebase/firebase-tools/releases/tag/v15.32.1); the fix is included
in [15.34.2](https://github.com/firebase/firebase-tools/releases/tag/v15.34.2).

Check the pinned CLI and the underlying error before changing permissions. This crash does not require granting
public invoker access or expanding IAM roles. Other deployment errors still require their own diagnosis.
