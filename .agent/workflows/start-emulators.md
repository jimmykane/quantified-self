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
firebase emulators:start
```

## Emulator Ports
- Auth: http://localhost:9099
- Functions: http://localhost:5001
- Firestore: http://localhost:8081
- Emulator UI: http://localhost:4000
