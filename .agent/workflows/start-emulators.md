---
description: Start local Firebase emulators for development
---

# Start Firebase Emulators

Start the isolated local application and Firebase emulators.

## Start the full stack

```bash
npm start
```

The launcher validates the `demo-*` project and loopback endpoints, masks cloud credentials, builds Functions, starts Auth/Functions/Firestore/Storage/Tasks, and starts Angular. No service-account JSON or Google Application Default Credentials are required while Admin SDK traffic stays on these emulators. Do not replace the launcher with a bare `firebase emulators:start`, which can select the deployable Firebase configuration.

## Addresses

- Application: http://127.0.0.1:4200
- Auth: http://127.0.0.1:9099
- Functions: http://127.0.0.1:5001
- Firestore: http://127.0.0.1:8081
- Storage: http://127.0.0.1:9199
- Tasks: http://127.0.0.1:9499
- Emulator UI: http://127.0.0.1:4000

See `docs/local-development.md` for setup, smoke tests, synthetic roles, and reset behavior.
