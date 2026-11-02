---
description: Start local Firebase emulators for development
---

# Start Firebase Emulators

Start local Firebase emulators for Firestore, Auth, and Functions development.

## 1. Build Functions First
```bash
npm --prefix functions run build
```

## 2. Start Emulators
```bash
npm run firebase:tools
npm run emulators:local -- emulators:start --only auth,functions,firestore,storage
```

No service-account JSON or Google Application Default Credentials are required while Admin SDK traffic stays on these
emulators. Provider secrets come from the external `~/.config/quantified-self/functions.env` profile. The wrapper prepares
a private runtime outside the checkout and cleans it up when Firebase exits. Never copy or symlink credentials into
the checkout. See `docs/function-secret-management.md` for profile and hosted-Auth signing overrides.

## Keep the backend current

The emulator loads `functions/lib`, not TypeScript sources. After the initial build, keep this running in a separate
terminal from the repository root while editing backend or shared code:

```bash
npm --prefix functions run build:watch
```

Rerun the full build after a branch switch or template change. Verify a new callable appears in the emulator's
initialized endpoint list before browser testing. A stale build can return a missing-endpoint response without CORS
headers even when Assistant chat and other existing callables work. Check the endpoint and an unauthenticated local
preflight before changing CORS/App Check policy; do not use an authenticated generation or save as a transport probe.

## Emulator Ports
- Auth: http://localhost:9099
- Functions: http://localhost:5001
- Firestore: http://localhost:8081
- Emulator UI: http://localhost:4000
