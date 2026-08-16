---
description: Start local Firebase emulators for development
---

# Start Firebase Emulators

Start local Firebase emulators for Firestore, Auth, and Functions development.

## 1. Build Functions First
```bash
cd functions && npm run build
```

## 2. Start Emulators
```bash
firebase emulators:start --only auth,functions,firestore,storage
```

No service-account JSON or Google Application Default Credentials are required while Admin SDK traffic stays on these emulators. Provider secrets, when needed, come from `functions/.secret.local`; never add a Firebase Admin private key to the Functions source tree.

## Emulator Ports
- Auth: http://localhost:9099
- Functions: http://localhost:5001
- Firestore: http://localhost:8081
- Emulator UI: http://localhost:4000
